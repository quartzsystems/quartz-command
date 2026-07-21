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
import type { FlowsResponse } from "@/lib/device/flows";
import { formatBytes } from "@/lib/device/format";

/// Sub-org Traffic Flow: a per-firewall roll-up of the last 15 minutes. The
/// full FireWatch Sankey is device-scope (per firewall); here we only need each
/// firewall's window totals, so the fan-out asks for the top-1 record.
export function TrafficFlowAggregate() {
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  const loader = useCallback(
    () =>
      fanoutApi<FlowsResponse>(
        params.organization_guid,
        params.sub_guid,
        "/monitoring/flows?window=15m&metric=bytes&limit=1",
      ),
    [params.organization_guid, params.sub_guid],
  );
  const agg = useAggregate(loader);
  const deviceHref = useDeviceMonitorHref("/traffic-flow");

  const columns: AggregateColumn<FlowsResponse>[] = [
    {
      key: "conns",
      header: "Connections",
      align: "right",
      render: (d) => <span style={{ fontFamily: "var(--qz-font-mono)" }}>{d.total_conns.toLocaleString()}</span>,
    },
    {
      key: "bytes",
      header: "Traffic (15m)",
      align: "right",
      render: (d) => <span style={{ fontFamily: "var(--qz-font-mono)" }}>{formatBytes(d.total_bytes)}</span>,
    },
  ];

  return (
    <MonitorPageShell
      title="Traffic Flow"
      subtitle="Last 15 minutes of connection volume per firewall in this sub-organization"
    >
      <AggregateTable {...agg} columns={columns} deviceHref={deviceHref} onRefresh={() => agg.reload("refresh")} />
    </MonitorPageShell>
  );
}
