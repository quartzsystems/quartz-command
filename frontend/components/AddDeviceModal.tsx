"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { PRODUCT_LABEL } from "@/components/inventory/common";
import {
  createEnrollmentToken,
  type CreatedEnrollmentToken,
  type Product,
} from "@/lib/api";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;

const EXPIRY_OPTIONS = [
  { hours: 1, label: "1 hour" },
  { hours: 8, label: "8 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
];

const USE_OPTIONS = [
  { value: "1", label: "Single device" },
  { value: "5", label: "Up to 5 devices" },
  { value: "25", label: "Up to 25 devices" },
  { value: "", label: "Unlimited" },
];

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// A code block with a copy button, used for the token string and the CLI
/// one-liner in the created-token view.
function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the text is selectable */
    }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-[6px]">
        <span className="text-[12px] text-[var(--qz-fg-3)]">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-[5px] text-[12px] bg-transparent border-0 p-0 cursor-pointer"
          style={{ color: copied ? "var(--qz-success)" : "var(--qz-fg-3)" }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className="m-0 rounded-md px-3 py-[10px] text-[12px] leading-relaxed overflow-x-auto"
        style={{
          background: "var(--qz-input-bg)",
          border: "1px solid var(--qz-border)",
          color: "var(--qz-fg-1)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {value}
      </pre>
    </div>
  );
}

/// "Add device" flow: create an enrollment token (expiry / use-count /
/// label), then show the QC1|… token string and the product's enroll
/// one-liner exactly once — the secret is not retrievable after this modal
/// closes. The token is scoped to a product line (QuartzFire / QuartzSONiC);
/// with a subOrgId it enrolls devices straight into that sub-organization
/// instead of the top-level unallocated pool.
export function AddDeviceModal({
  orgGuid,
  orgName,
  subOrgId,
  subOrgName,
  product,
  onClose,
  onSaved,
}: {
  orgGuid: string;
  orgName?: string;
  subOrgId?: string;
  subOrgName?: string;
  product: Product;
  onClose: () => void;
  /** Called after a successful create with a toast-able summary. */
  onSaved: (message: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [expiresHours, setExpiresHours] = useState("24");
  const [maxUses, setMaxUses] = useState("1");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CreatedEnrollmentToken | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const token = await createEnrollmentToken(orgGuid, {
        label: label.trim() || undefined,
        expires_hours: Number(expiresHours),
        max_uses: maxUses ? Number(maxUses) : undefined,
        sub_org_id: subOrgId,
        product,
      });
      setCreated(token);
      onSaved(`Created enrollment token ${token.token_id}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the enrollment token.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={600}>
      <ModalHeader
        title={created ? "Enrollment Token Created" : "Add Device"}
        subtitle={
          created
            ? "Copy it now — this token is shown only once."
            : subOrgName
              ? `Create a ${PRODUCT_LABEL[product]} enrollment token for ${subOrgName} — devices enroll straight into it`
              : orgName
                ? `Create a ${PRODUCT_LABEL[product]} enrollment token for ${orgName}`
                : `Create a ${PRODUCT_LABEL[product]} enrollment token`
        }
        onClose={onClose}
      />

      {created ? (
        <div className="flex flex-col gap-4">
          <CopyBlock label="Enrollment token" value={created.token} />
          {product === "quartzsonic" ? (
            <CopyBlock
              label="Run on the SONiC switch"
              value={`sudo quartz-sonic enroll '${created.token}'`}
            />
          ) : (
            <CopyBlock
              label="Run on the QuartzFire device"
              value={`set system quartz-command enroll-token '${created.token}'`}
            />
          )}
          <p className="text-[12px] m-0" style={{ color: "var(--qz-warn)" }}>
            The secret half of this token is stored only as a hash. Once this
            dialog closes it cannot be displayed again — revoke the token and
            create a new one if it is lost.
          </p>
          <div className="flex justify-end mt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-[9px] rounded-md text-[13px] font-semibold cursor-pointer border-0"
              style={{ background: "var(--qz-accent)", color: "var(--qz-fg-on-accent)" }}
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Label <span className="text-[var(--qz-fg-4)]">(optional)</span>
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Branch office rollout"
              autoComplete="off"
              className={inputCls}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Expires after</label>
              <select
                value={expiresHours}
                onChange={(e) => setExpiresHours(e.target.value)}
                className={`${inputCls} cursor-pointer`}
                style={inputSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.hours} value={o.hours}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Uses</label>
              <select
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className={`${inputCls} cursor-pointer`}
                style={inputSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              >
                {USE_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
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
              {saving ? "Creating…" : "Create token"}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}
