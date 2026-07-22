"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/Switch";
import { OspfDoc, OspfInstance, updateOspfInstance } from "@/lib/device/sonic-ospf";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Per-VRF OSPF router instance: enable, router-id, and administrative
/// distance. Areas and interface placement live in their own sections.
export function SonicOspfInstancePanel({
  doc,
  onSaved,
}: {
  doc: OspfDoc;
  onSaved: (message: string) => void;
}) {
  const vrfs = doc.instances.length ? doc.instances.map((i) => i.vrf) : ["default"];
  const [vrf, setVrf] = useState(vrfs[0]);

  const current: OspfInstance | undefined = doc.instances.find((i) => i.vrf === vrf);

  const [enabled, setEnabled] = useState(false);
  const [routerId, setRouterId] = useState("");
  const [distance, setDistance] = useState("");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(!!current);
    setRouterId(current?.router_id ?? "");
    setDistance(current?.distance != null ? String(current.distance) : "");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrf, doc]);

  const save = async () => {
    setError("");
    let dist: number | null = null;
    if (distance.trim()) {
      dist = Number(distance);
      if (!Number.isInteger(dist) || dist < 1 || dist > 255) {
        return setError("Distance must be a whole number between 1 and 255.");
      }
    }
    setSaving(true);
    try {
      await updateOspfInstance(vrf, {
        enabled,
        router_id: routerId.trim() || null,
        distance: dist,
      });
      onSaved(`Saved OSPF instance for VRF ${vrf}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save OSPF instance.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="max-w-[640px] rounded-xl p-6"
      style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">OSPF enabled</p>
          <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
            Run an OSPFv2 router in the selected VRF
          </p>
        </div>
        <Switch on={enabled} onChange={setEnabled} />
      </div>

      <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">VRF</label>
          <select
            value={vrf}
            onChange={(e) => setVrf(e.target.value)}
            className={`${inputCls} cursor-pointer`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          >
            {vrfs.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Router ID</label>
          <input
            value={routerId}
            onChange={(e) => setRouterId(e.target.value)}
            placeholder="10.0.0.1"
            disabled={!enabled}
            className={`${inputCls} disabled:opacity-60`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </div>
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Distance</label>
          <input
            type="number"
            min={1}
            max={255}
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder="110 (default)"
            disabled={!enabled}
            className={`${inputCls} disabled:opacity-60`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </div>
      </div>

      {error && (
        <p className="text-[12px] m-0 mt-4" style={{ color: "var(--qz-danger)" }}>
          {error}
        </p>
      )}

      <div className="flex justify-end mt-5">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-[9px] rounded-md text-[13px] font-semibold cursor-pointer border-0"
          style={{ background: "var(--qz-accent)", color: "var(--qz-fg-on-accent)", opacity: saving ? 0.7 : 1 }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
