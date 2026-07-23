"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import { RemoteVtep, VxlanStatusDoc, fetchVxlanStatus } from "@/lib/device/sonic-vxlan";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

function operBadge(s: "up" | "down" | "unknown") {
  return s === "up" ? (
    <span className="badge badge-ok">Up</span>
  ) : s === "down" ? (
    <span className="badge badge-crit">Down</span>
  ) : (
    <span className="badge badge-muted">Unknown</span>
  );
}

const vtepColumns: Column<RemoteVtep>[] = [
  { key: "ip", header: "Remote VTEP", value: (r) => r.ip, mono: true, sortable: true, width: 170 },
  {
    key: "status",
    header: "Tunnel",
    value: (r) => r.oper_status,
    render: (r) => operBadge(r.oper_status),
    sortable: true,
    width: 100,
  },
  {
    key: "source",
    header: "Learned Via",
    value: (r) => r.source,
    render: (r) =>
      r.source === "evpn" ? (
        <span className="badge badge-info">EVPN</span>
      ) : r.source === "static" ? (
        <span className="badge badge-muted">Static</span>
      ) : (
        dash
      ),
    sortable: true,
    width: 115,
  },
  {
    key: "vnis",
    header: "VNIs",
    value: (r) => r.vnis.join(", "),
    render: (r) => (r.vnis.length ? r.vnis.join(", ") : dash),
    mono: true,
    width: 220,
  },
];

type MappingRow = VxlanStatusDoc["mappings"][number];

const mappingColumns: Column<MappingRow>[] = [
  { key: "vlan", header: "VLAN", value: (r) => r.vlan_id, mono: true, sortable: true, width: 100 },
  { key: "vni", header: "VNI", value: (r) => r.vni, mono: true, sortable: true, width: 120 },
  {
    key: "status",
    header: "State",
    value: (r) => r.oper_status,
    render: (r) => operBadge(r.oper_status),
    sortable: true,
    width: 100,
  },
];

/// Live overlay state: remote VTEPs the switch has learned (or been given)
/// and how each VLAN↔VNI mapping is programmed. Configuration lives under
/// Configure → Routing → VXLAN / EVPN.
export default function VxlanEvpnMonitorPage() {
  const [doc, setDoc] = useState<VxlanStatusDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchVxlanStatus());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load VXLAN state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <MonitorPageShell
      title="VXLAN / EVPN"
      subtitle="Remote tunnel endpoints and overlay mapping state on this switch"
    >
      {status === "loading" && (
        <div className="text-[13px] text-[var(--qz-fg-4)]">Loading overlay state…</div>
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
        <FeatureUnavailable feature="VXLAN" capability={doc.capability} />
      )}
      {status === "ready" && doc && doc.capability.supported && (
        <div className="flex flex-col gap-6">
          <p className="text-[13px] text-[var(--qz-fg-4)] m-0">
            {doc.vtep ? (
              <>
                Local VTEP{" "}
                <span className="text-[var(--qz-fg-2)]" style={{ fontFamily: "var(--qz-font-mono)" }}>
                  {doc.vtep.name}
                </span>{" "}
                sourced from{" "}
                <span className="text-[var(--qz-fg-2)]" style={{ fontFamily: "var(--qz-font-mono)" }}>
                  {doc.vtep.source_ip}
                </span>
                {" · "}
                {doc.remote_vteps.length.toLocaleString()} remote VTEP
                {doc.remote_vteps.length === 1 ? "" : "s"}
              </>
            ) : (
              "No VTEP is configured on this switch."
            )}
          </p>

          <div>
            <h2 className="text-[16px] font-semibold text-[var(--qz-fg-1)] m-0 mb-3">
              Remote VTEPs
            </h2>
            <DataTable
              rows={doc.remote_vteps}
              columns={vtepColumns}
              rowId={(r) => r.ip}
              storageKey="monitor-vxlan-vteps"
              searchPlaceholder="Search VTEPs…"
              emptyMessage="No remote VTEPs learned."
              onRefresh={() => load("refresh")}
            />
          </div>

          <div>
            <h2 className="text-[16px] font-semibold text-[var(--qz-fg-1)] m-0 mb-3">
              VLAN ↔ VNI State
            </h2>
            <DataTable
              rows={doc.mappings}
              columns={mappingColumns}
              rowId={(r) => String(r.vlan_id)}
              storageKey="monitor-vxlan-mappings"
              searchPlaceholder="Search mappings…"
              emptyMessage="No VLAN↔VNI mappings configured."
              onRefresh={() => load("refresh")}
            />
          </div>
        </div>
      )}
    </MonitorPageShell>
  );
}
