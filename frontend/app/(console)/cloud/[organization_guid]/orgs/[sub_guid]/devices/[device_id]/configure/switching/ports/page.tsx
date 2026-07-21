"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable, FilterDef } from "@/components/dashboard/DataTable";
import {
  SwitchPort,
  fetchSwitchPorts,
  formatPortSpeed,
} from "@/lib/device/switching";

/// Oper status wins the pill; an admin-shut port is called out separately from
/// one that is enabled but has no link.
function StatusPill({ port }: { port: SwitchPort }) {
  if (port.admin_status === "down") return <span className="badge badge-muted">Admin Down</span>;
  if (port.oper_status === "up") return <span className="badge badge-ok">Up</span>;
  if (port.oper_status === "down") return <span className="badge badge-crit">Down</span>;
  return <span className="badge badge-muted">Unknown</span>;
}

function VlanModeCell({ port }: { port: SwitchPort }) {
  if (port.vlan_mode === "access") {
    return <span>Access{port.untagged_vlan != null ? ` (${port.untagged_vlan})` : ""}</span>;
  }
  if (port.vlan_mode === "trunk") {
    const vlans = [
      ...(port.untagged_vlan != null ? [`native ${port.untagged_vlan}`] : []),
      ...port.tagged_vlans.map(String),
    ];
    return <span title={vlans.length ? `VLANs: ${vlans.join(", ")}` : undefined}>Trunk</span>;
  }
  if (port.vlan_mode === "routed") return <span>Routed</span>;
  return <span className="text-[var(--qz-fg-4)]">—</span>;
}

/// "RX / TX" cumulative error counters; either side lights red when non-zero.
function ErrCell({ port }: { port: SwitchPort }) {
  if (port.rx_err == null && port.tx_err == null) {
    return <span className="text-[var(--qz-fg-4)]">—</span>;
  }
  const side = (v: number | null) =>
    v == null ? "—" : v > 0 ? <span style={{ color: "var(--qz-danger)" }}>{v}</span> : <>{v}</>;
  return (
    <span title={`Discards: ${port.rx_drops ?? "—"} rx / ${port.tx_drops ?? "—"} tx`}>
      {side(port.rx_err)} / {side(port.tx_err)}
    </span>
  );
}

const columns: Column<SwitchPort>[] = [
  {
    key: "name",
    header: "Interface",
    value: (r) => r.name,
    render: (r) => <span title={r.alias ?? undefined}>{r.name}</span>,
    mono: true,
    sortable: true,
    width: 130,
  },
  { key: "description", header: "Description", value: (r) => r.description ?? "", sortable: true },
  {
    key: "speed",
    header: "Speed",
    value: (r) => r.speed_mbps ?? 0,
    render: (r) =>
      formatPortSpeed(r.speed_mbps) ?? <span className="text-[var(--qz-fg-4)]">—</span>,
    mono: true,
    sortable: true,
    width: 90,
  },
  {
    key: "fec",
    header: "FEC",
    value: (r) => r.fec ?? "",
    render: (r) =>
      r.fec ? r.fec.toUpperCase() : <span className="text-[var(--qz-fg-4)]">—</span>,
    mono: true,
    sortable: true,
    width: 80,
  },
  {
    key: "mtu",
    header: "MTU",
    value: (r) => r.mtu ?? 0,
    render: (r) => (r.mtu != null ? r.mtu : <span className="text-[var(--qz-fg-4)]">—</span>),
    mono: true,
    sortable: true,
    width: 80,
  },
  {
    key: "vlan_mode",
    header: "VLAN Mode",
    value: (r) => r.vlan_mode ?? "",
    render: (r) => <VlanModeCell port={r} />,
    sortable: true,
    width: 120,
  },
  {
    key: "errors",
    header: "RX/TX ERR",
    value: (r) => (r.rx_err ?? 0) + (r.tx_err ?? 0),
    render: (r) => <ErrCell port={r} />,
    mono: true,
    sortable: true,
    width: 110,
  },
  {
    key: "status",
    header: "Status",
    value: (r) => (r.admin_status === "down" ? "admin-down" : r.oper_status),
    render: (r) => <StatusPill port={r} />,
    sortable: true,
    width: 120,
  },
];

const filters: FilterDef<SwitchPort>[] = [
  {
    key: "status",
    label: "Status",
    options: [
      { value: "up", label: "Up" },
      { value: "down", label: "Down" },
      { value: "admin-down", label: "Admin Down" },
    ],
    predicate: (r, v) =>
      v === "admin-down"
        ? r.admin_status === "down"
        : r.admin_status === "up" && r.oper_status === v,
  },
  {
    key: "vlan_mode",
    label: "VLAN Mode",
    options: [
      { value: "access", label: "Access" },
      { value: "trunk", label: "Trunk" },
      { value: "routed", label: "Routed" },
    ],
    predicate: (r, v) => r.vlan_mode === v,
  },
];

export default function PortsPage() {
  const [rows, setRows] = useState<SwitchPort[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setRows(await fetchSwitchPorts());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load ports.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Ports
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">Front-panel switch ports</p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading ports…</div>
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
        {status === "ready" && (
          <DataTable
            rows={rows}
            columns={columns}
            filters={filters}
            rowId={(r) => r.name}
            storageKey="switching-ports"
            searchPlaceholder="Search ports…"
            emptyMessage="No switch ports found."
            onRefresh={() => load("refresh")}
          />
        )}
      </div>
    </div>
  );
}
