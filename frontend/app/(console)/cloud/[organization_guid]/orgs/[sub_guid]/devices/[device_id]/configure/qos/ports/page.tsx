"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Pencil, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import {
  FeatureReadOnlyNotice,
  FeatureUnavailable,
} from "@/components/device/FeatureUnavailable";
import { QosDoc, QosPort, fetchQos } from "@/lib/device/sonic-qos";
import { PortQosFormModal } from "./PortQosFormModal";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

const columns: Column<QosPort>[] = [
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
    key: "trust",
    header: "Trust",
    value: (r) => r.trust,
    render: (r) =>
      r.trust === "dscp" ? (
        <span className="badge badge-ok">DSCP</span>
      ) : (
        <span className="badge badge-muted">Untrusted</span>
      ),
    sortable: true,
    width: 110,
  },
  {
    key: "map",
    header: "DSCP Map",
    value: (r) => r.dscp_to_tc_map ?? "",
    render: (r) => (r.dscp_to_tc_map ? r.dscp_to_tc_map : dash),
    mono: true,
    sortable: true,
    width: 180,
  },
];

/// Per-port QoS trust: whether the port honors incoming DSCP markings and
/// which DSCP→TC map classifies them. Maps are authored on the DSCP Maps page.
export default function PortQosPage() {
  const [doc, setDoc] = useState<QosDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState<QosPort | null>(null);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchQos());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load QoS state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const editable = doc?.capability.supported && !doc.capability.read_only;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Port Trust
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Which ports trust incoming DSCP markings, and the map that classifies them
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading port QoS…</div>
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
          <FeatureUnavailable feature="QoS" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <DataTable
              rows={doc.ports}
              columns={columns}
              rowId={(r) => r.name}
              storageKey="qos-ports"
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
        )}
      </div>

      {editing && doc && (
        <PortQosFormModal
          port={editing}
          maps={doc.dscp_tc_maps.map((m) => m.name)}
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
