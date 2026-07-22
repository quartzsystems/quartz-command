"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Pencil, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import {
  IsisAdjacency,
  IsisDoc,
  IsisInterface,
  IsisLevel,
  fetchIsisDoc,
  updateIsisInstance,
} from "@/lib/device/sonic-isis";
import { SonicIsisInterfaceModal } from "./SonicIsisInterfaceModal";

type Section = "global" | "interfaces" | "adjacencies";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const LEVEL_LABEL: Record<IsisLevel, string> = {
  "level-1": "Level 1",
  "level-2": "Level 2",
  "level-1-2": "Level 1-2",
};

const interfaceColumns: Column<IsisInterface>[] = [
  { key: "name", header: "Interface", value: (r) => r.name, mono: true, sortable: true, width: 140 },
  {
    key: "enabled",
    header: "IS-IS",
    value: (r) => (r.enabled ? "enabled" : "disabled"),
    render: (r) =>
      r.enabled ? <span className="badge badge-ok">Enabled</span> : <span className="badge badge-muted">Disabled</span>,
    sortable: true,
    width: 100,
  },
  {
    key: "circuit_type",
    header: "Circuit Type",
    value: (r) => r.circuit_type ?? "",
    render: (r) => (r.circuit_type ? LEVEL_LABEL[r.circuit_type] : dash),
    sortable: true,
    width: 130,
  },
  {
    key: "metric",
    header: "Metric",
    value: (r) => r.metric ?? -1,
    render: (r) => (r.metric != null ? r.metric : dash),
    mono: true,
    width: 95,
  },
  {
    key: "flags",
    header: "Flags",
    value: (r) => [r.passive && "passive", r.point_to_point && "p2p"].filter(Boolean).join(","),
    render: (r) => {
      const flags = [r.passive && "passive", r.point_to_point && "p2p"].filter(Boolean) as string[];
      return flags.length ? (
        <span className="inline-flex gap-1 flex-wrap">
          {flags.map((f) => (
            <span key={f} className="badge badge-muted">{f}</span>
          ))}
        </span>
      ) : (
        dash
      );
    },
    width: 150,
  },
];

const adjacencyColumns: Column<IsisAdjacency>[] = [
  { key: "system_id", header: "System ID", value: (r) => r.system_id, mono: true, sortable: true, width: 170 },
  { key: "interface", header: "Interface", value: (r) => r.interface, mono: true, sortable: true, width: 140 },
  { key: "level", header: "Level", value: (r) => r.level, mono: true, width: 90 },
  {
    key: "state",
    header: "State",
    value: (r) => r.state,
    render: (r) =>
      r.state.toLowerCase() === "up" ? (
        <span className="badge badge-ok">Up</span>
      ) : (
        <span className="badge badge-warn">{r.state}</span>
      ),
    sortable: true,
    width: 100,
  },
  {
    key: "holdtime",
    header: "Hold Time",
    value: (r) => r.holdtime_secs ?? -1,
    render: (r) => (r.holdtime_secs != null ? `${r.holdtime_secs}s` : dash),
    mono: true,
    width: 100,
  },
];

