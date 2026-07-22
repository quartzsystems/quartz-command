"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import {
  StaticNextHop,
  StaticRoute,
  emptyNextHop,
  putStaticRoute,
  staticRouteKey,
} from "@/lib/device/sonic-static-routes";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const CIDR_V4 = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const CIDR_V6 = /^[0-9a-fA-F:]+\/\d{1,3}$/;

/** Editable form row for one next hop. */
interface HopDraft {
  kind: "gateway" | "interface" | "blackhole";
  gateway: string;
  iface: string;
  nexthopVrf: string;
  distance: string;
}

function toDraft(h: StaticNextHop): HopDraft {
  return {
    kind: h.blackhole ? "blackhole" : h.gateway ? "gateway" : "interface",
    gateway: h.gateway ?? "",
    iface: h.interface ?? "",
    nexthopVrf: h.nexthop_vrf ?? "",
    distance: h.distance != null ? String(h.distance) : "",
  };
}

/// Create or edit a static route: one (VRF, prefix) row with one or more
/// next hops (multiple hops = ECMP). Editing replaces the row wholesale.
export function SonicStaticRouteFormModal({
  initial,
  existing,
  vrfs,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  initial?: StaticRoute;
  existing: StaticRoute[];
  /** Data VRF names for the pickers. */
  vrfs: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;

  const [vrf, setVrf] = useState(initial?.vrf ?? "");
  const [prefix, setPrefix] = useState(initial?.prefix ?? "");
  const [hops, setHops] = useState<HopDraft[]>(
    initial ? initial.next_hops.map(toDraft) : [toDraft(emptyNextHop())],
  );

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const setHop = (i: number, patch: Partial<HopDraft>) =>
    setHops((prev) => prev.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const trimmedPrefix = prefix.trim();
    if (!CIDR_V4.test(trimmedPrefix) && !CIDR_V6.test(trimmedPrefix)) {
      return setError('Destination must be a CIDR, e.g. "0.0.0.0/0" or "fc00::/64".');
    }
    const vrfVal = vrf || null;
    if (!isEdit && existing.some((r) => staticRouteKey(r) === staticRouteKey({ vrf: vrfVal, prefix: trimmedPrefix }))) {
      return setError(`A route for ${trimmedPrefix} already exists in this VRF — edit it instead.`);
    }
    if (hops.length === 0) return setError("Add at least one next hop.");

    const next_hops: StaticNextHop[] = [];
    for (const [i, h] of hops.entries()) {
      let distance: number | null = null;
      if (h.distance.trim()) {
        distance = Number(h.distance);
        if (!Number.isInteger(distance) || distance < 1 || distance > 255) {
          return setError(`Next hop ${i + 1}: distance must be a whole number between 1 and 255.`);
        }
      }
      if (h.kind === "blackhole") {
        next_hops.push({ gateway: null, interface: null, nexthop_vrf: null, blackhole: true, distance });
        continue;
      }
      const gateway = h.gateway.trim() || null;
      const iface = h.iface.trim() || null;
      if (h.kind === "gateway" && !gateway) {
        return setError(`Next hop ${i + 1}: enter a gateway IP.`);
      }
      if (h.kind === "interface" && !iface) {
        return setError(`Next hop ${i + 1}: enter an egress interface.`);
      }
      next_hops.push({
        gateway: h.kind === "gateway" ? gateway : null,
        interface: iface,
        nexthop_vrf: h.nexthopVrf || null,
        blackhole: false,
        distance,
      });
    }

    setSaving(true);
    try {
      await putStaticRoute({ vrf: vrfVal, prefix: trimmedPrefix, next_hops });
      onSaved(isEdit ? `Saved route ${trimmedPrefix}.` : `Created route ${trimmedPrefix}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save route.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={680}>
      <ModalHeader
        title={isEdit ? "Edit static route" : "Create static route"}
        subtitle={isEdit ? `${initial!.prefix} (${initial!.vrf ?? "default VRF"})` : "Destination prefix and its next hops"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "2fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Destination <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="0.0.0.0/0"
              disabled={isEdit}
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">VRF</label>
            <select
              value={vrf}
              onChange={(e) => setVrf(e.target.value)}
              disabled={isEdit}
              className={`${inputCls} disabled:opacity-60`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="">default</option>
              {vrfs.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-[12px] text-[var(--qz-fg-3)]">
              Next hops <span className="text-[var(--qz-fg-4)]">(multiple = ECMP)</span>
            </label>
            <button
              type="button"
              onClick={() => setHops((p) => [...p, toDraft(emptyNextHop())])}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--qz-accent)] bg-transparent border-0 cursor-pointer p-0"
            >
              <Plus size={13} /> Add next hop
            </button>
          </div>

          {hops.map((h, i) => (
            <div
              key={i}
              className="rounded-lg p-3 flex flex-col gap-3"
              style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
            >
              <div className="flex items-center gap-3">
                <select
                  value={h.kind}
                  onChange={(e) => setHop(i, { kind: e.target.value as HopDraft["kind"] })}
                  className={inputCls}
                  style={{ ...inputSt, width: 130 }}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                >
                  <option value="gateway">Gateway</option>
                  <option value="interface">Interface</option>
                  <option value="blackhole">Blackhole</option>
                </select>

                {h.kind !== "blackhole" && (
                  <>
                    {h.kind === "gateway" && (
                      <input
                        value={h.gateway}
                        onChange={(e) => setHop(i, { gateway: e.target.value })}
                        placeholder="Next-hop IP, e.g. 10.0.0.1"
                        className={inputCls}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                    )}
                    <input
                      value={h.iface}
                      onChange={(e) => setHop(i, { iface: e.target.value })}
                      placeholder={h.kind === "gateway" ? "Interface (optional)" : "Ethernet0 / Vlan10"}
                      className={inputCls}
                      style={monoSt}
                      onFocus={focusBorder}
                      onBlur={blurBorder}
                    />
                  </>
                )}

                <input
                  value={h.distance}
                  onChange={(e) => setHop(i, { distance: e.target.value })}
                  placeholder="Distance"
                  title="Administrative distance 1-255 (default 1)"
                  className={inputCls}
                  style={{ ...monoSt, width: 100, flexShrink: 0 }}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />

                <button
                  type="button"
                  onClick={() => setHops((p) => p.filter((_, j) => j !== i))}
                  title="Remove next hop"
                  className="flex-shrink-0 p-2 rounded-md bg-transparent border-0 cursor-pointer text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)]"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              {h.kind === "gateway" && vrfs.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-[12px] text-[var(--qz-fg-4)] flex-shrink-0">
                    Resolve gateway in VRF
                  </label>
                  <select
                    value={h.nexthopVrf}
                    onChange={(e) => setHop(i, { nexthopVrf: e.target.value })}
                    className={inputCls}
                    style={{ ...inputSt, width: 180 }}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  >
                    <option value="">same as route</option>
                    <option value="default">default</option>
                    {vrfs.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ))}
        </div>

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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create route"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
