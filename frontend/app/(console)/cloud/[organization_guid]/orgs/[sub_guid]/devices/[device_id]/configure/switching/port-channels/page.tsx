"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable, FilterDef } from "@/components/dashboard/DataTable";
import { PortChannel, fetchPortChannels } from "@/lib/device/switching";

function StatusPill({ pc }: { pc: PortChannel }) {
  if (pc.admin_status === "down") return <span className="badge badge-muted">Admin Down</span>;
  if (pc.oper_status === "up") return <span className="badge badge-ok">Up</span>;
  if (pc.oper_status === "down") return <span className="badge badge-crit">Down</span>;
  return <span className="badge badge-muted">Unknown</span>;
}

/// Members as "selected/total" plus the port list; unselected (or down)
/// members render dimmed so a degraded LAG is visible at a glance.
function MembersCell({ pc }: { pc: PortChannel }) {
  if (pc.members.length === 0) return <span className="text-[var(--qz-fg-4)]">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-2">
      {pc.members.map((m) => {
        const healthy = (m.selected ?? true) && m.oper_status === "up";
        return (
          <span
            key={m.name}
            title={`${m.oper_status}${m.selected != null ? ` · ${m.selected ? "selected" : "unselected"}` : ""}`}
            style={healthy ? undefined : { color: "var(--qz-fg-4)" }}
          >
            {m.name}
          </span>
        );
      })}
    </span>
  );
}

const columns: Column<PortChannel>[] = [
  { key: "name", header: "Port Channel", value: (r) => r.name, mono: true, sortable: true, width: 150 },
  {
    key: "protocol",
    header: "Protocol",
    value: (r) => r.protocol,
    render: (r) => (r.protocol === "lacp" ? `LACP${r.fast_rate ? " (fast)" : ""}` : "Static"),
    sortable: true,
    width: 110,
  },
  {
    key: "members",
    header: "Members",
    value: (r) => r.members.map((m) => m.name).join(", "),
    render: (r) => <MembersCell pc={r} />,
    mono: true,
  },
  {
    key: "active",
    header: "Active",
    value: (r) => r.members.filter((m) => m.oper_status === "up").length,
    render: (r) => (
      <span>
        {r.members.filter((m) => m.oper_status === "up").length} of {r.members.length}
      </span>
    ),
    mono: true,
    sortable: true,
    width: 90,
  },
  {
    key: "min_links",
    header: "Min Links",
    value: (r) => r.min_links ?? 0,
    render: (r) =>
      r.min_links != null ? r.min_links : <span className="text-[var(--qz-fg-4)]">—</span>,
    mono: true,
    sortable: true,
    width: 95,
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
    key: "status",
    header: "Status",
    value: (r) => (r.admin_status === "down" ? "admin-down" : r.oper_status),
    render: (r) => <StatusPill pc={r} />,
    sortable: true,
    width: 120,
  },
];

const filters: FilterDef<PortChannel>[] = [
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
];

export default function PortChannelsPage() {
  const [rows, setRows] = useState<PortChannel[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setRows(await fetchPortChannels());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load port channels.");
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
          Port Channels
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">Link aggregation groups</p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading port channels…</div>
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
            storageKey="switching-port-channels"
            searchPlaceholder="Search port channels…"
            emptyMessage="No port channels configured."
            onRefresh={() => load("refresh")}
          />
        )}
      </div>
    </div>
  );
}