/// IS-IS editor for QuartzSONiC switches. Community SONiC has no IS-IS
/// integration, so this page usually renders the capability notice; on
/// images that run isisd the agent manages FRR directly.
export function SonicIsisPage() {
  const [doc, setDoc] = useState<IsisDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [section, setSection] = useState<Section>("global");
  const [ifaceModal, setIfaceModal] = useState<IsisInterface | null>(null);
  const [toast, setToast] = useState("");

  // Instance form state, seeded on load.
  const [net, setNet] = useState("");
  const [level, setLevel] = useState<IsisLevel>("level-2");
  const [dynamicHostname, setDynamicHostname] = useState(true);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      const d = await fetchIsisDoc();
      setDoc(d);
      setNet(d.instance?.net ?? "");
      setLevel(d.instance?.level ?? "level-2");
      setDynamicHostname(d.instance?.dynamic_hostname ?? true);
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load IS-IS state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveInstance = async () => {
    setFormError("");
    const trimmed = net.trim();
    if (trimmed && !/^[0-9a-fA-F]{2}(\.[0-9a-fA-F]{4})+\.[0-9a-fA-F]{2}$/.test(trimmed)) {
      return setFormError('NET must look like "49.0001.1921.6800.1001.00".');
    }
    setSaving(true);
    try {
      await updateIsisInstance({
        net: trimmed || null,
        level,
        dynamic_hostname: dynamicHostname,
      });
      setToast(trimmed ? "Saved IS-IS instance." : "Removed IS-IS instance.");
      await load("refresh");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save IS-IS instance.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          IS-IS
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Intermediate System to Intermediate System — instance, interfaces, and adjacencies
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading IS-IS…</div>
        )}
        {status === "error" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[13px] text-[var(--qz-danger)]">
              <AlertTriangle size={15} />
              {errorMsg}
            </div>
            <div>
              <Button kind="secondary" icon={RotateCw} onClick={load}>Retry</Button>
            </div>
          </div>
        )}
        {status === "ready" && doc && !doc.capability.supported && (
          <FeatureUnavailable feature="IS-IS" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <Segmented
              items={[
                { value: "global", label: "Global" },
                { value: "interfaces", label: "Interfaces" },
                { value: "adjacencies", label: "Adjacencies" },
              ]}
              value={section}
              onChange={(v) => setSection(v as Section)}
            />

            {section === "global" && (
              <div
                className="max-w-[640px] rounded-xl p-6"
                style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
              >
                <div className="grid gap-4" style={{ gridTemplateColumns: "2fr 1fr" }}>
                  <div>
                    <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
                      Network Entity Title (NET)
                    </label>
                    <input
                      value={net}
                      onChange={(e) => setNet(e.target.value)}
                      placeholder="49.0001.1921.6800.1001.00 — empty removes the instance"
                      className={inputCls}
                      style={monoSt}
                      onFocus={focusBorder}
                      onBlur={blurBorder}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Level</label>
                    <select
                      value={level}
                      onChange={(e) => setLevel(e.target.value as IsisLevel)}
                      className={`${inputCls} cursor-pointer`}
                      style={inputSt}
                      onFocus={focusBorder}
                      onBlur={blurBorder}
                    >
                      {(Object.keys(LEVEL_LABEL) as IsisLevel[]).map((l) => (
                        <option key={l} value={l}>
                          {LEVEL_LABEL[l]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-4">
                  <div>
                    <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">Dynamic hostname</p>
                    <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
                      Advertise the switch hostname in LSPs
                    </p>
                  </div>
                  <Switch on={dynamicHostname} onChange={setDynamicHostname} />
                </div>

                {formError && (
                  <p className="text-[12px] m-0 mt-4" style={{ color: "var(--qz-danger)" }}>
                    {formError}
                  </p>
                )}

                <div className="flex justify-end mt-5">
                  <button
                    type="button"
                    onClick={saveInstance}
                    disabled={saving}
                    className="px-4 py-[9px] rounded-md text-[13px] font-semibold cursor-pointer border-0"
                    style={{ background: "var(--qz-accent)", color: "var(--qz-fg-on-accent)", opacity: saving ? 0.7 : 1 }}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </div>
            )}

            {section === "interfaces" && (
              <DataTable
                rows={doc.interfaces}
                columns={interfaceColumns}
                rowId={(r) => r.name}
                storageKey="routing-sonic-isis-interfaces"
                searchPlaceholder="Search interfaces…"
                emptyMessage="No L3 interfaces available for IS-IS."
                onRefresh={() => load("refresh")}
                onRowDoubleClick={(r) => setIfaceModal(r)}
                actionsWidth={60}
                actions={(r) => (
                  <button
                    type="button"
                    title={`Edit ${r.name}`}
                    aria-label="Edit"
                    onClick={() => setIfaceModal(r)}
                    className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                  >
                    <Pencil size={14} />
                  </button>
                )}
              />
            )}

            {section === "adjacencies" && (
              <DataTable
                rows={doc.adjacencies}
                columns={adjacencyColumns}
                rowId={(r) => `${r.system_id}:${r.interface}:${r.level}`}
                storageKey="routing-sonic-isis-adjacencies"
                searchPlaceholder="Search adjacencies…"
                emptyMessage="No IS-IS adjacencies."
                onRefresh={() => load("refresh")}
              />
            )}
          </div>
        )}
      </div>

      {ifaceModal && (
        <SonicIsisInterfaceModal
          iface={ifaceModal}
          onClose={() => setIfaceModal(null)}
          onSaved={(message) => {
            setIfaceModal(null);
            setToast(message);
            load("refresh");
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
