"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import {
  SonicPrefixFamily,
  SonicPrefixList,
  SonicPrefixRule,
  putPrefixList,
} from "@/lib/device/sonic-routing-policy";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

interface RuleDraft {
  seq: string;
  action: "permit" | "deny";
  prefix: string;
  ge: string;
  le: string;
}

function toDraft(r: SonicPrefixRule): RuleDraft {
  return {
    seq: String(r.seq),
    action: r.action,
    prefix: r.prefix,
    ge: r.ge != null ? String(r.ge) : "",
    le: r.le != null ? String(r.le) : "",
  };
}

function nextSeq(rules: RuleDraft[]): string {
  const max = rules.reduce((m, r) => Math.max(m, Number(r.seq) || 0), 0);
  return String(max + 5 || 5);
}

/// Create or edit a prefix list. Saving replaces the whole rule set.
export function SonicPrefixListFormModal({
  initial,
  existing,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  initial?: SonicPrefixList;
  existing: SonicPrefixList[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [family, setFamily] = useState<SonicPrefixFamily>(initial?.family ?? "ipv4");
  const [rules, setRules] = useState<RuleDraft[]>(
    initial ? initial.rules.map(toDraft) : [{ seq: "5", action: "permit", prefix: "", ge: "", le: "" }],
  );

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const setRule = (i: number, patch: Partial<RuleDraft>) =>
    setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const maxLen = family === "ipv4" ? 32 : 128;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const trimmed = name.trim();
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
      return setError("Name may only contain letters, digits, dot, dash, and underscore.");
    }
    if (!isEdit && existing.some((l) => l.name === trimmed)) {
      return setError(`${trimmed} already exists.`);
    }
    if (rules.length === 0) return setError("Add at least one rule.");

    const parsed: SonicPrefixRule[] = [];
    const seqs = new Set<number>();
    for (const [i, r] of rules.entries()) {
      const seq = Number(r.seq);
      if (!Number.isInteger(seq) || seq < 1 || seq > 4294967294) {
        return setError(`Rule ${i + 1}: sequence must be a positive whole number.`);
      }
      if (seqs.has(seq)) return setError(`Rule ${i + 1}: sequence ${seq} is used twice.`);
      seqs.add(seq);
      if (!r.prefix.trim().includes("/")) {
        return setError(`Rule ${i + 1}: prefix must be a CIDR, e.g. "10.0.0.0/8".`);
      }
      let ge: number | null = null;
      let le: number | null = null;
      if (r.ge.trim()) {
        ge = Number(r.ge);
        if (!Number.isInteger(ge) || ge < 0 || ge > maxLen) {
          return setError(`Rule ${i + 1}: ge must be between 0 and ${maxLen}.`);
        }
      }
      if (r.le.trim()) {
        le = Number(r.le);
        if (!Number.isInteger(le) || le < 0 || le > maxLen) {
          return setError(`Rule ${i + 1}: le must be between 0 and ${maxLen}.`);
        }
      }
      parsed.push({ seq, action: r.action, prefix: r.prefix.trim(), ge, le });
    }
    parsed.sort((a, b) => a.seq - b.seq);

    setSaving(true);
    try {
      await putPrefixList({ name: trimmed, family, rules: parsed });
      onSaved(isEdit ? `Saved prefix-list ${trimmed}.` : `Created prefix-list ${trimmed}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save prefix-list.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={680}>
      <ModalHeader
        title={isEdit ? "Edit prefix-list" : "Create prefix-list"}
        subtitle={isEdit ? initial!.name : "Named set of prefixes for route filtering"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "2fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Name <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="LAN-PREFIXES"
              disabled={isEdit}
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Family</label>
            <select
              value={family}
              onChange={(e) => setFamily(e.target.value as SonicPrefixFamily)}
              disabled={isEdit}
              className={`${inputCls} disabled:opacity-60`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="ipv4">IPv4</option>
              <option value="ipv6">IPv6</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-[12px] text-[var(--qz-fg-3)]">Rules</label>
            <button
              type="button"
              onClick={() =>
                setRules((p) => [...p, { seq: nextSeq(p), action: "permit", prefix: "", ge: "", le: "" }])
              }
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--qz-accent)] bg-transparent border-0 cursor-pointer p-0"
            >
              <Plus size={13} /> Add rule
            </button>
          </div>

          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={r.seq}
                onChange={(e) => setRule(i, { seq: e.target.value })}
                placeholder="Seq"
                title="Sequence number — rules are evaluated in order"
                className={inputCls}
                style={{ ...monoSt, width: 70, flexShrink: 0 }}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
              <select
                value={r.action}
                onChange={(e) => setRule(i, { action: e.target.value as "permit" | "deny" })}
                className={inputCls}
                style={{ ...inputSt, width: 100, flexShrink: 0 }}
                onFocus={focusBorder}
                onBlur={blurBorder}
              >
                <option value="permit">permit</option>
                <option value="deny">deny</option>
              </select>
              <input
                value={r.prefix}
                onChange={(e) => setRule(i, { prefix: e.target.value })}
                placeholder={family === "ipv4" ? "10.0.0.0/8" : "fc00::/7"}
                className={inputCls}
                style={monoSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
              <input
                value={r.ge}
                onChange={(e) => setRule(i, { ge: e.target.value })}
                placeholder="ge"
                title={`Match mask length >= this (0-${maxLen})`}
                className={inputCls}
                style={{ ...monoSt, width: 64, flexShrink: 0 }}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
              <input
                value={r.le}
                onChange={(e) => setRule(i, { le: e.target.value })}
                placeholder="le"
                title={`Match mask length <= this (0-${maxLen})`}
                className={inputCls}
                style={{ ...monoSt, width: 64, flexShrink: 0 }}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
              <button
                type="button"
                onClick={() => setRules((p) => p.filter((_, j) => j !== i))}
                title="Remove rule"
                className="flex-shrink-0 p-2 rounded-md bg-transparent border-0 cursor-pointer text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)]"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create prefix-list"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
