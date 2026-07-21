"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";
import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import {
  AggregateColumn,
  AggregateTable,
  useAggregate,
  useDeviceMonitorHref,
} from "@/components/monitor/AggregateTable";
import { fanoutApi } from "@/lib/device/fanout";

/// Just the fields the sub-org roll-up needs from the device's /recent log
/// response (see TrafficMonitorPanel's RecentLog / the device monitor backend).
interface RecentLogLite {
  entries: { action: string }[];
}

const RECENT = 300;

/// Sub-org Traffic Monitor: a per-firewall roll-up of the most recent log
/// window. The live per-line tail is device-scope (the fan-out is a single
/// request, not a stream), so here each firewall shows its recent allow/block
/// mix with a link into its own live Traffic Monitor.
export function LogsAggregate() {
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  const loader = useCallback(
    () =>
      fanoutApi<RecentLogLite>(
        params.organization_guid,
        params.sub_guid,
        `/monitor/firewall-log/recent?limit=${RECENT}`,
      ),
    [params.organization_guid, params.sub_guid],
  );
  const agg = useAggregate(loader);
  const deviceHref = useDeviceMonitorHref("/logs");

  const mono = (n: number) => <span style={{ fontFamily: "var(--qz-font-mono)" }}>{n.toLocaleString()}</span>;
  const blocked = (d: RecentLogLite) => d.entries.filter((e) => e.action === "drop" || e.action === "reject").length;
  const allowed = (d: RecentLogLite) => d.entries.filter((e) => e.action === "accept").length;

  const columns: AggregateColumn<RecentLogLite>[] = [
    { key: "events", header: `Recent events`, align: "right", render: (d) => mono(d.entries.length) },
    {
      key: "allowed",
      header: "Allowed",
      align: "right",
      render: (d) => <span className="badge badge-ok">{allowed(d)}</span>,
    },
    {
      key: "blocked",
      header: "Blocked",
      align: "right",
      render: (d) => {
        const n = blocked(d);
        return <span className={n ? "badge badge-crit" : "badge badge-muted"}>{n}</span>;
      },
    },
  ];

  return (
    <MonitorPageShell
      title="Traffic Monitor"
      subtitle={`Allow/block mix over the last ${RECENT} firewall-log events per firewall in this sub-organization`}
    >
      <AggregateTable {...agg} columns={columns} deviceHref={deviceHref} onRefresh={() => agg.reload("refresh")} />
    </MonitorPageShell>
  );
}
