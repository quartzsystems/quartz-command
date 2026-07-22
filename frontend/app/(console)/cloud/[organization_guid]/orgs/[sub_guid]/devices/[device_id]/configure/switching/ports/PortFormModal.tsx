"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import {
  SwitchPort,
  SwitchVlan,
  VlanMode,
  updateSwitchPort,
} from "@/lib/device/switching";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
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
  const [tagged, setTagged] = useState(port.tagged_vlans.join(", "));

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const vlanIds = vlans.map((v) => v.vlan_id);

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
    if (speed.trim() !== "") {
      const s = Number(speed);
      if (!Number.isInteger(s) || s <= 0) {
        setError("Speed must be a positive whole number of Mbps (e.g. 1000, 10000).");
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
      const parts = tagged.split(",").map((t) => t.trim()).filter(Boolean);
      for (const p of parts) {
        const id = Number(p);
        if (!Number.isInteger(id) || id < 1 || id > 4094) {
          setError(`"${p}" is not a VLAN ID (1–4094).`);
          return;
        }
        taggedVlans.push(id);
      }
      taggedVlans = [...new Set(taggedVlans)].sort((a, b) => a - b);
      if (taggedVlans.length === 0) {
        setError("A trunk needs at least one tagged VLAN.");
        return;
      }
      const missing = taggedVlans.filter((id) => !vlanIds.includes(id));
      if (missing.length > 0) {
        setError(`VLAN${missing.length > 1 ? "s" : ""} ${missing.join(", ")} do${missing.length > 1 ? "" : "es"} not exist — create ${missing.length > 1 ? "them" : "it"} under Switching → VLANs first.`);
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
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Speed (Mbps)</label>
            <input
              type="number"
              min={10}
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              placeholder="1000"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
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
                {vlanIds.map((id) => (
                  <option key={id} value={String(id)}>
                    {id}
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
            <input
              value={tagged}
              onChange={(e) => setTagged(e.target.value)}
              placeholder="10, 20, 30"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
            <p className="text-[11.5px] text-[var(--qz-fg-4)] mt-[6px] mb-0">
              Comma-separated VLAN IDs. Existing VLANs: {vlanIds.join(", ") || "none"}.
            </p>
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
