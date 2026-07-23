"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { VlanVniMap } from "@/lib/device/sonic-vxlan";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const monoSt = {
  background: "var(--qz-input-bg)",
  border: "1px solid var(--qz-border)",
  fontFamily: "var(--qz-font-mono)",
} as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Add or edit one VLAN↔VNI mapping. The page owns the write — this modal
/// hands back the full desired map set (the agent diffs VXLAN_TUNNEL_MAP).
export function VniMapFormModal({
  map,
  existing,
  onClose,
  onSave,
}: {
  /** null = create. On edit the VLAN is frozen (it is the row identity). */
  map: VlanVniMap | null;
  existing: VlanVniMap[];
  onClose: () => void;
  onSave: (next: VlanVniMap[], message: string) => Promise<void>;
}) {
  const [vlan, setVlan] = useState(map != null ? String(map.vlan_id) : "");
  const [vni, setVni] = useState(map != null ? String(map.vni) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const vlanId = Number(vlan);
    if (!Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094) {
      return setError("VLAN must be between 1 and 4094.");
    }
    const vniNum = Number(vni);
    if (!Number.isInteger(vniNum) || vniNum < 1 || vniNum > 16777215) {
      return setError("VNI must be between 1 and 16,777,215.");
    }
    if (map == null && existing.some((m) => m.vlan_id === vlanId)) {
      return setError(`VLAN ${vlanId} is already mapped — edit its row instead.`);
    }
    if (existing.some((m) => m.vni === vniNum && m.vlan_id !== (map?.vlan_id ?? vlanId))) {
      return setError(`VNI ${vniNum} is already used by another VLAN.`);
    }

    const next = map
      ? existing.map((m) => (m.vlan_id === map.vlan_id ? { vlan_id: m.vlan_id, vni: vniNum } : m))
      : [...existing, { vlan_id: vlanId, vni: vniNum }];

    setSaving(true);
    try {
      await onSave(next, `Mapped VLAN ${map?.vlan_id ?? vlanId} to VNI ${vniNum}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the mapping.");
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={420}>
      <ModalHeader
        title={map ? "Edit VNI Mapping" : "Add VNI Mapping"}
        subtitle={map ? `VLAN ${map.vlan_id}` : "Extend a VLAN into the VXLAN overlay"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">VLAN</label>
            <input
              type="number"
              min={1}
              max={4094}
              value={vlan}
              onChange={(e) => setVlan(e.target.value)}
              disabled={map != null}
              placeholder="10"
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">VNI</label>
            <input
              type="number"
              min={1}
              max={16777215}
              value={vni}
              onChange={(e) => setVni(e.target.value)}
              placeholder="10010"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
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
            {saving ? "Saving…" : map ? "Save changes" : "Add mapping"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
