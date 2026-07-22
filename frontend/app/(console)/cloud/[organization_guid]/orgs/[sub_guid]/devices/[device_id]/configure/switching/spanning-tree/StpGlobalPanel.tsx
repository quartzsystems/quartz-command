"use client";

import { useState } from "react";
import { StpDoc, StpMode, updateStpGlobal } from "@/lib/device/stp";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/** Valid bridge priorities: 0–61440 in steps of 4096. */
const BRIDGE_PRIORITIES = Array.from({ length: 16 }, (_, i) => i * 4096);

const MODE_LABEL: Record<StpMode, string> = {
  pvst: "PVST (per-VLAN)",
  mst: "MST (multiple instance)",
  disabled: "Disabled",
};

/// Bridge-wide spanning tree settings: protocol mode, bridge priority, and
/// the default timers VLAN instances inherit. MST region settings appear
/// when the image supports MSTP and the mode is set to it.
export function StpGlobalPanel({
  doc,
  onSaved,
}: {
  doc: StpDoc;
  onSaved: (message: string) => void;
}) {
  const g = doc.global;
  const [mode, setMode] = useState<StpMode>(g?.mode ?? "disabled");
  const [priority, setPriority] = useState(String(g?.priority ?? 32768));
  const [forwardDelay, setForwardDelay] = useState(String(g?.forward_delay ?? 15));
  const [helloTime, setHelloTime] = useState(String(g?.hello_time ?? 2));
  const [maxAge, setMaxAge] = useState(String(g?.max_age ?? 20));
  const [rootguardTimeout, setRootguardTimeout] = useState(String(g?.rootguard_timeout ?? 30));
  const [regionName, setRegionName] = useState(g?.region_name ?? "");
  const [revision, setRevision] = useState(g?.revision != null ? String(g.revision) : "0");
  const [maxHops, setMaxHops] = useState(g?.max_hops != null ? String(g.max_hops) : "20");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const modes: StpMode[] = [...doc.modes_supported, "disabled"];

  const intIn = (label: string, raw: string, min: number, max: number): number | string => {
    const v = Number(raw);
    if (!Number.isInteger(v) || v < min || v > max) {
      return `${label} must be a whole number between ${min} and ${max}.`;
    }
    return v;
  };

  const save = async () => {
    setError("");
    const fd = intIn("Forward delay", forwardDelay, 4, 30);
    if (typeof fd === "string") return setError(fd);
    const hello = intIn("Hello time", helloTime, 1, 10);
    if (typeof hello === "string") return setError(hello);
    const age = intIn("Max age", maxAge, 6, 40);
    if (typeof age === "string") return setError(age);
    const rg = intIn("Root guard timeout", rootguardTimeout, 5, 600);
    if (typeof rg === "string") return setError(rg);

    let rev = 0;
    let hops = 20;
    if (mode === "mst") {
      const r = intIn("Revision", revision, 0, 65535);
      if (typeof r === "string") return setError(r);
      rev = r;
      const h = intIn("Max hops", maxHops, 1, 40);
      if (typeof h === "string") return setError(h);
      hops = h;
    }

    setSaving(true);
    try {
      await updateStpGlobal({
        mode,
        priority: Number(priority),
        forward_delay: fd,
        hello_time: hello,
        max_age: age,
        rootguard_timeout: rg,
        ...(mode === "mst"
          ? { region_name: regionName.trim() || null, revision: rev, max_hops: hops }
          : {}),
      });
      onSaved("Saved spanning tree settings.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save spanning tree settings.");
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, node: React.ReactNode) => (
    <div>
      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">{label}</label>
      {node}
    </div>
  );

  return (
    <div
      className="max-w-[640px] rounded-xl p-6"
      style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
    >
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {field(
          "Mode",
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as StpMode)}
            className={`${inputCls} cursor-pointer`}
            style={inputSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          >
            {modes.map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>,
        )}
        {field(
          "Bridge Priority",
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            disabled={mode === "disabled"}
            className={`${inputCls} cursor-pointer disabled:opacity-60`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          >
            {BRIDGE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
                {p === 32768 ? " (default)" : ""}
              </option>
            ))}
          </select>,
        )}
      </div>

      <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
        {(
          [
            ["Forward Delay (s)", forwardDelay, setForwardDelay],
            ["Hello Time (s)", helloTime, setHelloTime],
            ["Max Age (s)", maxAge, setMaxAge],
            ["Root Guard Timeout (s)", rootguardTimeout, setRootguardTimeout],
          ] as const
        ).map(([label, value, set]) =>
          field(
            label,
            <input
              key={label}
              type="number"
              value={value}
              onChange={(e) => set(e.target.value)}
              disabled={mode === "disabled"}
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />,
          ),
        )}
      </div>

      {mode === "mst" && (
        <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
          {field(
            "MST Region Name",
            <input
              value={regionName}
              onChange={(e) => setRegionName(e.target.value)}
              placeholder="region-1"
              className={inputCls}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />,
          )}
          {field(
            "Revision",
            <input
              type="number"
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />,
          )}
          {field(
            "Max Hops",
            <input
              type="number"
              value={maxHops}
              onChange={(e) => setMaxHops(e.target.value)}
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />,
          )}
        </div>
      )}

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
