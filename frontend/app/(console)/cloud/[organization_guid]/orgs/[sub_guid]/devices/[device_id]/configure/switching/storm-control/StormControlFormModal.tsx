"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { StormControlPort, updateStormControl } from "@/lib/device/sonic-storm-control";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const FIELDS: { key: "broadcast" | "unknown_unicast" | "unknown_multicast"; label: string }[] = [
  { key: "broadcast", label: "Broadcast" },
  { key: "unknown_unicast", label: "Unknown Unicast" },
  { key: "unknown_multicast", label: "Unknown Multicast" },
];

/// Edit one port's storm-control limits. Empty = no limit for that traffic
/// class (the agent removes the row). Saves through the agent's
/// `PUT /api/switching/storm-control/{port}`.
export function StormControlFormModal({
  port,
  onClose,
  onSaved,
}: {
  port: StormControlPort;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    broadcast: port.broadcast_kbps != null ? String(port.broadcast_kbps) : "",
    unknown_unicast: port.unknown_unicast_kbps != null ? String(port.unknown_unicast_kbps) : "",
    unknown_multicast: port.unknown_multicast_kbps != null ? String(port.unknown_multicast_kbps) : "",
  });

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const parsed: Record<string, number | null> = {};
    for (const f of FIELDS) {
      const raw = values[f.key].trim();
      if (raw === "") {
        parsed[f.key] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 100_000_000) {
        return setError(`${f.label} must be a whole number of kbps (0–100,000,000).`);
      }
      parsed[f.key] = n;
    }

    setSaving(true);
    try {
      await updateStormControl(port.port, {
        broadcast_kbps: parsed.broadcast,
        unknown_unicast_kbps: parsed.unknown_unicast,
        unknown_multicast_kbps: parsed.unknown_multicast,
      });
      onSaved(`Saved storm control on ${port.port}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save storm control.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title="Edit Storm Control"
        subtitle={port.alias ? `${port.port} · ${port.alias}` : port.port}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              {f.label} limit (kbps)
            </label>
            <input
              type="number"
              min={0}
              value={values[f.key]}
              onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
              placeholder="No limit"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        ))}

        <p className="text-[12px] text-[var(--qz-fg-4)] m-0">
          Traffic of each class above its limit is dropped in hardware. Leave a
          field empty to remove that limit.
        </p>

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
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
