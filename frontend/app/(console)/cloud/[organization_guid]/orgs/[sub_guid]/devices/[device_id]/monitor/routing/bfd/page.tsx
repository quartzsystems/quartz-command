"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import { BfdSession, BfdSessionsDoc, fetchBfdSessions } from "@/lib/device/sonic-bfd";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

function stateBadge(state: BfdSession["state"] | null) {
  switch (state) {
    case "up":
      return <span className="badge badge-ok">Up</span>;
    case "down":
      return <span className="badge badge-crit">Down</span>;
    case "init":
      return <span className="badge badge-info">Init</span>;
    case "admin_down":
      return <span className="badge badge-muted">Admin Down</span>;
    default:
      return dash;
  }
}

/** 3742s → "1h 2m"; keeps the table scannable without exact-second noise. */
function uptime(s: number | null): string {
  if (s == null) return "";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

const columns: Column<BfdSession>[] = [
  { key: "peer", header: "Peer", value: (r) => r.peer, mono: true, sortable: true, width: 170 },
  {
    key: "state",
    header: "State",
    value: (r) => r.state,
    render: (r) => stateBadge(r.state),
    sortable: true,
    width: 95,
  },
  {
    key: "remote",
    header: "Remote State",
    value: (r) => r.remote_state ?? "",
    render: (r) => stateBadge(r.remote_state),
    width: 115,
  },
  {
    key: "interface",
    header: "Interface",
    value: (r) => r.interface ?? "",
    render: (r) => (r.interface ? r.interface : dash),
    mono: true,
    sortable: true,
    width: 120,
  },
  {
    key: "type",
    header: "Type",
    value: (r) => (r.multihop ? "multihop" : "single-hop"),
    render: (r) =>
      r.multihop ? (
        <span className="badge badge-info">Multihop</span>
      ) : (
        <span className="badge badge-muted">Single-hop</span>
      ),
    width: 105,
  },
  {
    key: "vrf",
    header: "VRF",
    value: (r) => r.vrf ?? "default",
    render: (r) => (r.vrf ? r.vrf : <span className="text-[var(--qz-fg-4)]">default</span>),
    mono: true,
    width: 100,
  },
  {
    key: "uptime",
    header: "Uptime",
    value: (r) => r.uptime_seconds ?? -1,
    render: (r) => (r.uptime_seconds != null ? uptime(r.uptime_seconds) : dash),
    mono: true,
    sortable: true,
    width: 100,
  },
  {
    key: "intervals",
    header: "RX / TX (ms)",
    value: (r) => r.rx_interval_ms ?? -1,
    render: (r) =>
      r.rx_interval_ms != null || r.tx_interval_ms != null
        ? `${r.rx_interval_ms ?? "?"} / ${r.tx_interval_ms ?? "?"}`
        : dash,
    mono: true,
    width: 115,
  },
  {
    key: "clients",
    header: "Used By",
    value: (r) => r.clients.join(", "),
    render: (r) =>
      r.clients.length ? (
        r.clients.map((c) => c.toUpperCase()).join(", ")
      ) : (
        <span className="text-[var(--qz-fg-4)]">static</span>
      ),
    width: 110,
  },
  {
    key: "diag",
    header: "Diagnostic",
    value: (r) => r.diagnostic ?? "",
    render: (r) => (r.diagnostic ? r.diagnostic : dash),
    width: 210,
  },
];

/// Live bfdd sessions — including ones BGP/OSPF raise dynamically. Static
/// peers are configured under Configure → Routing → BFD.
export default function BfdMonitorPage() {
  const [doc, setDoc] = useState<BfdSessionsDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchBfdSessions());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load BFD sessions.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <MonitorPageShell
      title="BFD"
      subtitle="Live Bidirectional Forwarding Detection sessions on this switch"
    >
      {status === "loading" && (
        <div className="text-[13px] text-[var(--qz-fg-4)]">Loading BFD sessions…</div>
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
        <FeatureUnavailable feature="BFD" capability={doc.capability} />
      )}
      {status === "ready" && doc && doc.capability.supported && (
        <DataTable
          rows={doc.sessions}
          columns={columns}
          rowId={(r) =>
            `${r.vrf ?? "default"}|${r.interface ?? "-"}|${r.peer}|${r.multihop ? "mh" : "sh"}`
          }
          storageKey="monitor-bfd-sessions"
          searchPlaceholder="Search peers…"
          emptyMessage="No BFD sessions are running."
          onRefresh={() => load("refresh")}
        />
      )}
    </MonitorPageShell>
  );
}
