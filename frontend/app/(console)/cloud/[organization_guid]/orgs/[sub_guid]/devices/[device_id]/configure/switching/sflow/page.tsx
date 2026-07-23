"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Pencil, Plus, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import {
  FeatureReadOnlyNotice,
  FeatureUnavailable,
} from "@/components/device/FeatureUnavailable";
import {
  SflowCollector,
  SflowDoc,
  SflowPort,
  fetchSflow,
  updateSflowGlobal,
} from "@/lib/device/sonic-sflow";
import { SflowPortFormModal } from "./SflowPortFormModal";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

interface CollectorRow extends SflowCollector {
  key: string;
}

let keyCounter = 0;
const nextKey = () => `sflow-collector-${keyCounter++}`;

const portColumns: Column<SflowPort>[] = [
  { key: "name", header: "Port", value: (r) => r.name, mono: true, sortable: true, width: 130 },
  {
    key: "alias",
    header: "Alias",
    value: (r) => r.alias ?? "",
    render: (r) => (r.alias ? r.alias : dash),
    mono: true,
    width: 110,
  },
  {
    key: "link",
    header: "Link",
    value: (r) => r.oper_status,
    render: (r) =>
      r.oper_status === "up" ? (
        <span className="badge badge-ok">Up</span>
      ) : r.oper_status === "down" ? (
        <span className="badge badge-muted">Down</span>
      ) : (
        <span className="badge badge-muted">Unknown</span>
      ),
    sortable: true,
    width: 85,
  },
  {
    key: "enabled",
    header: "Sampling",
    value: (r) => (r.enabled ? "enabled" : "disabled"),
    render: (r) =>
      r.enabled ? (
        <span className="badge badge-ok">Enabled</span>
      ) : (
        <span className="badge badge-muted">Off</span>
      ),
    sortable: true,
    width: 105,
  },
  {
    key: "rate",
    header: "Sample Rate",
    value: (r) => r.sample_rate ?? -1,
    render: (r) =>
      r.sample_rate != null ? `1 in ${r.sample_rate.toLocaleString()}` : dash,
    mono: true,
    sortable: true,
    width: 140,
  },
];

