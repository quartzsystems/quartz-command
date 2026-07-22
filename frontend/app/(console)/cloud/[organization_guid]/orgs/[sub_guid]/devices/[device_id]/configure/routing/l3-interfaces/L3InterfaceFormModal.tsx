"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import {
  L3Interface,
  createLoopback,
  updateL3Interface,
} from "@/lib/device/sonic-routing";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

interface ListRow {
  key: string;
  value: string;
}

let keyCounter = 0;
const nextKey = () => `l3-row-${keyCounter++}`;
const toRows = (values: string[]): ListRow[] => values.map((value) => ({ key: nextKey(), value }));

/// Edit an interface's L3 config (VRF binding + address set), or create a
/// new loopback. Moving an interface between VRFs re-creates its address
/// rows on the device, which briefly interrupts routing on the interface.
export function L3InterfaceFormModal({
  iface,
  existing,
  vrfNames,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating a loopback. */
  iface?: L3Interface;
  existing: L3Interface[];
  vrfNames: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!iface;

  const [name, setName] = useState(iface?.name ?? "");
  const [vrf, setVrf] = useState(iface?.vrf ?? "");
  const [addresses, setAddresses] = useState<ListRow[]>(toRows(iface?.ip_addresses ?? []));

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const vrfChanged = isEdit && (iface!.vrf ?? "") !== vrf;

  const addRow = () => setAddresses((p) => [...p, { key: nextKey(), value: "" }]);
  const removeRow = (key: string) => setAddresses((p) => p.filter((r) => r.key !== key));
  const updateRow = (key: string, value: string) =>
    setAddresses((p) => p.map((r) => (r.key === key ? { ...r, value } : r)));

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const trimmed = name.trim();
    if (!isEdit) {
      if (!/^Loopback\d+$/.test(trimmed)) {
        return setError('Loopback name must look like "Loopback0".');
      }
      if (existing.some((i) => i.name === trimmed)) {
        return setError(`${trimmed} already exists.`);
      }
    }

    const input = {
      vrf: vrf || null,
      ip_addresses: addresses.map((a) => a.value.trim()).filter(Boolean),
    };

    setSaving(true);
    try {
      if (isEdit) {
        await updateL3Interface(iface!.name, input);
        onSaved(`Saved ${iface!.name}.`);
      } else {
        await createLoopback(trimmed, input);
        onSaved(`Created ${trimmed}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save L3 interface.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={isEdit ? "Edit L3 Interface" : "Create Loopback"}
        subtitle={isEdit ? iface!.name : "Router loopback interface"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        {!isEdit && (
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Name <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Loopback0"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        )}

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">VRF</label>
          <select
            value={vrf}
            onChange={(e) => setVrf(e.target.value)}
            className={`${inputCls} cursor-pointer`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          >
            <option value="">default</option>
            {/* Keep the current VRF selectable even if it no longer exists. */}
            {(vrf && !vrfNames.includes(vrf) ? [vrf, ...vrfNames] : vrfNames).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {vrfChanged && (
            <p className="text-[12px] m-0 mt-[6px]" style={{ color: "var(--qz-warn)" }}>
              Changing the VRF re-creates this interface&apos;s addresses under the new binding and
              briefly interrupts routing on it.
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-[6px]">
            <label className="block text-[12px] text-[var(--qz-fg-3)]">IP Addresses</label>
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-[5px] text-[12px] text-[var(--qz-fg-3)] hover:text-[var(--qz-accent)] transition-colors cursor-pointer bg-transparent border-0 p-0"
            >
              <Plus size={13} /> Add
            </button>
          </div>
          {addresses.length === 0 ? (
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0">
              No addresses — the interface carries no L3 config.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {addresses.map((r) => (
                <div key={r.key} className="flex items-center gap-2">
                  <input
                    value={r.value}
                    onChange={(e) => updateRow(r.key, e.target.value)}
                    placeholder="10.0.0.1/31 or fc00::1/126"
                    className={inputCls}
                    style={monoSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(r.key)}
                    title="Remove"
                    className="grid place-items-center w-9 h-9 flex-shrink-0 rounded-md text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)] transition-colors cursor-pointer bg-transparent"
                    style={{ border: "1px solid var(--qz-border)" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create loopback"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
