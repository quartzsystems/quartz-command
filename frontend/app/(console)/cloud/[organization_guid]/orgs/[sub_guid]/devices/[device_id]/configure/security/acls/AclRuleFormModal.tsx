"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { AclAction, AclRule, AclTable, putAclRule } from "@/lib/device/sonic-acl";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const PORT_RE = /^\d{1,5}(-\d{1,5})?$/;

/// Create or edit one rule in an ACL table. The priority is the rule's
/// identity: changing it on edit creates a new rule slot (the agent upserts
/// by priority), so it stays fixed while editing.
export function AclRuleFormModal({
  table,
  initial,
  onClose,
  onSaved,
}: {
  table: AclTable;
  /** Present when editing; absent when creating. */
  initial?: AclRule;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;
  const isMac = table.type === "MAC";

  const nextPriority = () => {
    const used = table.rules.map((r) => r.priority);
    const max = used.length ? Math.max(...used) : 0;
    return String(max + 10);
  };

  const [priority, setPriority] = useState(initial ? String(initial.priority) : nextPriority());
  const [action, setAction] = useState<AclAction>(initial?.action ?? "forward");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [src, setSrc] = useState(initial?.src ?? "");
  const [dst, setDst] = useState(initial?.dst ?? "");
  const [protocol, setProtocol] = useState(initial?.protocol ?? "");
  const [srcPort, setSrcPort] = useState(initial?.src_port ?? "");
  const [dstPort, setDstPort] = useState(initial?.dst_port ?? "");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const l4 = protocol === "tcp" || protocol === "udp";

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const prio = Number(priority);
    if (!Number.isInteger(prio) || prio < 1 || prio > 65535) {
      return setError("Priority must be a whole number between 1 and 65535.");
    }
    if (!isEdit && table.rules.some((r) => r.priority === prio)) {
      return setError(`Priority ${prio} is already used in ${table.name}.`);
    }
    if (l4) {
      if (srcPort.trim() && !PORT_RE.test(srcPort.trim())) {
        return setError('Source port must be a port or range, e.g. "22" or "1024-65535".');
      }
      if (dstPort.trim() && !PORT_RE.test(dstPort.trim())) {
        return setError('Destination port must be a port or range, e.g. "22" or "1024-65535".');
      }
    }

    setSaving(true);
    try {
      await putAclRule(table.name, {
        priority: prio,
        action,
        description: description.trim() || null,
        src: src.trim() || null,
        dst: dst.trim() || null,
        protocol: isMac ? null : protocol || null,
        src_port: l4 && srcPort.trim() ? srcPort.trim() : null,
        dst_port: l4 && dstPort.trim() ? dstPort.trim() : null,
      });
      onSaved(isEdit ? `Saved rule ${prio}.` : `Added rule ${prio}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rule.");
    } finally {
      setSaving(false);
    }
  };

  const addrPlaceholder = isMac
    ? "00:11:22:33:44:55"
    : table.type === "L3V6"
      ? "fc00::/64"
      : "10.0.0.0/24";

  return (
    <ModalShell onClose={onClose} maxWidth={620}>
      <ModalHeader
        title={isEdit ? "Edit rule" : "Add rule"}
        subtitle={`${table.name} — higher priority matches first, unmatched traffic is dropped`}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Priority <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <input
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              disabled={isEdit}
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Action</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as AclAction)}
              className={inputCls}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="forward">Forward (permit)</option>
              <option value="drop">Drop (deny)</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Source</label>
            <input
              value={src}
              onChange={(e) => setSrc(e.target.value)}
              placeholder={`${addrPlaceholder} (any)`}
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Destination</label>
            <input
              value={dst}
              onChange={(e) => setDst(e.target.value)}
              placeholder={`${addrPlaceholder} (any)`}
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        {!isMac && (
          <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div>
              <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Protocol</label>
              <select
                value={protocol}
                onChange={(e) => setProtocol(e.target.value)}
                className={inputCls}
                style={inputSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              >
                <option value="">any</option>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="icmp">ICMP</option>
              </select>
            </div>
            <div>
              <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Source port</label>
              <input
                value={srcPort}
                onChange={(e) => setSrcPort(e.target.value)}
                placeholder={l4 ? "any" : "n/a"}
                disabled={!l4}
                className={`${inputCls} disabled:opacity-60`}
                style={monoSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            </div>
            <div>
              <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Destination port</label>
              <input
                value={dstPort}
                onChange={(e) => setDstPort(e.target.value)}
                placeholder={l4 ? "any" : "n/a"}
                disabled={!l4}
                className={`${inputCls} disabled:opacity-60`}
                style={monoSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Why this rule exists"
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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add rule"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
