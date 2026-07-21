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
import { fanoutShow } from "@/lib/device/fanout";
import { colIndex, parseFixedTable, parseWireguardStatus } from "@/lib/device/vpn-status";

function useScope() {
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  return { orgGuid: params.organization_guid, subGuid: params.sub_guid };
}

function upTotal(up: number, total: number) {
  const cls = total === 0 ? "badge badge-muted" : up === total ? "badge badge-ok" : "badge badge-warn";
  return (
    <span className={cls}>
      {up}/{total}
    </span>
  );
}

const numCell = (n: number) => <span style={{ fontFamily: "var(--qz-font-mono)" }}>{n}</span>;

/// Count "up" rows in an op-mode table by a state column, matching the
/// device-scope panels' `isUp` heuristics per protocol.
function countUp(text: string, headerKeyword: string, stateCandidates: string[], isUp: (s: string) => boolean) {
  const table = parseFixedTable(text, headerKeyword);
  const col = colIndex(table, ...stateCandidates);
  const total = table.rows.length;
  const up = col >= 0 ? table.rows.filter((r) => isUp(r[col] ?? "")).length : 0;
  return { up, total };
}

export function WireguardAggregate() {
  const { orgGuid, subGuid } = useScope();
  const loader = useCallback(
    () => fanoutShow(orgGuid, subGuid, ["interfaces", "wireguard"]),
    [orgGuid, subGuid],
  );
  const agg = useAggregate(loader);
  const deviceHref = useDeviceMonitorHref("/vpn/wireguard");

  const columns: AggregateColumn<string>[] = [
    { key: "ifaces", header: "Interfaces", align: "right", render: (t) => numCell(parseWireguardStatus(t).length) },
    {
      key: "peers",
      header: "Peers",
      render: (t) => {
        const peers = parseWireguardStatus(t).flatMap((i) => i.peers);
        const up = peers.filter((p) => p.latest_handshake && p.latest_handshake.trim() !== "").length;
        return upTotal(up, peers.length);
      },
    },
  ];

  return (
    <MonitorPageShell title="WireGuard" subtitle="WireGuard peers across this sub-organization's firewalls">
      <AggregateTable {...agg} columns={columns} deviceHref={deviceHref} onRefresh={() => agg.reload("refresh")} />
    </MonitorPageShell>
  );
}

export function OpenvpnAggregate() {
  const { orgGuid, subGuid } = useScope();
  const loader = useCallback(
    () => fanoutShow(orgGuid, subGuid, ["interfaces", "openvpn"]),
    [orgGuid, subGuid],
  );
  const agg = useAggregate(loader);
  const deviceHref = useDeviceMonitorHref("/vpn/openvpn");
  const isUp = (s: string) => {
    const [a, l] = s.split("/");
    return a?.toLowerCase() === "u" && l?.toLowerCase() === "u";
  };

  const columns: AggregateColumn<string>[] = [
    {
      key: "tunnels",
      header: "Tunnels",
      render: (t) => {
        const { up, total } = countUp(t, "Interface", ["S/L"], isUp);
        return upTotal(up, total);
      },
    },
  ];

  return (
    <MonitorPageShell title="OpenVPN" subtitle="OpenVPN tunnels across this sub-organization's firewalls">
      <AggregateTable {...agg} columns={columns} deviceHref={deviceHref} onRefresh={() => agg.reload("refresh")} />
    </MonitorPageShell>
  );
}

export function IpsecAggregate() {
  const { orgGuid, subGuid } = useScope();
  const loader = useCallback(
    () => fanoutShow(orgGuid, subGuid, ["vpn", "ipsec", "sa"]),
    [orgGuid, subGuid],
  );
  const agg = useAggregate(loader);
  const deviceHref = useDeviceMonitorHref("/vpn/ipsec");
  const isUp = (s: string) => s.toLowerCase().startsWith("up") || s.toLowerCase().startsWith("est");

  const columns: AggregateColumn<string>[] = [
    {
      key: "sas",
      header: "Security Assocs.",
      render: (t) => {
        const { up, total } = countUp(t, "Connection", ["State"], isUp);
        return upTotal(up, total);
      },
    },
  ];

  return (
    <MonitorPageShell title="IPsec" subtitle="IPsec security associations across this sub-organization's firewalls">
      <AggregateTable {...agg} columns={columns} deviceHref={deviceHref} onRefresh={() => agg.reload("refresh")} />
    </MonitorPageShell>
  );
}

export function L2tpAggregate() {
  const { orgGuid, subGuid } = useScope();
  const loader = useCallback(
    () => fanoutShow(orgGuid, subGuid, ["vpn", "remote-access"]),
    [orgGuid, subGuid],
  );
  const agg = useAggregate(loader);
  const deviceHref = useDeviceMonitorHref("/vpn/l2tp");
  const isActive = (s: string) => {
    const v = s.toLowerCase();
    return v.startsWith("active") || v.startsWith("estab") || v.startsWith("up");
  };

  const columns: AggregateColumn<string>[] = [
    {
      key: "sessions",
      header: "Sessions",
      render: (t) => {
        const { up, total } = countUp(t, "user", ["state"], isActive);
        return upTotal(up, total);
      },
    },
  ];

  return (
    <MonitorPageShell title="L2TP" subtitle="L2TP remote-access sessions across this sub-organization's firewalls">
      <AggregateTable {...agg} columns={columns} deviceHref={deviceHref} onRefresh={() => agg.reload("refresh")} />
    </MonitorPageShell>
  );
}
