"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Pencil, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable, FilterDef } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import {
  SwitchPort,
  SwitchVlan,
  fetchSwitchPorts,
  fetchVlans,
  formatPortSpeed,
} from "@/lib/device/switching";
import { PortFormModal } from "./PortFormModal";

/// Admin state — what the config says the port should be.
function StatusPill({ port }: { port: SwitchPort }) {
  return port.admin_status === "up" ? (
    <span className="badge badge-ok">Enabled</span>
  ) : (
    <span className="badge badge-muted">Disabled</span>
  );
}

/// Live link state — whether the wire actually came up.
function LinkPill({ port }: { port: SwitchPort }) {
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
    key: "link",
    header: "Link",
    value: (r) => r.oper_status,
    render: (r) => <LinkPill port={r} />,
    sortable: true,
    width: 100,
  },
  {
    key: "status",
    header: "Status",
    value: (r) => r.admin_status,
    render: (r) => <StatusPill port={r} />,
    sortable: true,
    width: 110,
  },
];

const filters: FilterDef<SwitchPort>[] = [
  {
    key: "link",
    label: "Link",
    options: [
      { value: "up", label: "Up" },
      { value: "down", label: "Down" },
    ],
    predicate: (r, v) => r.oper_status === v,
  },
  {
    key: "status",
    label: "Status",
    options: [
      { value: "up", label: "Enabled" },
      { value: "down", label: "Disabled" },
    ],
    predicate: (r, v) => r.admin_status === v,
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
  const [vlans, setVlans] = useState<SwitchVlan[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [editing, setEditing] = useState<SwitchPort | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      const [ports, vlanRows] = await Promise.all([fetchSwitchPorts(), fetchVlans()]);
      setRows(ports);
      setVlans(vlanRows);
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
            actionsWidth={60}
            actions={(r) => (
              <button
                type="button"
                title={`Edit ${r.name}`}
                aria-label="Edit"
                onClick={() => setEditing(r)}
                className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
              >
                <Pencil size={14} />
              </button>
            )}
          />
        )}
      </div>

      {editing && (
        <PortFormModal
          port={editing}
          vlans={vlans}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setToast(message);
            load("refresh");
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
