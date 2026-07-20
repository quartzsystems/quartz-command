"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { allocateDevice, type Device, type SubOrganization } from "@/lib/api";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;

/// Allocate a device to a sub-organization, move it between
/// sub-organizations, or return it to the top-level unallocated pool.
export function AllocateDeviceModal({
  orgGuid,
  device,
  subs,
  onClose,
  onDone,
}: {
  orgGuid: string;
  device: Device;
  subs: SubOrganization[];
  onClose: () => void;
  /** Called after a successful change with a toast-able summary. */
  onDone: (message: string) => void;
}) {
  const [target, setTarget] = useState(device.sub_org_id ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await allocateDevice(orgGuid, device.device_id, target || null);
      const destination = target
        ? subs.find((s) => s.id === target)?.name ?? "the sub-organization"
        : "the unallocated pool";
      onDone(`Moved ${device.device_id} to ${destination}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the allocation.");
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={480}>
      <ModalHeader
        title="Allocate Device"
        subtitle={`Choose where ${device.device_id} belongs`}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Allocate to</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={`${inputCls} cursor-pointer`}
            style={inputSt}
          >
            <option value="">Unallocated (top level)</option>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
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
            {saving ? "Saving…" : "Save allocation"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
