"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import { FdbTableDoc, FdbTableEntry, fetchFdbTable } from "@/lib/device/sonic-fdb";

const columns: Column<FdbTableEntry>[] = [
  { key: "vlan", header: "VLAN", value: (r) => r.vlan_id, mono: true, sortable: true, width: 90 },
  { key: "mac", header: "MAC Address", value: (r) => r.mac, mono: true, sortable: true, width: 190 },
  { key: "port", header: "Port", value: (r) => r.port, mono: true, sortable: true, width: 150 },
  {
    key: "origin",
    header: "Origin",
    value: (r) => r.origin,
    render: (r) =>
      r.origin === "static" ? (
        <span className="badge badge-info">Static</span>
      ) : (
        <span className="badge badge-muted">Dynamic</span>
      ),
    sortable: true,
    width: 100,
  },
];

/// Read-only view of the switch's forwarding database (what `show mac`
/// prints). Aging time and static entries are edited under Configure →
/// Switching → MAC Table.
export default function MacTableMonitorPage() {
  const [doc, setDoc] = useState<FdbTableDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchFdbTable());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load the MAC table.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <MonitorPageShell
      title="MAC Table"
      subtitle="Learned and static entries in this switch's forwarding database"
    >
      {status === "loading" && (
        <div className="text-[13px] text-[var(--qz-fg-4)]">Loading MAC table…</div>
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
        <FeatureUnavailable feature="The MAC table" capability={doc.capability} />
      )}
      {status === "ready" && doc && doc.capability.supported && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-[var(--qz-fg-4)] m-0">
            {doc.entries.length.toLocaleString()} entries
          </p>
          <DataTable
            rows={doc.entries}
            columns={columns}
            rowId={(r) => `${r.vlan_id}:${r.mac}`}
            storageKey="monitor-fdb-table"
            searchPlaceholder="Search MAC / port / VLAN…"
            emptyMessage="The forwarding database is empty."
            onRefresh={() => load("refresh")}
          />
        </div>
      )}
    </MonitorPageShell>
  );
}
