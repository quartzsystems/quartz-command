"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import {
  AaaProtocol,
  AaaServer,
  createAaaServer,
  updateAaaServer,
} from "@/lib/device/sonic-aaa";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Add or edit one TACACS+/RADIUS server. The per-server secret is
/// write-only; blank leaves it unchanged (falling back to the global secret
/// if none was ever set).
export function AaaServerFormModal({
  protocol,
  initial,
  existingAddresses,
  onClose,
  onSaved,
}: {
  protocol: AaaProtocol;
  /** Present when editing; absent when creating. */
  initial?: AaaServer;
  existingAddresses: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;
  const label = protocol === "tacacs" ? "TACACS+" : "RADIUS";
  const defaultPort = protocol === "tacacs" ? 49 : 1812;

  const [address, setAddress] = useState(initial?.address ?? "");
  const [priority, setPriority] = useState(initial?.priority != null ? String(initial.priority) : "");
  const [port, setPort] = useState(initial?.port != null ? String(initial.port) : "");
  const [timeout_, setTimeout_] = useState(initial?.timeout != null ? String(initial.timeout) : "");
  const [key, setKey] = useState("");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const addr = address.trim();
    if (!addr) return setError("Enter the server's IP or hostname.");
    if (!isEdit && existingAddresses.includes(addr)) {
      return setError(`${addr} is already configured.`);
    }

    const parseOpt = (v: string, name: string, min: number, max: number): number | null => {
      if (!v.trim()) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        throw new Error(`${name} must be a whole number between ${min} and ${max}.`);
      }
      return n;
    };

    setSaving(true);
    try {
      const input = {
        priority: parseOpt(priority, "Priority", 1, 64),
        port: parseOpt(port, "Port", 1, 65535),
        timeout: parseOpt(timeout_, "Timeout", 1, 60),
        key: key || null,
      };
      if (isEdit) {
        await updateAaaServer(protocol, initial!.address, input);
        onSaved(`Saved ${initial!.address}.`);
      } else {
        await createAaaServer(protocol, addr, input);
        onSaved(`Added ${addr}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save server.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={isEdit ? `Edit ${label} server` : `Add ${label} server`}
        subtitle={isEdit ? initial!.address : `Remote ${label} authentication server`}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
            Server <span style={{ color: "var(--qz-danger)" }}>*</span>
          </label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="10.0.0.20"
            disabled={isEdit}
            className={`${inputCls} disabled:opacity-60`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Priority</label>
            <input
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              placeholder="1 (default)"
              title="Lower priority is tried first"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Port</label>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder={`${defaultPort} (default)`}
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Timeout (s)</label>
            <input
              value={timeout_}
              onChange={(e) => setTimeout_(e.target.value)}
              placeholder="global"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
            Shared secret{" "}
            <span className="text-[var(--qz-fg-4)]">
              ({initial?.key_set ? "set — leave blank to keep" : "blank = use global secret"})
            </span>
          </label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={initial?.key_set ? "Unchanged" : "Per-server secret (optional)"}
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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add server"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
