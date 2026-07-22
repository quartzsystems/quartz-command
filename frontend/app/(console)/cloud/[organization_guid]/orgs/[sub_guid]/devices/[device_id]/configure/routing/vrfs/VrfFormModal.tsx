"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { Vrf, createVrf, updateVrf } from "@/lib/device/sonic-routing";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Create or edit a data VRF. SONiC requires names to start with "Vrf";
/// interface binding happens on the L3 Interfaces page.
export function VrfFormModal({
  initial,
  existing,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  initial?: Vrf;
  existing: Vrf[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? "Vrf");
  const [fallback, setFallback] = useState(initial?.fallback ?? false);
  const [vni, setVni] = useState(initial?.vni != null ? String(initial.vni) : "");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const trimmed = name.trim();
    if (!isEdit) {
      if (!/^Vrf[a-zA-Z0-9_-]+$/.test(trimmed)) {
        return setError('VRF name must start with "Vrf", e.g. "VrfBlue".');
      }
      if (existing.some((v) => v.name === trimmed)) {
        return setError(`${trimmed} already exists.`);
      }
    }

    let vniNum: number | null = null;
    if (vni.trim()) {
      vniNum = Number(vni);
      if (!Number.isInteger(vniNum) || vniNum < 1 || vniNum > 16777215) {
        return setError("VNI must be a whole number between 1 and 16777215.");
      }
    }

    setSaving(true);
    try {
      const input = { fallback, vni: vniNum };
      if (isEdit) {
        await updateVrf(initial!.name, input);
        onSaved(`Saved ${initial!.name}.`);
      } else {
        await createVrf(trimmed, input);
        onSaved(`Created ${trimmed}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save VRF.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={isEdit ? "Edit VRF" : "Create VRF"}
        subtitle={isEdit ? initial!.name : "Virtual routing and forwarding instance"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
            Name <span style={{ color: "var(--qz-danger)" }}>*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VrfBlue"
            disabled={isEdit}
            className={`${inputCls} disabled:opacity-60`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </div>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">L3 VNI</label>
          <input
            type="number"
            min={1}
            max={16777215}
            value={vni}
            onChange={(e) => setVni(e.target.value)}
            placeholder="None (no EVPN)"
            className={inputCls}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">Fallback lookup</p>
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
              Fall back to the default VRF&apos;s routes when a lookup misses
            </p>
          </div>
          <Switch on={fallback} onChange={setFallback} />
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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create VRF"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
