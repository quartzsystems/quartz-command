"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import {
  SonicUser,
  SonicUserRole,
  createSystemUser,
  updateSystemUser,
} from "@/lib/device/sonic-system";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Create or edit a local switch login. Passwords are write-only; editing
/// with a blank password leaves the current one unchanged.
export function SonicUserFormModal({
  initial,
  existingNames,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  initial?: SonicUser;
  existingNames: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState<SonicUserRole>(initial?.role ?? "operator");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const trimmed = name.trim();
    if (!isEdit) {
      if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(trimmed)) {
        return setError("Username must be lowercase letters, digits, dash, or underscore (max 32).");
      }
      if (existingNames.includes(trimmed)) {
        return setError(`${trimmed} already exists.`);
      }
      if (password.length < 8) {
        return setError("Password must be at least 8 characters.");
      }
    }
    if (password && password.length < 8) {
      return setError("Password must be at least 8 characters.");
    }
    if (password !== confirm) {
      return setError("Passwords don't match.");
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateSystemUser(initial!.name, role, password || null);
        onSaved(`Saved ${initial!.name}.`);
      } else {
        await createSystemUser(trimmed, role, password);
        onSaved(`Created ${trimmed}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save user.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={isEdit ? "Edit user" : "Add user"}
        subtitle={isEdit ? initial!.name : "Local login account on the switch"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
            Username <span style={{ color: "var(--qz-danger)" }}>*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="jsmith"
            disabled={isEdit}
            className={`${inputCls} disabled:opacity-60`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </div>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as SonicUserRole)}
            disabled={initial?.builtin}
            className={`${inputCls} disabled:opacity-60`}
            style={inputSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          >
            <option value="admin">Admin — full configuration access</option>
            <option value="operator">Operator — read-only</option>
          </select>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Password {!isEdit && <span style={{ color: "var(--qz-danger)" }}>*</span>}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? "Unchanged" : ""}
              className={inputCls}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Confirm</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputCls}
              style={inputSt}
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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add user"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
