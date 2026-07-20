"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { setDeviceFolder, type Device, type DeviceFolder } from "@/lib/api";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;

/// Move an allocated device into one of its sub-organization's folders, or back
/// to Ungrouped. Only folders belonging to the device's sub-org are offered.
export function MoveDeviceFolderModal({
  orgGuid,
  device,
  folders,
  onClose,
  onDone,
}: {
  orgGuid: string;
  device: Device;
  /** Folders of the device's sub-organization. */
  folders: DeviceFolder[];
  onClose: () => void;
  /** Called after a successful change with a toast-able summary. */
  onDone: (message: string) => void;
}) {
  const [target, setTarget] = useState(device.folder_id ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await setDeviceFolder(orgGuid, device.device_id, target || null);
      const destination = target
        ? folders.find((f) => f.id === target)?.name ?? "the folder"
        : "Ungrouped";
      onDone(`Moved ${device.device_id} to ${destination}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move the device.");
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={480}>
      <ModalHeader
        title="Move to Folder"
        subtitle={`Choose a folder for ${device.device_id}`}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Folder</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={`${inputCls} cursor-pointer`}
            style={inputSt}
          >
            <option value="">Ungrouped</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {folders.length === 0 && (
            <p className="text-[11px] text-[var(--qz-fg-4)] m-0 mt-[5px]">
              No folders yet — create one with “New folder”.
            </p>
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
            {saving ? "Saving…" : "Move device"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
