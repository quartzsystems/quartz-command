"use client";

// Monitoring → Logs — per-service event logs for the security services
// (Intrusion Prevention, Application Control, Geolocation, Content Filtering).
//
// Device scope: each service's recent events, polled through the device proxy
// (the console reaches devices only over the proxy, so this polls the same
// history/log endpoints the Configure pages read rather than a live SSE) and
// rendered as a filterable table with an all/allowed/blocked toggle.
//
// Sub-org scope: a per-firewall roll-up of the same window (events + allow/block
// counts) built from one fan-out, each row linking into that firewall's live
// device-scope log — the same shape as the Traffic Monitor aggregate.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Pause, Play, RotateCw, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import {
  AggregateColumn,
  AggregateTable,
  useAggregate,
  useDeviceMonitorHref,
} from "@/components/monitor/AggregateTable";
import { fanoutApi } from "@/lib/device/fanout";
import { fetchIpsAlertHistory, alertKey, type IpsAlert } from "@/lib/device/ips";
import { fetchAcAlertHistory, eventKey as acKey, type AcEvent } from "@/lib/device/appcontrol";
import { fetchGeoAlertHistory, geoEventKey, type GeoEvent } from "@/lib/device/geolocation";
import { fetchCfLogs, type CfLogEntry } from "@/lib/device/content-filtering";

const POLL_MS = 6000;
const MAX_ROWS = 500;

type Verdict = "allowed" | "blocked" | "other";

function verdictBadge(v: Verdict) {
  if (v === "blocked") return <span className="badge badge-crit">Blocked</span>;
  if (v === "allowed") return <span className="badge badge-ok">Allowed</span>;
  return <span className="badge badge-muted">Scanned</span>;
}

const fmtTime = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toLocaleString() : "—");
const endpoint = (ip?: string, port?: number) => (ip ? (port ? `${ip}:${port}` : ip) : "—");

// ── polled log hook (device scope) ───────────────────────────────────────────

