"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { IgmpSnoopingVlan, updateIgmpSnoopingVlan } from "@/lib/device/igmp-snooping";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Per-VLAN IGMP snooping: enable, querier role, fast leave, and query
/// timers. Blank timer fields inherit the image defaults.
export function IgmpVlanFormModal({
  vlan,
  onClose,
  onSaved,
}: {
  vlan: IgmpSnoopingVlan;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(vlan.enabled);
  const [querier, setQuerier] = useState(vlan.querier);
  const [fastLeave, setFastLeave] = useState(vlan.fast_leave);
  const [version, setVersion] = useState(vlan.version != null ? String(vlan.version) : "");
  const [queryInterval, setQueryInterval] = useState(
    vlan.query_interval != null ? String(vlan.query_interval) : "",
  );
  const [lastMemberInterval, setLastMemberInterval] = useState(
    vlan.last_member_query_interval != null ? String(vlan.last_member_query_interval) : "",
  );
  const [maxResponse, setMaxResponse] = useState(
    vlan.query_max_response_time != null ? String(vlan.query_max_response_time) : "",
  );

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

    const qi = optInt("Query interval", queryInterval, 1, 18000);
    if (typeof qi === "string") return setError(qi);
    const lm = optInt("Last member query interval", lastMemberInterval, 1, 25);
    if (typeof lm === "string") return setError(lm);
    const mr = optInt("Max response time", maxResponse, 1, 25);
    if (typeof mr === "string") return setError(mr);

    setSaving(true);
    try {
      await updateIgmpSnoopingVlan(vlan.vlan_id, {
        enabled,
        querier,
        fast_leave: fastLeave,
        version: version ? Number(version) : null,
        query_interval: qi,
        last_member_query_interval: lm,
        query_max_response_time: mr,
      });
      onSaved(`Saved IGMP snooping for VLAN ${vlan.vlan_id}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save IGMP snooping settings.");
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
      <ModalHeader
        title="Edit IGMP Snooping"
        subtitle={`Vlan${vlan.vlan_id}`}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        {toggleRow("Snooping enabled", "Learn multicast group membership on this VLAN", enabled, setEnabled)}
        {toggleRow("Querier", "Send IGMP queries when no multicast router is present", querier, setQuerier)}
        {toggleRow("Fast leave", "Prune a port immediately on IGMP leave", fastLeave, setFastLeave)}

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">IGMP Version</label>
            <select
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className={`${inputCls} cursor-pointer`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="">Default</option>
              <option value="1">v1</option>
              <option value="2">v2</option>
              <option value="3">v3</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Query Interval (s)</label>
            <input
              type="number"
              value={queryInterval}
              onChange={(e) => setQueryInterval(e.target.value)}
              placeholder="125 (default)"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Last Member Query (s)
            </label>
            <input
              type="number"
              value={lastMemberInterval}
              onChange={(e) => setLastMemberInterval(e.target.value)}
              placeholder="1 (default)"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Max Response Time (s)
            </label>
            <input
              type="number"
              value={maxResponse}
              onChange={(e) => setMaxResponse(e.target.value)}
              placeholder="10 (default)"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
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
