"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { addSubOrgMember, type SubOrgMember } from "@/lib/api";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;

const ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
];

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Add a user to a sub-organization. An unknown email creates the account
/// (password required); a known email just gains the membership — the backend
/// ignores the password then, so existing credentials can't be reset here.
export function AddSubOrgUserModal({
  orgGuid,
  subGuid,
  subName,
  onClose,
  onSaved,
}: {
  orgGuid: string;
  subGuid: string;
  subName?: string;
  onClose: () => void;
  /** Called after a successful add with a toast-able summary. */
  onSaved: (message: string, member: SubOrgMember) => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    setSaving(true);
    try {
      const member = await addSubOrgMember(orgGuid, subGuid, {
        email: email.trim(),
        full_name: fullName.trim() || undefined,
        password: password || undefined,
        role,
      });
      onSaved(`Added ${member.email} to ${subName ?? "the sub-organization"}.`, member);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the user.");
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={520}>
      <ModalHeader
        title="Add User"
        subtitle={subName ? `Grant access to ${subName}` : "Grant access to this sub-organization"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            autoComplete="off"
            className={inputCls}
            style={inputSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Full name <span className="text-[var(--qz-fg-4)]">(optional)</span>
            </label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jordan Smith"
              autoComplete="off"
              className={inputCls}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div className="w-[140px]">
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={`${inputCls} cursor-pointer`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 8 characters"
            autoComplete="new-password"
            className={inputCls}
            style={inputSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
          <p className="text-[11px] text-[var(--qz-fg-4)] m-0 mt-[5px]">
            Required for a new account. Leave blank to add an existing user by email.
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
            {saving ? "Adding…" : "Add user"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
