"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { StpPort, updateStpPort } from "@/lib/device/stp";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Per-port spanning tree settings: participation, priority/cost, edge
/// behaviour (PortFast/UplinkFast, MST edge/link-type), and the BPDU / root
/// guard protections. Guard toggles are shared with the Loop Protection page.
export function StpPortFormModal({
  port,
  mstMode,
  onClose,
  onSaved,
}: {
  port: StpPort;
  /** True when the bridge runs MST — shows edge-port / link-type knobs. */
  mstMode: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(port.enabled);
  const [priority, setPriority] = useState(port.priority != null ? String(port.priority) : "");
  const [pathCost, setPathCost] = useState(port.path_cost != null ? String(port.path_cost) : "");
  const [portfast, setPortfast] = useState(port.portfast);
  const [uplinkFast, setUplinkFast] = useState(port.uplink_fast);
  const [edgePort, setEdgePort] = useState(port.edge_port ?? false);
  const [linkType, setLinkType] = useState(port.link_type ?? "auto");
  const [bpduGuard, setBpduGuard] = useState(port.bpdu_guard);
  const [bpduGuardShutdown, setBpduGuardShutdown] = useState(port.bpdu_guard_do_disable);
  const [rootGuard, setRootGuard] = useState(port.root_guard);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    let prio: number | null = null;
    if (priority.trim()) {
      prio = Number(priority);
      if (!Number.isInteger(prio) || prio < 0 || prio > 240 || prio % 16 !== 0) {
        return setError("Priority must be 0–240 in steps of 16.");
      }
    }
    let cost: number | null = null;
    if (pathCost.trim()) {
      cost = Number(pathCost);
      if (!Number.isInteger(cost) || cost < 1 || cost > 200000000) {
        return setError("Path cost must be a whole number between 1 and 200000000.");
      }
    }

    setSaving(true);
    try {
      await updateStpPort(port.name, {
        enabled,
        priority: prio,
        path_cost: cost,
        portfast,
        uplink_fast: uplinkFast,
        ...(mstMode ? { edge_port: edgePort, link_type: linkType } : {}),
        bpdu_guard: bpduGuard,
        bpdu_guard_do_disable: bpduGuardShutdown,
        root_guard: rootGuard,
      });
      onSaved(`Saved spanning tree for ${port.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save port spanning tree settings.");
    } finally {
      setSaving(false);
    }
  };

  const toggleRow = (
    label: string,
    hint: string,
    on: boolean,
    onChange: (v: boolean) => void,
    disabled = false,
  ) => (
    <div className="flex items-center justify-between" style={{ opacity: disabled ? 0.5 : 1 }}>
      <div>
        <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">{label}</p>
        <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">{hint}</p>
      </div>
      <Switch on={on} onChange={disabled ? () => {} : onChange} />
    </div>
  );

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader title="Edit Port Spanning Tree" subtitle={port.name} onClose={onClose} />

      <form onSubmit={submit} className="flex flex-col gap-4">
        {toggleRow("Spanning tree enabled", "Participate in STP on this interface", enabled, setEnabled)}

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Priority</label>
            <input
              type="number"
              min={0}
              max={240}
              step={16}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              placeholder="128 (default)"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Path Cost</label>
            <input
              type="number"
              min={1}
              max={200000000}
              value={pathCost}
              onChange={(e) => setPathCost(e.target.value)}
              placeholder="Auto from link speed"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        {toggleRow(
          "PortFast",
          "Skip listening/learning on edge ports facing hosts",
          portfast,
          setPortfast,
        )}
        {toggleRow(
          "UplinkFast",
          "Fast root-port failover on access switches",
          uplinkFast,
          setUplinkFast,
        )}

        {mstMode && (
          <>
            {toggleRow("Edge port", "MST edge port (host-facing)", edgePort, setEdgePort)}
            <div>
              <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Link Type</label>
              <select
                value={linkType}
                onChange={(e) => setLinkType(e.target.value as typeof linkType)}
                className={`${inputCls} cursor-pointer`}
                style={inputSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              >
                <option value="auto">Auto</option>
                <option value="point-to-point">Point-to-point</option>
                <option value="shared">Shared</option>
              </select>
            </div>
          </>
        )}

        <div className="pt-1" style={{ borderTop: "1px solid var(--qz-border)" }} />

        {toggleRow(
          "BPDU Guard",
          "Protect against BPDUs arriving on host-facing ports",
          bpduGuard,
          setBpduGuard,
        )}
        {toggleRow(
          "Shutdown on violation",
          "Admin-shut the port when BPDU Guard trips",
          bpduGuardShutdown,
          setBpduGuardShutdown,
          !bpduGuard,
        )}
        {toggleRow(
          "Root Guard",
          "Block superior BPDUs that would move the root",
          rootGuard,
          setRootGuard,
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
