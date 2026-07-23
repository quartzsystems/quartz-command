"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { StaticFdbEntry, normalizeMac, putStaticFdbEntry } from "@/lib/device/sonic-fdb";
import { SwitchVlan } from "@/lib/device/switching";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Create or edit a static MAC entry (pin a MAC to a port in a VLAN). The
/// entry is keyed by VLAN + MAC, so those are immutable when editing —
/// re-pinning to a different port is the edit; a different MAC is a new
/// entry. Saves through the agent's `PUT /api/switching/fdb/static/...`.
export function StaticMacFormModal({
  initial,
  existing,
  vlans,
  memberCandidates,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  initial?: StaticFdbEntry;
  /** All current static entries, for duplicate detection. */
  existing: StaticFdbEntry[];
  /** Configured VLANs for the VLAN picker. */
  vlans: SwitchVlan[];
  /** Port and port-channel names for the port picker. */
  memberCandidates: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;

  const [vlanId, setVlanId] = useState(initial ? String(initial.vlan_id) : "");
  const [mac, setMac] = useState(initial?.mac ?? "");
  const [port, setPort] = useState(initial?.port ?? "");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (vlanId === "") return setError("Pick the VLAN.");
    const normalized = normalizeMac(mac);
    if (!normalized) return setError("Enter a valid MAC address (e.g. 00:11:22:33:44:55).");
    if (!port) return setError("Pick the port the MAC is pinned to.");
    const vid = Number(vlanId);
    if (
      !isEdit &&
      existing.some((s) => s.vlan_id === vid && s.mac === normalized)
    ) {
      return setError(`A static entry for ${normalized} in VLAN ${vid} already exists.`);
    }

    setSaving(true);
    try {
      await putStaticFdbEntry({ vlan_id: vid, mac: normalized, port });
      onSaved(`Saved static MAC ${normalized}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save static MAC entry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={isEdit ? "Edit Static MAC" : "Add Static MAC"}
        subtitle={isEdit ? `${initial!.mac} · VLAN ${initial!.vlan_id}` : "Pin a MAC address to a port"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 2fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              VLAN <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <select
              value={vlanId}
              onChange={(e) => setVlanId(e.target.value)}
              disabled={isEdit}
              className={`${inputCls} cursor-pointer disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              {vlanId === "" && <option value="">Select…</option>}
              {vlans.map((v) => (
                <option key={v.vlan_id} value={String(v.vlan_id)}>
                  {v.description ? `${v.vlan_id} — ${v.description}` : v.vlan_id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              MAC Address <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <input
              value={mac}
              onChange={(e) => setMac(e.target.value)}
              disabled={isEdit}
              placeholder="00:11:22:33:44:55"
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
            Port <span style={{ color: "var(--qz-danger)" }}>*</span>
          </label>
          <select
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className={`${inputCls} cursor-pointer`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          >
            {port === "" && <option value="">Select…</option>}
            {[...new Set([...memberCandidates, ...(initial ? [initial.port] : [])])].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add entry"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
