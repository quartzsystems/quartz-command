"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import {
  FeatureReadOnlyNotice,
  FeatureUnavailable,
} from "@/components/device/FeatureUnavailable";
import {
  LldpDoc,
  LldpNeighbor,
  fetchLldp,
  updateLldpConfig,
} from "@/lib/device/lldp";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

const neighborColumns: Column<LldpNeighbor>[] = [
  { key: "local_port", header: "Local Port", value: (r) => r.local_port, mono: true, sortable: true, width: 120 },
  {
    key: "remote_system",
    header: "Neighbor",
    value: (r) => r.remote_system_name ?? "",
    render: (r) => (r.remote_system_name ? r.remote_system_name : dash),
    sortable: true,
    width: 170,
  },
  {
    key: "remote_port",
    header: "Remote Port",
    value: (r) => r.remote_port_id ?? "",
    render: (r) => (
      <span title={r.remote_port_description ?? undefined}>
        {r.remote_port_id ?? "—"}
      </span>
    ),
    mono: true,
    width: 140,
  },
  {
    key: "chassis",
    header: "Chassis ID",
    value: (r) => r.remote_chassis_id ?? "",
    render: (r) => (r.remote_chassis_id ? r.remote_chassis_id : dash),
    mono: true,
    width: 160,
  },
  {
    key: "mgmt",
    header: "Mgmt Address",
    value: (r) => r.remote_mgmt_addresses.join(", "),
    render: (r) =>
      r.remote_mgmt_addresses.length ? r.remote_mgmt_addresses.join(", ") : dash,
    mono: true,
    width: 160,
  },
  {
    key: "caps",
    header: "Capabilities",
    value: (r) => r.capabilities.join(","),
    render: (r) =>
      r.capabilities.length ? (
        <span className="inline-flex gap-1 flex-wrap">
          {r.capabilities.map((c) => (
            <span key={c} className="badge badge-info">{c}</span>
          ))}
        </span>
      ) : (
        dash
      ),
    width: 160,
  },
  {
    key: "descr",
    header: "System Description",
    value: (r) => r.remote_system_description ?? "",
    render: (r) =>
      r.remote_system_description ? (
        <span title={r.remote_system_description}>{r.remote_system_description}</span>
      ) : (
        dash
      ),
  },
];

export default function LldpPage() {
  const [doc, setDoc] = useState<LldpDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");

  // Settings form state, seeded from the loaded doc.
  const [enabled, setEnabled] = useState(true);
  const [helloTime, setHelloTime] = useState("");
  const [multiplier, setMultiplier] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      const d = await fetchLldp();
      setDoc(d);
      setEnabled(d.config.enabled);
      setHelloTime(d.config.hello_time != null ? String(d.config.hello_time) : "");
      setMultiplier(d.config.multiplier != null ? String(d.config.multiplier) : "");
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load LLDP state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!doc) return;
    setFormError("");
    const timers = doc.config.timers_supported;
    let hello: number | null = null;
    let mult: number | null = null;
    if (timers && helloTime.trim()) {
      hello = Number(helloTime);
      if (!Number.isInteger(hello) || hello < 5 || hello > 254) {
        return setFormError("Transmit interval must be a whole number between 5 and 254 seconds.");
      }
    }
    if (timers && multiplier.trim()) {
      mult = Number(multiplier);
      if (!Number.isInteger(mult) || mult < 1 || mult > 10) {
        return setFormError("TTL multiplier must be a whole number between 1 and 10.");
      }
    }
    setSaving(true);
    try {
      await updateLldpConfig({
        enabled,
        ...(timers ? { hello_time: hello, multiplier: mult } : {}),
      });
      setToast("Saved LLDP settings.");
      await load("refresh");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save LLDP settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          LLDP
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Link Layer Discovery Protocol — discovered neighbors and protocol settings
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading LLDP…</div>
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
          <FeatureUnavailable feature="LLDP" capability={doc.capability} />
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
                  <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">LLDP enabled</p>
                  <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
                    Run the LLDP service and advertise this switch to neighbors
                  </p>
                </div>
                <Switch on={enabled} onChange={setEnabled} />
              </div>

              {doc.config.timers_supported && (
                <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
                      Transmit Interval (s)
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={254}
                      value={helloTime}
                      onChange={(e) => setHelloTime(e.target.value)}
                      placeholder="30 (default)"
                      className={inputCls}
                      style={monoSt}
                      onFocus={focusBorder}
                      onBlur={blurBorder}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
                      TTL Multiplier
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={multiplier}
                      onChange={(e) => setMultiplier(e.target.value)}
                      placeholder="4 (default)"
                      className={inputCls}
                      style={monoSt}
                      onFocus={focusBorder}
                      onBlur={blurBorder}
                    />
                  </div>
                </div>
              )}

              {doc.local?.system_name && (
                <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-4">
                  Advertising as <span style={{ fontFamily: "var(--qz-font-mono)" }}>{doc.local.system_name}</span>
                  {doc.local.chassis_id ? (
                    <>
                      {" "}· chassis <span style={{ fontFamily: "var(--qz-font-mono)" }}>{doc.local.chassis_id}</span>
                    </>
                  ) : null}
                </p>
              )}

              {formError && (
                <p className="text-[12px] m-0 mt-4" style={{ color: "var(--qz-danger)" }}>
                  {formError}
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

            <div>
              <h2 className="text-[16px] font-semibold text-[var(--qz-fg-1)] m-0 mb-3">Neighbors</h2>
              <DataTable
                rows={doc.neighbors}
                columns={neighborColumns}
                rowId={(r) => `${r.local_port}:${r.remote_chassis_id ?? ""}:${r.remote_port_id ?? ""}`}
                storageKey="switching-lldp-neighbors"
                searchPlaceholder="Search neighbors…"
                emptyMessage="No LLDP neighbors discovered."
                onRefresh={() => load("refresh")}
              />
            </div>
          </div>
        )}
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
