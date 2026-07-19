"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { createSubOrganization, type SubOrganization } from "@/lib/api";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Create a sub-organization under the current organization. The slug is
/// generated from the name by the backend, so the form is just a name.
export function SubOrgFormModal({
  orgGuid,
  orgName,
  onClose,
  onSaved,
}: {
  orgGuid: string;
  orgName?: string;
  onClose: () => void;
  /** Called after a successful create with a toast-able summary. */
  onSaved: (message: string, sub: SubOrganization) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    try {
      const sub = await createSubOrganization(orgGuid, name.trim());
      onSaved(`Created sub-organization ${sub.name}.`, sub);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the sub-organization.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={520}>
      <ModalHeader
        title="Create Sub-Organization"
        subtitle={orgName ? `A new organization under ${orgName}` : "A new organization under yours"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="West Coast Division"
            autoComplete="off"
            className={inputCls}
            style={inputSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
          <p className="text-[11px] text-[var(--qz-fg-4)] m-0 mt-[5px]">
            The URL slug is generated automatically from the name.
          </p>
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
            {saving ? "Creating…" : "Create sub-organization"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
