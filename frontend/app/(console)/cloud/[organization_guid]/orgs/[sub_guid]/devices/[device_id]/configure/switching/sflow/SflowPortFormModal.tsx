"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { SflowPort, updateSflowPort } from "@/lib/device/sonic-sflow";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Edit one port's sFlow session: sampling on/off and the 1-in-N sample
/// rate. Saves through the agent's `PUT /api/switching/sflow/ports/{name}`.
export function SflowPortFormModal({
  port,
  onClose,
  onSaved,
}: {
  port: SflowPort;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(port.enabled);
  const [rate, setRate] = useState(port.sample_rate != null ? String(port.sample_rate) : "");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    let sampleRate: number | null = null;
    if (rate.trim() !== "") {
      sampleRate = Number(rate);
      if (!Number.isInteger(sampleRate) || sampleRate < 256 || sampleRate > 8388608) {
        return setError("Sample rate must be a whole number between 256 and 8388608.");
      }
    }

    setSaving(true);
    try {
      await updateSflowPort(port.name, { enabled, sample_rate: sampleRate });
      onSaved(`Saved sFlow on ${port.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save sFlow session.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title="Edit sFlow Session"
        subtitle={port.alias ? `${port.name} · ${port.alias}` : port.name}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex items-center gap-[10px] cursor-pointer select-none">
          <Switch on={enabled} onChange={setEnabled} />
          <span className="text-[13px] text-[var(--qz-fg-2)]">Sample this port</span>
        </label>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
            Sample Rate (1 in N packets)
          </label>
          <input
            type="number"
            min={256}
            max={8388608}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="Speed-based default"
            className={inputCls}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
          <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[6px]">
            Empty uses the image's speed-based default (e.g. 1-in-10000 on a 10G port).
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
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
