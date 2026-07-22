"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { StpVlan, updateStpVlan } from "@/lib/device/stp";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const BRIDGE_PRIORITIES = Array.from({ length: 16 }, (_, i) => i * 4096);

/// Per-VLAN spanning tree instance: enable/disable plus optional priority
/// and timer overrides — blank fields inherit the global bridge values.
export function StpVlanFormModal({
  vlan,
  onClose,
  onSaved,
}: {
  vlan: StpVlan;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(vlan.enabled);
  const [priority, setPriority] = useState(vlan.priority != null ? String(vlan.priority) : "");
  const [forwardDelay, setForwardDelay] = useState(
    vlan.forward_delay != null ? String(vlan.forward_delay) : "",
  );
  const [helloTime, setHelloTime] = useState(vlan.hello_time != null ? String(vlan.hello_time) : "");
  const [maxAge, setMaxAge] = useState(vlan.max_age != null ? String(vlan.max_age) : "");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const optInt = (label: string, raw: string, min: number, max: number): number | null | string => {
    if (!raw.trim()) return null;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < min || v > max) {
      return `${label} must be a whole number between ${min} and ${max}.`;
    }
    return v;
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const fd = optInt("Forward delay", forwardDelay, 4, 30);
    if (typeof fd === "string") return setError(fd);
    const hello = optInt("Hello time", helloTime, 1, 10);
    if (typeof hello === "string") return setError(hello);
    const age = optInt("Max age", maxAge, 6, 40);
    if (typeof age === "string") return setError(age);

    setSaving(true);
    try {
      await updateStpVlan(vlan.vlan_id, {
        enabled,
        priority: priority ? Number(priority) : null,
        forward_delay: fd,
        hello_time: hello,
        max_age: age,
      });
      onSaved(`Saved spanning tree for VLAN ${vlan.vlan_id}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save VLAN spanning tree settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title="Edit VLAN Spanning Tree"
        subtitle={`Vlan${vlan.vlan_id}`}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">Spanning tree enabled</p>
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
              Run an STP instance for this VLAN
            </p>
          </div>
          <Switch on={enabled} onChange={setEnabled} />
        </div>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className={`${inputCls} cursor-pointer`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          >
            <option value="">Inherit global</option>
            {BRIDGE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          {(
            [
              ["Forward Delay (s)", forwardDelay, setForwardDelay, "4–30"],
              ["Hello Time (s)", helloTime, setHelloTime, "1–10"],
              ["Max Age (s)", maxAge, setMaxAge, "6–40"],
            ] as const
          ).map(([label, value, set, range]) => (
            <div key={label}>
              <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">{label}</label>
              <input
                type="number"
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={`Global (${range})`}
                className={inputCls}
                style={monoSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
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
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
