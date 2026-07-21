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
import type { OspfSummary } from "@/lib/device/ospf-status";
import type { BgpSummary } from "@/lib/device/bgp-status";
import type { IsisSummary } from "@/lib/device/isis-status";
import type { MplsStatus } from "@/lib/device/mpls-status";

const mono = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? (
    <span className="text-[var(--qz-fg-4)]">—</span>
  ) : (
    <span style={{ fontFamily: "var(--qz-font-mono)" }}>{v}</span>
  );

/// "up/total" with a health badge: green when all up, amber when some, muted at
/// zero. The shared shape for every adjacency/peer count in these aggregates.
function upTotal(up: number, total: number) {
  const cls = total === 0 ? "badge badge-muted" : up === total ? "badge badge-ok" : "badge badge-warn";
  return (
    <span className={cls}>
      {up}/{total}
    </span>
  );
}

function runningBadge(running: boolean) {
  return running ? <span className="badge badge-ok">running</span> : <span className="badge badge-muted">stopped</span>;
}

function useScope() {
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  return { orgGuid: params.organization_guid, subGuid: params.sub_guid };
}

export function OspfAggregate() {
  const { orgGuid, subGuid } = useScope();
  const loader = useCallback(() => fanoutApi<OspfSummary>(orgGuid, subGuid, "/ospf/summary"), [orgGuid, subGuid]);
  const agg = useAggregate(loader);
  const deviceHref = useDeviceMonitorHref("/routing/ospf");

  const columns: AggregateColumn<OspfSummary>[] = [
    { key: "router_id", header: "Router ID", render: (d) => mono(d.router_id) },
    { key: "areas", header: "Areas", align: "right", render: (d) => mono(d.areas.length) },
    {
      key: "adj",
      header: "Adjacencies",
      render: (d) => upTotal(d.neighbors.filter((n) => n.is_up).length, d.neighbors.length),
    },
    { key: "state", header: "State", render: (d) => runningBadge(d.running) },
  ];

  return (
    <MonitorPageShell title="OSPF" subtitle="OSPFv2 adjacencies across this sub-organization's firewalls">
      <AggregateTable {...agg} columns={columns} deviceHref={deviceHref} onRefresh={() => agg.reload("refresh")} />
    </MonitorPageShell>
  );
}

export function BgpAggregate() {
  const { orgGuid, subGuid } = useScope();
  const loader = useCallback(() => fanoutApi<BgpSummary>(orgGuid, subGuid, "/bgp/summary"), [orgGuid, subGuid]);
  const agg = useAggregate(loader);
  const deviceHref = useDeviceMonitorHref("/routing/bgp");

  const columns: AggregateColumn<BgpSummary>[] = [
    { key: "local_as", header: "Local AS", render: (d) => mono(d.local_as) },
    { key: "router_id", header: "Router ID", render: (d) => mono(d.router_id) },
    {
      key: "peers",
      header: "Peers",
      render: (d) => {
        const est = d.address_families.reduce((n, af) => n + af.established_peers, 0);
        const total = d.address_families.reduce((n, af) => n + af.total_peers, 0);
        return upTotal(est, total);
      },
    },
  ];

  return (
    <MonitorPageShell title="BGP" subtitle="BGP sessions across this sub-organization's firewalls">
      <AggregateTable {...agg} columns={columns} deviceHref={deviceHref} onRefresh={() => agg.reload("refresh")} />
    </MonitorPageShell>
  );
}

export function IsisAggregate() {
  const { orgGuid, subGuid } = useScope();
  const loader = useCallback(() => fanoutApi<IsisSummary>(orgGuid, subGuid, "/isis/summary"), [orgGuid, subGuid]);
  const agg = useAggregate(loader);
  const deviceHref = useDeviceMonitorHref("/routing/isis");

  const columns: AggregateColumn<IsisSummary>[] = [
    { key: "areas", header: "Areas", align: "right", render: (d) => mono(d.areas.length) },
    {
      key: "adj",
      header: "Adjacencies",
      render: (d) => upTotal(d.neighbors.filter((n) => n.is_up).length, d.neighbors.length),
    },
    { key: "state", header: "State", render: (d) => runningBadge(d.running) },
  ];

  return (
    <MonitorPageShell title="IS-IS" subtitle="IS-IS adjacencies across this sub-organization's firewalls">
      <AggregateTable {...agg} columns={columns} deviceHref={deviceHref} onRefresh={() => agg.reload("refresh")} />
    </MonitorPageShell>
  );
}

export function MplsAggregate() {
  const { orgGuid, subGuid } = useScope();
  const loader = useCallback(() => fanoutApi<MplsStatus>(orgGuid, subGuid, "/mpls/status"), [orgGuid, subGuid]);
  const agg = useAggregate(loader);
  const deviceHref = useDeviceMonitorHref("/routing/mpls");

  const columns: AggregateColumn<MplsStatus>[] = [
    { key: "ldp", header: "LDP", render: (d) => runningBadge(d.ldp_running) },
    {
      key: "neighbors",
      header: "Neighbors",
      render: (d) => upTotal(d.neighbors.filter((n) => n.is_up).length, d.neighbors.length),
    },
  ];

  return (
    <MonitorPageShell title="MPLS" subtitle="LDP sessions across this sub-organization's firewalls">
      <AggregateTable {...agg} columns={columns} deviceHref={deviceHref} onRefresh={() => agg.reload("refresh")} />
    </MonitorPageShell>
  );
}
