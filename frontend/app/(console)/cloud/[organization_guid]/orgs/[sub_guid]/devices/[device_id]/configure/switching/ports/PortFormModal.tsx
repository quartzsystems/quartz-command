"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import {
  SwitchPort,
  SwitchVlan,
  VlanMode,
  formatPortSpeed,
  updateSwitchPort,
} from "@/lib/device/switching";

/// Shown when the agent doesn't report the port's supported speeds (older
/// agent or a platform whose STATE_DB lacks `supported_speeds`).
const FALLBACK_SPEEDS_MBPS = [100, 1000, 2500, 5000, 10000, 25000, 40000, 50000, 100000, 200000, 400000];

function vlanLabel(v: SwitchVlan): string {
  return v.description ? `${v.vlan_id} — ${v.description}` : String(v.vlan_id);
}

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Checkbox-dropdown over the switch's configured VLANs, for picking a trunk's
/// tagged set. VLANs on the port but no longer in CONFIG_DB stay listed (and
/// checked) so saving doesn't silently drop them.
function VlanMultiSelect({
  vlans,
  selected,
  onChange,
}: {
  vlans: SwitchVlan[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const known = new Set(vlans.map((v) => v.vlan_id));
  const orphans = selected.filter((id) => !known.has(id)).sort((a, b) => a - b);
  const options = [
    ...vlans.map((v) => ({ id: v.vlan_id, label: vlanLabel(v) })),
    ...orphans.map((id) => ({ id, label: `${id} — (no longer configured)` })),
  ].sort((a, b) => a.id - b.id);

  const toggle = (id: number) =>
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id].sort((a, b) => a - b),
    );

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputCls} cursor-pointer flex items-center justify-between gap-2 text-left`}
        style={monoSt}
      >
        <span className={selected.length ? undefined : "text-[var(--qz-fg-4)]"}>
          {selected.length ? selected.join(", ") : "Select VLANs…"}
        </span>
        <ChevronDown size={14} className="flex-shrink-0 text-[var(--qz-fg-4)]" />
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 mt-1 z-20 rounded-md py-1 max-h-[220px] overflow-y-auto"
          style={{
            background: "var(--qz-surface)",
            border: "1px solid var(--qz-border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          {options.length === 0 && (
            <div className="px-3 py-[6px] text-[12.5px] text-[var(--qz-fg-4)]">
              No VLANs configured — create them under Switching → VLANs.
            </div>
          )}
          {options.map((o) => (
            <label
              key={o.id}
              className="flex items-center gap-2 px-3 py-[6px] text-[13px] text-[var(--qz-fg-2)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={() => toggle(o.id)}
                className="qz-check"
              />
              <span style={{ fontFamily: "var(--qz-font-mono)" }}>{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/// Edit one front-panel port: description, admin state, MTU, speed, FEC, and
/// its L2 membership (access / trunk / routed). Saves through the agent's
/// `PUT /api/switching/ports/{name}` — the write lands in CONFIG_DB and the
/// page reloads live state afterwards.
export function PortFormModal({
  port,
  vlans,
  onClose,
  onSaved,
}: {
  port: SwitchPort;
  /** Existing VLANs, for the access/native VLAN pickers. */
  vlans: SwitchVlan[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [description, setDescription] = useState(port.description ?? "");
  const [enabled, setEnabled] = useState(port.admin_status === "up");
  const [mtu, setMtu] = useState(port.mtu != null ? String(port.mtu) : "");
  const [speed, setSpeed] = useState(port.speed_mbps != null ? String(port.speed_mbps) : "");
  const [fec, setFec] = useState(port.fec ?? "");
  const [vlanMode, setVlanMode] = useState<VlanMode>(port.vlan_mode ?? "routed");
  const [untagged, setUntagged] = useState(
    port.untagged_vlan != null ? String(port.untagged_vlan) : "",
  );
  const [tagged, setTagged] = useState<number[]>(
    [...port.tagged_vlans].sort((a, b) => a - b),
  );

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Selectable speeds: what the hardware reports, or a generic ladder when the
  // agent doesn't say — always including the port's current speed so the
  // initial selection round-trips.
  const speedOptions = [
    ...new Set([
      ...(port.supported_speeds?.length ? port.supported_speeds : FALLBACK_SPEEDS_MBPS),
      ...(port.speed_mbps != null ? [port.speed_mbps] : []),
    ]),
  ].sort((a, b) => a - b);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (mtu.trim() !== "") {
      const m = Number(mtu);
      if (!Number.isInteger(m) || m < 68 || m > 9216) {
        setError("MTU must be a whole number between 68 and 9216.");
        return;
      }
    }

    let untaggedVlan: number | null = null;
    let taggedVlans: number[] = [];
    if (vlanMode === "access") {
      if (untagged === "") {
        setError("Pick the access VLAN.");
        return;
      }
      untaggedVlan = Number(untagged);
    } else if (vlanMode === "trunk") {
      untaggedVlan = untagged === "" ? null : Number(untagged);
      taggedVlans = tagged;
      if (taggedVlans.length === 0) {
        setError("A trunk needs at least one tagged VLAN.");
        return;
      }
    }

    setSaving(true);
    try {
      await updateSwitchPort(port.name, {
        description: description.trim() || null,
        admin_status: enabled ? "up" : "down",
        mtu: mtu.trim() === "" ? null : Number(mtu),
        speed_mbps: speed.trim() === "" ? null : Number(speed),
        fec: fec || null,
        vlan_mode: vlanMode,
        untagged_vlan: untaggedVlan,
        tagged_vlans: taggedVlans,
      });
      onSaved(`Saved ${port.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save port.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title="Edit Port"
        subtitle={port.alias ? `${port.name} · ${port.alias}` : port.name}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="uplink to spine1"
            className={inputCls}
            style={inputSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">MTU</label>
            <input
              type="number"
              min={68}
              max={9216}
              value={mtu}
              onChange={(e) => setMtu(e.target.value)}
              placeholder="9100"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Speed</label>
            <select
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              className={`${inputCls} cursor-pointer`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="">Default</option>
              {speedOptions.map((s) => (
                <option key={s} value={String(s)}>
                  {formatPortSpeed(s) ?? `${s} Mbps`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">FEC</label>
            <select
              value={fec}
              onChange={(e) => setFec(e.target.value)}
              className={`${inputCls} cursor-pointer`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="">Default</option>
              <option value="none">None</option>
              <option value="rs">RS</option>
              <option value="fc">FC</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">VLAN Mode</label>
            <select
              value={vlanMode}
              onChange={(e) => setVlanMode(e.target.value as VlanMode)}
              className={`${inputCls} cursor-pointer`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="access">Access</option>
              <option value="trunk">Trunk</option>
              <option value="routed">Routed (no VLANs)</option>
            </select>
          </div>
          {vlanMode !== "routed" && (
            <div>
              <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
                {vlanMode === "access" ? (
                  <>Access VLAN <span style={{ color: "var(--qz-danger)" }}>*</span></>
                ) : (
                  "Native VLAN"
                )}
              </label>
              <select
                value={untagged}
                onChange={(e) => setUntagged(e.target.value)}
                className={`${inputCls} cursor-pointer`}
                style={monoSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              >
                {vlanMode === "trunk" && <option value="">None</option>}
                {vlanMode === "access" && untagged === "" && <option value="">Select…</option>}
                {vlans.map((v) => (
                  <option key={v.vlan_id} value={String(v.vlan_id)}>
                    {vlanLabel(v)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {vlanMode === "trunk" && (
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Tagged VLANs <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <VlanMultiSelect vlans={vlans} selected={tagged} onChange={setTagged} />
          </div>
        )}

        <label className="flex items-center gap-[10px] cursor-pointer select-none">
          <Switch on={enabled} onChange={setEnabled} />
          <span className="text-[13px] text-[var(--qz-fg-2)]">Enabled</span>
        </label>

        {error && (
          <p className="text-[12px] m-0" style={{ color: "var(--qz-danger)" }}>
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end mt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-[9px] rounded-md text-[13px] font-medium cursor-pointer"
            style={{ background: "transparent", border: "1px solid var(--qz-border)", color: "var(--qz-fg-2)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-[9px] rounded-md text-[13px] font-semibold cursor-pointer border-0"
            style={{ background: "var(--qz-accent)", color: "var(--qz-fg-on-accent)", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
