"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { addMember, ORG_ROLES, updateMember, type OrganizationMember } from "@/lib/adminApi";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-[var(--qz-fg-4)] m-0 mt-[5px]">{hint}</p>}
    </div>
  );
}

/// Add a user to the organization, or edit an existing member (display name,
/// role, password reset, active flag). On add, a known email just gains the
/// membership; an unknown email creates the account (password required).
export function MemberFormModal({
  organizationGuid,
  organizationName,
  initial,
  onClose,
  onSaved,
}: {
  organizationGuid: string;
  organizationName: string;
  /** Member being edited; undefined = add. */
  initial?: OrganizationMember;
  onClose: () => void;
  /** Called after a successful save with a toast-able summary. */
  onSaved: (message: string) => void;
}) {
  const isEdit = initial !== undefined;

  const [email, setEmail] = useState(initial?.email ?? "");
  const [fullName, setFullName] = useState(initial?.full_name ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<string>(initial?.role ?? "member");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const addr = email.trim();
    if (!isEdit && (!addr || !addr.includes("@"))) {
      setError("A valid email is required.");
      return;
    }
    if (password !== "" && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateMember(organizationGuid, initial.user_id, {
          role,
          full_name: fullName.trim(),
          password: password || undefined,
          is_active: isActive,
        });
        onSaved(`Updated ${initial.email}.`);
      } else {
        const member = await addMember(organizationGuid, {
          email: addr,
          full_name: fullName.trim() || undefined,
          password: password || undefined,
          role,
        });
        onSaved(`Added ${member.email} to ${organizationName}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the member.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={600}>
      <ModalHeader
        title={isEdit ? `Edit Member — ${initial.email}` : "Add Member"}
        subtitle={
          isEdit
            ? `Membership and account settings in ${organizationName}`
            : `Add a user to ${organizationName}`
        }
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              disabled={isEdit}
              autoComplete="off"
              className={inputCls}
              style={{ ...monoSt, opacity: isEdit ? 0.6 : 1 }}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </Field>
          <Field label="Full Name" hint="Optional display name.">
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane User"
              className={inputCls}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </Field>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Field
            label={isEdit ? "New Password" : "Password"}
            hint={
              isEdit
                ? "Leave empty to keep the current password."
                : "Only used when the email doesn't match an existing user — the account is then created with it (min 8 characters)."
            }
          >
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className={inputCls}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </Field>
          <Field label="Confirm Password">
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className={inputCls}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </Field>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Field label="Role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={`${inputCls} cursor-pointer`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              {ORG_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          {isEdit && (
            <Field label="Status" hint="Inactive accounts can't sign in anywhere.">
              <label className="flex items-center gap-2 py-[9px] cursor-pointer text-[13px] text-[var(--qz-fg-1)]">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="qz-check"
                />
                Active
              </label>
            </Field>
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
            {saving ? "Saving…" : isEdit ? "Apply changes" : "Add member"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