export default function SflowPage() {
  const [doc, setDoc] = useState<SflowDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState<SflowPort | null>(null);

  // Global settings form state, seeded from the loaded doc.
  const [enabled, setEnabled] = useState(false);
  const [polling, setPolling] = useState("");
  const [agentId, setAgentId] = useState("");
  const [collectors, setCollectors] = useState<CollectorRow[]>([]);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      const d = await fetchSflow();
      setDoc(d);
      setEnabled(d.enabled);
      setPolling(d.polling_interval != null ? String(d.polling_interval) : "");
      setAgentId(d.agent_id ?? "");
      setCollectors(d.collectors.map((c) => ({ ...c, key: nextKey() })));
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load sFlow state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addCollector = () =>
    setCollectors((p) => [
      ...p,
      { key: nextKey(), name: "", address: "", port: null, vrf: null },
    ]);

  const updateCollector = (key: string, patch: Partial<SflowCollector>) =>
    setCollectors((p) => p.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const removeCollector = (key: string) =>
    setCollectors((p) => p.filter((c) => c.key !== key));

  const save = async () => {
    setFormError("");

    let pollingInterval: number | null = null;
    if (polling.trim() !== "") {
      pollingInterval = Number(polling);
      if (!Number.isInteger(pollingInterval) || pollingInterval < 0 || pollingInterval > 8400) {
        return setFormError("Polling interval must be a whole number between 0 and 8400 seconds.");
      }
    }
    if (collectors.length > 2) {
      return setFormError("SONiC supports at most two sFlow collectors.");
    }
    const cleaned: SflowCollector[] = [];
    const names = new Set<string>();
    for (const c of collectors) {
      const name = c.name.trim();
      const address = c.address.trim();
      if (!name || !address) {
        return setFormError("Every collector needs a name and an address.");
      }
      if (names.has(name)) return setFormError(`Duplicate collector name ${name}.`);
      names.add(name);
      if (c.port != null && (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535)) {
        return setFormError("Collector port must be between 1 and 65535.");
      }
      cleaned.push({ name, address, port: c.port, vrf: c.vrf });
    }

    setSaving(true);
    try {
      await updateSflowGlobal({
        enabled,
        polling_interval: pollingInterval,
        agent_id: agentId.trim() || null,
        collectors: cleaned,
      });
      setToast("Saved sFlow settings.");
      await load("refresh");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save sFlow settings.");
    } finally {
      setSaving(false);
    }
  };

  const editable = doc?.capability.supported && !doc.capability.read_only;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          sFlow
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Packet sampling to an sFlow collector — global settings, collectors, and per-port sampling
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading sFlow…</div>
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
          <FeatureUnavailable feature="sFlow" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <div
              className="max-w-[640px] rounded-xl p-6"
              style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">sFlow enabled</p>
                  <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
                    Run the sFlow service and export samples to the collectors below
                  </p>
                </div>
                <Switch on={enabled} onChange={editable ? setEnabled : () => {}} />
              </div>

              <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
                    Counter Polling Interval (s)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={8400}
                    value={polling}
                    onChange={(e) => setPolling(e.target.value)}
                    disabled={!editable}
                    placeholder="20 (default) — 0 disables"
                    className={`${inputCls} disabled:opacity-60`}
                    style={monoSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
                    Agent Interface
                  </label>
                  <input
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    disabled={!editable}
                    placeholder="Auto (e.g. Loopback0)"
                    className={`${inputCls} disabled:opacity-60`}
                    style={monoSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  />
                </div>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[12px] text-[var(--qz-fg-3)]">
                    Collectors <span className="text-[var(--qz-fg-4)]">(max 2)</span>
                  </label>
                  {editable && collectors.length < 2 && (
                    <Button kind="secondary" size="sm" icon={Plus} onClick={addCollector}>
                      Add collector
                    </Button>
                  )}
                </div>
                {collectors.length === 0 && (
                  <p className="text-[12.5px] text-[var(--qz-fg-4)] m-0">
                    No collectors — samples are gathered but not exported.
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  {collectors.map((c) => (
                    <div
                      key={c.key}
                      className="grid gap-2 items-center"
                      style={{ gridTemplateColumns: "1fr 1.4fr 90px 110px 32px" }}
                    >
                      <input
                        value={c.name}
                        onChange={(e) => updateCollector(c.key, { name: e.target.value })}
                        disabled={!editable}
                        placeholder="Name"
                        className={`${inputCls} disabled:opacity-60`}
                        style={inputSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                      <input
                        value={c.address}
                        onChange={(e) => updateCollector(c.key, { address: e.target.value })}
                        disabled={!editable}
                        placeholder="10.0.0.50"
                        className={`${inputCls} disabled:opacity-60`}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        value={c.port != null ? String(c.port) : ""}
                        onChange={(e) =>
                          updateCollector(c.key, {
                            port: e.target.value.trim() === "" ? null : Number(e.target.value),
                          })
                        }
                        disabled={!editable}
                        placeholder="6343"
                        className={`${inputCls} disabled:opacity-60`}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                      <select
                        value={c.vrf ?? "default"}
                        onChange={(e) =>
                          updateCollector(c.key, {
                            vrf: e.target.value === "mgmt" ? "mgmt" : "default",
                          })
                        }
                        disabled={!editable}
                        className={`${inputCls} cursor-pointer disabled:opacity-60`}
                        style={inputSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      >
                        <option value="default">default</option>
                        <option value="mgmt">mgmt</option>
                      </select>
                      {editable ? (
                        <button
                          type="button"
                          title="Remove collector"
                          aria-label="Remove collector"
                          onClick={() => removeCollector(c.key)}
                          className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {formError && (
                <p className="text-[12px] m-0 mt-4" style={{ color: "var(--qz-danger)" }}>
                  {formError}
                </p>
              )}

              {editable && (
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
              )}
            </div>

            <div>
              <h2 className="text-[16px] font-semibold text-[var(--qz-fg-1)] m-0 mb-3">
                Per-Port Sampling
              </h2>
              <DataTable
                rows={doc.ports}
                columns={portColumns}
                rowId={(r) => r.name}
                storageKey="switching-sflow-ports"
                searchPlaceholder="Search ports…"
                emptyMessage="No ports reported."
                onRefresh={() => load("refresh")}
                onRowDoubleClick={editable ? (r) => setEditing(r) : undefined}
                actionsWidth={60}
                actions={
                  editable
                    ? (r) => (
                        <button
                          type="button"
                          title={`Edit ${r.name}`}
                          aria-label="Edit"
                          onClick={() => setEditing(r)}
                          className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                        >
                          <Pencil size={14} />
                        </button>
                      )
                    : undefined
                }
              />
            </div>
          </div>
        )}
      </div>

      {editing && (
        <SflowPortFormModal
          port={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setToast(msg);
            load("refresh");
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
