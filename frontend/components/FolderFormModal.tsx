"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { createFolder, renameFolder, type DeviceFolder } from "@/lib/api";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Create a new folder in a sub-organization, or rename an existing one (pass
/// `folder`). Folders group the firewalls allocated to the sub-org.
export function FolderFormModal({
  orgGuid,
  subGuid,
  subName,
  folder,
  onClose,
  onSaved,
}: {
  orgGuid: string;
  subGuid: string;
  subName?: string;
  /** When set, the modal renames this folder instead of creating a new one. */
  folder?: DeviceFolder;
  onClose: () => void;
  /** Called after a successful save with a toast-able summary. */
  onSaved: (message: string) => void;
}) {
  const editing = folder != null;
  const [name, setName] = useState(folder?.name ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const updated = await renameFolder(orgGuid, subGuid, folder.id, trimmed);
        onSaved(`Renamed folder to ${updated.name}.`);
      } else {
        const created = await createFolder(orgGuid, subGuid, trimmed);
        onSaved(`Created folder ${created.name}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the folder.");
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={480}>
      <ModalHeader
        title={editing ? "Rename Folder" : "New Folder"}
        subtitle={
          editing
            ? "Rename this folder"
            : subName
              ? `Group firewalls in ${subName}`
              : "Group firewalls in this sub-organization"
        }
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="HQ, Reno Branch, …"
            autoComplete="off"
            autoFocus
            className={inputCls}
            style={inputSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
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
            {saving ? "Saving…" : editing ? "Save changes" : "Create folder"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
