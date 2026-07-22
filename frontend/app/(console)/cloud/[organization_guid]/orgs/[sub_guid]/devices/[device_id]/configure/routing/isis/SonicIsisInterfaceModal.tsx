"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { IsisInterface, IsisLevel, updateIsisInterface } from "@/lib/device/sonic-isis";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Per-interface IS-IS settings: participation, circuit type, metric, and
/// the passive / point-to-point flags.
export function SonicIsisInterfaceModal({
  iface,
  onClose,
  onSaved,
}: {
  iface: IsisInterface;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(iface.enabled);
  const [circuitType, setCircuitType] = useState(iface.circuit_type ?? "");
  const [metric, setMetric] = useState(iface.metric != null ? String(iface.metric) : "");
  const [passive, setPassive] = useState(iface.passive);
  const [pointToPoint, setPointToPoint] = useState(iface.point_to_point);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    let metricNum: number | null = null;
    if (metric.trim()) {
      metricNum = Number(metric);
      if (!Number.isInteger(metricNum) || metricNum < 1 || metricNum > 16777215) {
        return setError("Metric must be a whole number between 1 and 16777215.");
      }
    }

    setSaving(true);
    try {
      await updateIsisInterface(iface.name, {
        enabled,
        circuit_type: (circuitType || null) as IsisLevel | null,
        metric: metricNum,
        passive,
        point_to_point: pointToPoint,
      });
      onSaved(`Saved IS-IS settings for ${iface.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save interface settings.");
    } finally {
      setSaving(false);
    }
  };

  const toggleRow = (label: string, hint: string, on: boolean, onChange: (v: boolean) => void) => (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">{label}</p>
        <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">{hint}</p>
      </div>
      <Switch on={on} onChange={onChange} />
    </div>
  );

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader title="Edit IS-IS Interface" subtitle={iface.name} onClose={onClose} />

      <form onSubmit={submit} className="flex flex-col gap-4">
        {toggleRow("IS-IS enabled", "Run IS-IS on this interface", enabled, setEnabled)}

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Circuit Type</label>
            <select
              value={circuitType}
              onChange={(e) => setCircuitType(e.target.value)}
              className={`${inputCls} cursor-pointer`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="">Inherit instance level</option>
              <option value="level-1">Level 1</option>
              <option value="level-2">Level 2</option>
              <option value="level-1-2">Level 1-2</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Metric</label>
            <input
              type="number"
              min={1}
              max={16777215}
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              placeholder="10 (default)"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        {toggleRow("Passive", "Advertise the network but form no adjacencies", passive, setPassive)}
        {toggleRow(
          "Point-to-point",
          "Treat the link as p2p instead of broadcast",
          pointToPoint,
          setPointToPoint,
        )}

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