function usePolledLog<T>(fetcher: () => Promise<T[]>) {
  const [rows, setRows] = useState<T[]>([]);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const reload = useCallback(() => {
    fetcher()
      .then((r) => {
        setRows(r.slice(0, MAX_ROWS));
        setUpdated(new Date());
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, [fetcher]);

  useEffect(() => {
    reload();
    const t = setInterval(() => {
      if (!document.hidden && !pausedRef.current) reload();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  return { rows, updated, error, loading, paused, setPaused, reload };
}

// ── device-scope log table ───────────────────────────────────────────────────

interface LogColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  align?: "right";
  width?: number;
}

function LogTableView<T>({
  title,
  subtitle,
  rows,
  columns,
  rowKey,
  verdictOf,
  verdictFilter = true,
  searchOf,
  updated,
  error,
  loading,
  paused,
  onPause,
  onRefresh,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  rows: T[];
  columns: LogColumn<T>[];
  rowKey: (row: T) => string;
  verdictOf?: (row: T) => Verdict;
  /** Show the all/allowed/blocked toggle (off for block-only logs like Geo). */
  verdictFilter?: boolean;
  searchOf: (row: T) => string;
  updated: Date | null;
  error: string | null;
  loading: boolean;
  paused: boolean;
  onPause: () => void;
  onRefresh: () => void;
  emptyMessage: string;
}) {
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState<"all" | "allowed" | "blocked">("all");
  const showVerdict = verdictFilter && !!verdictOf;

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (showVerdict && verdict !== "all" && verdictOf!(r) !== verdict) return false;
        if (q && !searchOf(r).toLowerCase().includes(q)) return false;
        return true;
      }),
    [rows, showVerdict, verdict, q, verdictOf, searchOf],
  );

  return (
    <MonitorPageShell title={title} subtitle={subtitle}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[var(--qz-fg-4)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter events…"
              className="rounded-md pl-8 pr-3 py-[7px] text-[13px] text-[var(--qz-fg-1)] outline-none w-[240px]"
              style={{ background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" }}
            />
          </div>
          {showVerdict && (
            <Segmented
              items={[
                { value: "all", label: "All" },
                { value: "allowed", label: "Allowed" },
                { value: "blocked", label: "Blocked" },
              ]}
              value={verdict}
              onChange={(v) => setVerdict(v as typeof verdict)}
            />
          )}
          <div className="ml-auto flex items-center gap-3">
            <Button kind="secondary" size="sm" icon={RotateCw} onClick={onRefresh}>
              Refresh
            </Button>
            <Button kind="secondary" size="sm" icon={paused ? Play : Pause} onClick={onPause}>
              {paused ? "Resume" : "Pause"}
            </Button>
            <span className="text-[12px] text-[var(--qz-fg-4)]">
              {error
                ? "Unavailable"
                : loading
                  ? "Loading…"
                  : `${visible.length} ${visible.length === 1 ? "event" : "events"}${updated ? ` · ${updated.toLocaleTimeString()}` : ""}`}
            </span>
          </div>
        </div>

        <div className="rounded-md overflow-x-auto" style={{ border: "1px solid var(--qz-border)" }}>
          <table className="qz-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={c.align === "right" ? "text-right" : undefined}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="text-center text-[var(--qz-fg-4)]" style={{ cursor: "default" }}>
                    {error ? error : loading ? "Loading…" : emptyMessage}
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr key={rowKey(r)} style={{ cursor: "default" }}>
                    {columns.map((c) => (
                      <td key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                        {c.render(r)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MonitorPageShell>
  );
}

// ── Intrusion Prevention ─────────────────────────────────────────────────────

const ipsVerdict = (a: IpsAlert): Verdict => (a.action === "blocked" ? "blocked" : "allowed");

const IPS_COLS: LogColumn<IpsAlert>[] = [
  { key: "time", header: "Time", render: (r) => fmtTime(r.ts), width: 180 },
  { key: "level", header: "Level", render: (r) => <span className="uppercase text-[var(--qz-fg-2)]">{r.level}</span>, width: 90 },
  { key: "sig", header: "Signature", render: (r) => <span className="text-[var(--qz-fg-1)]">{r.signature}</span> },
  { key: "src", header: "Source", render: (r) => <span className="mono text-[12px]">{endpoint(r.src, r.spt)}</span> },
  { key: "dst", header: "Destination", render: (r) => <span className="mono text-[12px]">{endpoint(r.dst, r.dpt)}</span> },
  { key: "action", header: "Action", render: (r) => verdictBadge(ipsVerdict(r)), width: 110 },
];

export function IpsLogPanel() {
  const log = usePolledLog<IpsAlert>(fetchIpsAlertHistory);
  return (
    <LogTableView
      title="Intrusion Prevention"
      subtitle="Recent IPS alerts on this firewall — allowed (alert-only) and blocked (dropped inline)"
      rows={log.rows}
      columns={IPS_COLS}
      rowKey={alertKey}
      verdictOf={ipsVerdict}
      searchOf={(r) => `${r.signature} ${r.category ?? ""} ${r.src ?? ""} ${r.dst ?? ""}`}
      updated={log.updated}
      error={log.error}
      loading={log.loading}
      paused={log.paused}
      onPause={() => log.setPaused((p) => !p)}
      onRefresh={log.reload}
      emptyMessage="No IPS alerts yet — alerts appear when inspected traffic matches a signature."
    />
  );
}

// ── Application Control ──────────────────────────────────────────────────────

const acVerdict = (e: AcEvent): Verdict => (e.action === "block" ? "blocked" : "allowed");

const AC_COLS: LogColumn<AcEvent>[] = [
  { key: "time", header: "Time", render: (r) => fmtTime(r.ts), width: 180 },
  { key: "app", header: "Application", render: (r) => <span className="text-[var(--qz-fg-1)]">{r.app}</span> },
  { key: "cat", header: "Category", render: (r) => <span className="text-[var(--qz-fg-2)]">{r.category ?? "—"}</span>, width: 150 },
  { key: "src", header: "Source", render: (r) => <span className="mono text-[12px]">{endpoint(r.src, r.spt)}</span> },
  { key: "dst", header: "Destination", render: (r) => <span className="mono text-[12px]">{r.sni || endpoint(r.dst, r.dpt)}</span> },
  { key: "action", header: "Action", render: (r) => verdictBadge(acVerdict(r)), width: 110 },
];

export function AppControlLogPanel() {
  const log = usePolledLog<AcEvent>(fetchAcAlertHistory);
  return (
    <LogTableView
      title="Application Control"
      subtitle="Recent application-control decisions on this firewall — allowed and blocked by nDPI app/category"
      rows={log.rows}
      columns={AC_COLS}
      rowKey={acKey}
      verdictOf={acVerdict}
      searchOf={(r) => `${r.app} ${r.category ?? ""} ${r.sni ?? ""} ${r.src ?? ""} ${r.dst ?? ""}`}
      updated={log.updated}
      error={log.error}
      loading={log.loading}
      paused={log.paused}
      onPause={() => log.setPaused((p) => !p)}
      onRefresh={log.reload}
      emptyMessage="No application-control events yet."
    />
  );
}

// ── Geolocation (block events only) ──────────────────────────────────────────

const GEO_COLS: LogColumn<GeoEvent>[] = [
  { key: "time", header: "Time", render: (r) => fmtTime(r.ts), width: 180 },
  { key: "country", header: "Country", render: (r) => <span className="text-[var(--qz-fg-1)]">{r.country_name ?? r.country ?? "—"}</span>, width: 170 },
  { key: "src", header: "Source", render: (r) => <span className="mono text-[12px]">{endpoint(r.src, r.spt)}</span> },
  { key: "dst", header: "Destination", render: (r) => <span className="mono text-[12px]">{endpoint(r.dst, r.dpt)}</span> },
  { key: "proto", header: "Proto", render: (r) => <span className="mono text-[12px]">{r.proto ?? "—"}</span>, width: 90 },
  { key: "action", header: "Action", render: () => verdictBadge("blocked"), width: 110 },
];

export function GeolocationLogPanel() {
  const log = usePolledLog<GeoEvent>(fetchGeoAlertHistory);
  return (
    <LogTableView
      title="Geolocation"
      subtitle="Recent geolocation blocks on this firewall — connections dropped by country policy"
      rows={log.rows}
      columns={GEO_COLS}
      rowKey={geoEventKey}
      verdictFilter={false}
      searchOf={(r) => `${r.country_name ?? ""} ${r.country ?? ""} ${r.src ?? ""} ${r.dst ?? ""} ${r.action_name}`}
      updated={log.updated}
      error={log.error}
      loading={log.loading}
      paused={log.paused}
      onPause={() => log.setPaused((p) => !p)}
      onRefresh={log.reload}
      emptyMessage="No geolocation blocks yet — blocked connections to/from filtered countries appear here."
    />
  );
}

// ── Content Filtering ────────────────────────────────────────────────────────

const cfVerdict = (e: CfLogEntry): Verdict =>
  e.action === "blocked" ? "blocked" : e.action === "allowed" ? "allowed" : "other";
const cfKey = (e: CfLogEntry) => `${e.ts}:${e.client_ip}:${e.url}`;

const CF_COLS: LogColumn<CfLogEntry>[] = [
  { key: "time", header: "Time", render: (r) => fmtTime(Date.parse(r.ts)), width: 180 },
  { key: "client", header: "Client", render: (r) => <span className="mono text-[12px]">{r.user ? `${r.client_ip} · ${r.user}` : r.client_ip}</span>, width: 180 },
  { key: "url", header: "URL", render: (r) => <span className="text-[var(--qz-fg-1)] truncate inline-block max-w-[420px] align-bottom" title={r.url}>{r.url}</span> },
  { key: "cat", header: "Category", render: (r) => <span className="text-[var(--qz-fg-2)]">{r.category ?? "—"}</span>, width: 150 },
  { key: "action", header: "Action", render: (r) => verdictBadge(cfVerdict(r)), width: 110 },
];

export function ContentFilteringLogPanel() {
  const fetcher = useCallback(() => fetchCfLogs({ limit: MAX_ROWS }), []);
  const log = usePolledLog<CfLogEntry>(fetcher);
  return (
    <LogTableView
      title="Content Filtering"
      subtitle="Recent web requests on this firewall — allowed, scanned, and blocked by category/blocklist"
      rows={log.rows}
      columns={CF_COLS}
      rowKey={cfKey}
      verdictOf={cfVerdict}
      searchOf={(r) => `${r.url} ${r.category ?? ""} ${r.client_ip} ${r.user ?? ""} ${r.reason ?? ""}`}
      updated={log.updated}
      error={log.error}
      loading={log.loading}
      paused={log.paused}
      onPause={() => log.setPaused((p) => !p)}
      onRefresh={log.reload}
      emptyMessage="No web requests logged yet."
    />
  );
}

// ── sub-org roll-ups ─────────────────────────────────────────────────────────

const numCell = (n: number) => <span style={{ fontFamily: "var(--qz-font-mono)" }}>{n.toLocaleString()}</span>;
const okBadge = (n: number) => <span className="badge badge-ok">{n.toLocaleString()}</span>;
const critBadge = (n: number) => <span className={n ? "badge badge-crit" : "badge badge-muted"}>{n.toLocaleString()}</span>;

function useScope() {
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  return { orgGuid: params.organization_guid, subGuid: params.sub_guid };
}

/// One roll-up page: fan out `path`, count events per firewall with the given
/// classifier, and render events/allowed/blocked columns linking into each
/// firewall's device-scope log.
function LogAggregate<T>({
  title,
  subtitle,
  path,
  suffix,
  extract,
  verdictOf,
  blockedOnly = false,
}: {
  title: string;
  subtitle: string;
  path: string;
  suffix: string;
  extract: (data: unknown) => T[];
  verdictOf: (row: T) => Verdict;
  /** Block-only logs (Geolocation): drop the Allowed column. */
  blockedOnly?: boolean;
}) {
  const { orgGuid, subGuid } = useScope();
  const loader = useCallback(
    () => fanoutApi<unknown>(orgGuid, subGuid, path).then((items) => items.map((it) => ({ ...it, data: it.data == null ? null : extract(it.data) }))),
    [orgGuid, subGuid, path, extract],
  );
  const agg = useAggregate<T[]>(loader);
  const deviceHref = useDeviceMonitorHref(suffix);

  const columns: AggregateColumn<T[]>[] = [
    { key: "events", header: "Recent events", align: "right", render: (rows) => numCell(rows.length) },
    ...(blockedOnly
      ? []
      : [{ key: "allowed", header: "Allowed", align: "right" as const, render: (rows: T[]) => okBadge(rows.filter((r) => verdictOf(r) === "allowed").length) }]),
    { key: "blocked", header: "Blocked", align: "right", render: (rows) => critBadge(rows.filter((r) => verdictOf(r) === "blocked").length) },
  ];

  return (
    <MonitorPageShell title={title} subtitle={subtitle}>
      <AggregateTable {...agg} columns={columns} deviceHref={deviceHref} onRefresh={() => agg.reload("refresh")} />
    </MonitorPageShell>
  );
}

export function IpsLogsAggregate() {
  return (
    <LogAggregate<IpsAlert>
      title="Intrusion Prevention"
      subtitle="Recent IPS allow/block mix per firewall in this sub-organization"
      path="/ips/alerts/history"
      suffix="/logs/ips"
      extract={(d) => d as IpsAlert[]}
      verdictOf={ipsVerdict}
    />
  );
}

export function AppControlLogsAggregate() {
  return (
    <LogAggregate<AcEvent>
      title="Application Control"
      subtitle="Recent application-control allow/block mix per firewall in this sub-organization"
      path="/appcontrol/alerts/history"
      suffix="/logs/application-control"
      extract={(d) => d as AcEvent[]}
      verdictOf={acVerdict}
    />
  );
}

export function GeolocationLogsAggregate() {
  return (
    <LogAggregate<GeoEvent>
      title="Geolocation"
      subtitle="Recent geolocation blocks per firewall in this sub-organization"
      path="/geolocation/alerts/history"
      suffix="/logs/geolocation"
      extract={(d) => d as GeoEvent[]}
      verdictOf={() => "blocked"}
      blockedOnly
    />
  );
}

export function ContentFilteringLogsAggregate() {
  return (
    <LogAggregate<CfLogEntry>
      title="Content Filtering"
      subtitle="Recent web-request allow/block mix per firewall in this sub-organization"
      path={`/content-filtering/logs?limit=${MAX_ROWS}`}
      suffix="/logs/content-filtering"
      extract={(d) => (d as { entries?: CfLogEntry[] }).entries ?? []}
      verdictOf={cfVerdict}
    />
  );
}
