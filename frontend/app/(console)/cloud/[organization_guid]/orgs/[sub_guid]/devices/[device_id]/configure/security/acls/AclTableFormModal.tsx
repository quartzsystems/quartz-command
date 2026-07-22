"use client";

import { useEffect, useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { shortInterfaceName, fetchSwitchPorts, fetchPortChannels, fetchVlans } from "@/lib/device/switching";
import {
  AclStage,
  AclTable,
  AclTableType,
  createAclTable,
  updateAclTable,
} from "@/lib/device/sonic-acl";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Create or edit an ACL table: name, type, stage, description, and the
/// interfaces it filters. Rules are managed on the page after creation.
export function AclTableFormModal({
  initial,
  existingNames,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  initial?: AclTable;
  existingNames: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<AclTableType>(initial?.type ?? "L3");
  const [stage, setStage] = useState<AclStage>(initial?.stage ?? "ingress");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [ports, setPorts] = useState<string[]>(initial?.ports ?? []);

  // Bindable interfaces, loaded live; tolerate failure (free-form binding
  // is still possible on the agent side, we just can't offer a picker).
  const [bindable, setBindable] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      const [sw, pcs, vlans] = await Promise.all([
        fetchSwitchPorts().catch(() => []),
        fetchPortChannels().catch(() => []),
        fetchVlans().catch(() => []),
      ]);
      setBindable([
        ...sw.map((p) => p.name),
        ...pcs.map((p) => p.name),
        ...vlans.map((v) => v.name),
      ]);
    })();
  }, []);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const togglePort = (p: string) =>
    setPorts((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const trimmed = name.trim().toUpperCase();
    if (!isEdit) {
      if (!/^[A-Z0-9_-]+$/.test(trimmed)) {
        return setError("Name may only contain letters, digits, dash, and underscore.");
      }
      if (existingNames.includes(trimmed)) {
        return setError(`${trimmed} already exists.`);
      }
    }

    setSaving(true);
    try {
      const input = { type, stage, description: description.trim() || null, ports };
      if (isEdit) {
        await updateAclTable(initial!.name, input);
        onSaved(`Saved ACL ${initial!.name}.`);
      } else {
        await createAclTable(trimmed, input);
        onSaved(`Created ACL ${trimmed}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save ACL.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={620}>
      <ModalHeader
        title={isEdit ? "Edit ACL" : "Create ACL"}
        subtitle={isEdit ? initial!.name : "Packet filter table bound to switch interfaces"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Name <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="SERVER-PROTECT"
              disabled={isEdit}
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AclTableType)}
              disabled={isEdit}
              title={isEdit ? "The match type is fixed after creation" : undefined}
              className={`${inputCls} disabled:opacity-60`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="L3">IPv4</option>
              <option value="L3V6">IPv6</option>
              <option value="MAC">MAC</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Stage</label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as AclStage)}
              className={inputCls}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="ingress">Ingress</option>
              <option value="egress">Egress</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this ACL protects"
            className={inputCls}
            style={inputSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </div>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
            Bound interfaces <span className="text-[var(--qz-fg-4)]">({ports.length} selected)</span>
          </label>
          {bindable.length === 0 ? (
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0">Loading interfaces…</p>
          ) : (
            <div
              className="rounded-md p-2 grid gap-1 max-h-[220px] overflow-auto"
              style={{
                background: "var(--qz-input-bg)",
                border: "1px solid var(--qz-border)",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              }}
            >
              {bindable.map((p) => (
                <label
                  key={p}
                  className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-[12.5px] text-[var(--qz-fg-2)] hover:bg-[color-mix(in_oklab,white_4%,transparent)]"
                  style={{ fontFamily: "var(--qz-font-mono)" }}
                  title={p}
                >
                  <input
                    type="checkbox"
                    checked={ports.includes(p)}
                    onChange={() => togglePort(p)}
                  />
                  {shortInterfaceName(p)}
                </label>
              ))}
            </div>
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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create ACL"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
