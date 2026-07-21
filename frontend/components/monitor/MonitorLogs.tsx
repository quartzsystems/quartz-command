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
import { ChevronDown, Columns3, Eraser, Pause, Play, RotateCw, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { useColumnResize } from "@/components/dashboard/ColumnResize";
import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import {
  AggregateColumn,
  AggregateTable,
  useAggregate,
  useDeviceMonitorHref,
} from "@/components/monitor/AggregateTable";
import { fanoutApi } from "@/lib/device/fanout";
import { fetchIpsAlertHistory, alertKey, THREAT_LEVELS, type IpsAlert, type ThreatLevel } from "@/lib/device/ips";
import { fetchAcAlertHistory, eventKey as acKey, type AcEvent } from "@/lib/device/appcontrol";
import { fetchGeoAlertHistory, geoEventKey, type GeoEvent } from "@/lib/device/geolocation";
import { fetchCfLogs, type CfLogEntry } from "@/lib/device/content-filtering";

const POLL_MS = 6000;
const MAX_ROWS = 500;

type Verdict = "allowed" | "blocked" | "other";

/// Action pill matching the firewall's local WebUI: an outlined, tinted chip
/// (green Allowed / red Blocked / neutral Scanned) rather than the filled badge.
function verdictBadge(v: Verdict) {
  const meta =
    v === "blocked"
      ? { label: "Blocked", color: "var(--qz-danger)" }
      : v === "allowed"
        ? { label: "Allowed", color: "var(--qz-success)" }
        : { label: "Scanned", color: "var(--qz-fg-4)" };
  return (
    <span
      className="inline-flex items-center text-[11px] font-semibold rounded-md px-[8px] py-[2px] leading-none"
      style={{
        color: meta.color,
        border: `1px solid color-mix(in oklab, ${meta.color} 40%, transparent)`,
        background: `color-mix(in oklab, ${meta.color} 12%, transparent)`,
      }}
    >
      {meta.label}
    </span>
  );
}

/// Severity dot + label, colored from the IPS threat-level scale (Medium =
/// amber, etc.) — mirrors the local WebUI's Level column.
function levelDot(level: ThreatLevel) {
  const meta = THREAT_LEVELS.find((t) => t.level === level);
  return (
    <span className="inline-flex items-center gap-[7px]">
      <span
        className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0"
        style={{ background: meta?.color ?? "var(--qz-fg-4)" }}
      />
      <span className="text-[var(--qz-fg-2)]">{meta?.label ?? level}</span>
    </span>
  );
}

/// IP:port with the port dimmed, matching the local WebUI's endpoint styling.
function endpointCell(ip?: string, port?: number) {
  if (!ip) return <span className="mono text-[12px] text-[var(--qz-fg-4)]">—</span>;
  return (
    <span className="mono text-[12px]">
      <span style={{ color: "var(--qz-fg-1)" }}>{ip}</span>
      {port ? <span style={{ color: "var(--qz-fg-4)" }}>:{port}</span> : null}
    </span>
  );
}

const fmtTime = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toLocaleString() : "—");
/** Time-of-day only (HH:MM:SS) — the local WebUI log tables show just the clock. */
const fmtClock = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toLocaleTimeString() : "—");
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

/** One option in the optional level dropdown (IPS threat levels). */
interface LevelOption {
  value: string;
  label: string;
  color?: string;
}

/// Close a popover (Columns / level menu) on an outside click or Escape.
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
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
  error,
  loading,
  paused,
  onPause,
  onRefresh,
  emptyMessage,
  searchPlaceholder = "Filter events…",
  noun = "events",
  levelOptions,
  levelOf,
  timeOf,
  storageKey,
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
  error: string | null;
  loading: boolean;
  paused: boolean;
  onPause: () => void;
  onRefresh: () => void;
  emptyMessage: string;
  /** Placeholder for the free-text filter (matches the local WebUI wording). */
  searchPlaceholder?: string;
  /** Plural noun for the live status ("alerts", "events", "requests"). */
  noun?: string;
  /** Enables the "All levels" dropdown when present (IPS). */
  levelOptions?: LevelOption[];
  levelOf?: (row: T) => string;
  /** Enables the "Clear" watermark: hides rows at/older than the clear time. */
  timeOf?: (row: T) => number;
  /** Per-table localStorage key for remembering hidden columns. */
  storageKey?: string;
}) {
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState<"all" | "allowed" | "blocked">("all");
  const [level, setLevel] = useState("all");
  const showVerdict = verdictFilter && !!verdictOf;

  // "Clear" doesn't wipe device history (it's persisted); it sets a watermark
  // so everything currently shown drops away and only newer events stream in —
  // the local WebUI's clear-the-noise behavior, adapted to the polled model.
  const [clearedAt, setClearedAt] = useState(0);

  // Column visibility (the "Columns" picker), remembered per table.
  const colsKey = storageKey ? `qz-logcols:${storageKey}` : null;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!colsKey) return;
    try {
      const raw = window.localStorage.getItem(colsKey);
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, [colsKey]);
  const persistHidden = (next: Set<string>) => {
    setHidden(next);
    if (colsKey) {
      try {
        window.localStorage.setItem(colsKey, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
    }
  };
  const toggleCol = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    // Never hide the last remaining column.
    else if (columns.length - next.size > 1) next.add(key);
    persistHidden(next);
  };
  const shownCols = useMemo(() => columns.filter((c) => !hidden.has(c.key)), [columns, hidden]);

  // Draggable column widths (same model as the Traffic Monitor table): the `|`
  // handle at each header boundary transfers width to its neighbour. Keyed off
  // the visible columns so hiding one via the Columns menu re-flows cleanly.
  const resize = useColumnResize(
    storageKey ?? title,
    useMemo(() => shownCols.map((c) => ({ key: c.key, width: c.width })), [shownCols]),
  );

  const [colsOpen, setColsOpen] = useState(false);
  const [levelOpen, setLevelOpen] = useState(false);
  const colsRef = useDismiss(colsOpen, useCallback(() => setColsOpen(false), []));
  const levelRef = useDismiss(levelOpen, useCallback(() => setLevelOpen(false), []));

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (showVerdict && verdict !== "all" && verdictOf!(r) !== verdict) return false;
        if (levelOptions && level !== "all" && levelOf?.(r) !== level) return false;
        if (timeOf && clearedAt && timeOf(r) <= clearedAt) return false;
        if (q && !searchOf(r).toLowerCase().includes(q)) return false;
        return true;
      }),
    [rows, showVerdict, verdict, q, verdictOf, searchOf, levelOptions, level, levelOf, timeOf, clearedAt],
  );

  const activeLevel = levelOptions?.find((o) => o.value === level);

  return (
    <MonitorPageShell title={title} subtitle={subtitle}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          {/* Left filters wrap among themselves so the right-hand actions stay
              on the first row instead of dropping below on narrower widths. */}
          <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
          <div className="relative">
            <Search size={14} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[var(--qz-fg-4)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
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
          {levelOptions && (
            <div className="relative" ref={levelRef}>
              <button
                type="button"
                onClick={() => setLevelOpen((o) => !o)}
                className="inline-flex items-center gap-[8px] rounded-md pl-[10px] pr-[8px] py-[7px] text-[13px] cursor-pointer"
                style={{ background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)", color: "var(--qz-fg-1)" }}
              >
                {activeLevel?.color && (
                  <span className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: activeLevel.color }} />
                )}
                <span>{activeLevel?.label ?? "All levels"}</span>
                <ChevronDown size={13} className="text-[var(--qz-fg-4)]" />
              </button>
              {levelOpen && (
                <div
                  className="absolute left-0 mt-1 z-20 rounded-md py-1 min-w-[170px]"
                  style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}
                >
                  {[{ value: "all", label: "All levels" } as LevelOption, ...levelOptions].map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => {
                        setLevel(o.value);
                        setLevelOpen(false);
                      }}
                      className="flex items-center gap-[8px] w-full px-3 py-[6px] text-[13px] text-left bg-transparent border-0 cursor-pointer hover:bg-[color-mix(in_oklab,white_5%,transparent)]"
                      style={{ color: level === o.value ? "var(--qz-accent)" : "var(--qz-fg-2)" }}
                    >
                      {o.color ? (
                        <span className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: o.color }} />
                      ) : (
                        <span className="inline-block w-[7px] flex-shrink-0" />
                      )}
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {storageKey && (
              <div className="relative" ref={colsRef}>
                <Button kind="secondary" size="sm" icon={Columns3} onClick={() => setColsOpen((o) => !o)}>
                  Columns
                </Button>
                {colsOpen && (
                  <div
                    className="absolute right-0 mt-1 z-20 rounded-md py-1 min-w-[190px]"
                    style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}
                  >
                    <div className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--qz-fg-4)]">
                      Columns
                    </div>
                    {columns.map((c) => (
                      <label
                        key={c.key}
                        className="flex items-center gap-[8px] px-3 py-[6px] text-[13px] cursor-pointer text-[var(--qz-fg-2)] hover:bg-[color-mix(in_oklab,white_5%,transparent)]"
                      >
                        <input type="checkbox" className="qz-check" checked={!hidden.has(c.key)} onChange={() => toggleCol(c.key)} />
                        {c.header}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            <Button kind="secondary" size="sm" icon={RotateCw} onClick={onRefresh}>
              Refresh
            </Button>
            <Button kind="secondary" size="sm" icon={paused ? Play : Pause} onClick={onPause}>
              {paused ? "Resume" : "Pause"}
            </Button>
            {timeOf && (
              <Button kind="secondary" size="sm" icon={Eraser} onClick={() => setClearedAt(Date.now())}>
                Clear
              </Button>
            )}
            <span className="inline-flex items-center gap-[6px] text-[12px] text-[var(--qz-fg-4)]">
              {!error && !loading && (
                <span
                  className="inline-block w-[7px] h-[7px] rounded-full"
                  style={{ background: paused ? "var(--qz-fg-4)" : "var(--qz-success)" }}
                />
              )}
              {error ? "Unavailable" : loading ? "Loading…" : `${paused ? "Paused" : "Live"} · ${visible.length} ${noun}`}
            </span>
          </div>
        </div>

        <div className="rounded-md overflow-x-auto" style={{ border: "1px solid var(--qz-border)" }}>
          <table ref={resize.tableRef} className="qz-table" style={{ width: "100%", tableLayout: resize.tableLayout }}>
            <colgroup>
              {shownCols.map((c) => (
                <col key={c.key} style={{ width: resize.colWidth(c.key) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {shownCols.map((c, i) => (
                  <th key={c.key} {...resize.thProps(i)} className={c.align === "right" ? "text-right" : undefined}>
                    {c.header}
                    {resize.handle(i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={shownCols.length} className="text-center text-[var(--qz-fg-4)]" style={{ cursor: "default" }}>
                    {error ? error : loading ? "Loading…" : emptyMessage}
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr key={rowKey(r)} style={{ cursor: "default" }}>
                    {shownCols.map((c) => (
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
  { key: "time", header: "Time", render: (r) => <span className="mono text-[12px] text-[var(--qz-fg-2)]">{fmtClock(r.ts)}</span>, width: 100 },
  { key: "level", header: "Level", render: (r) => levelDot(r.level), width: 120 },
  { key: "action", header: "Action", render: (r) => verdictBadge(ipsVerdict(r)), width: 110 },
  {
    key: "sig",
    header: "Signature",
    render: (r) => (
      <span>
        <span className="text-[var(--qz-fg-1)]">{r.signature}</span>
        {r.sid ? <span className="text-[var(--qz-fg-4)]"> · {r.sid}</span> : null}
      </span>
    ),
  },
  { key: "src", header: "Source", render: (r) => endpointCell(r.src, r.spt), width: 190 },
  { key: "dst", header: "Destination", render: (r) => endpointCell(r.dst, r.dpt), width: 190 },
  { key: "proto", header: "Proto", render: (r) => <span className="mono text-[12px] text-[var(--qz-fg-4)]">{r.proto ?? "—"}</span>, width: 80 },
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
      searchPlaceholder="Filter alerts…"
      noun="alerts"
      levelOptions={THREAT_LEVELS.map((t) => ({ value: t.level, label: t.label, color: t.color }))}
      levelOf={(r) => r.level}
      timeOf={(r) => r.ts}
      storageKey="ips"
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
  { key: "time", header: "Time", render: (r) => <span className="mono text-[12px] text-[var(--qz-fg-2)]">{fmtClock(r.ts)}</span>, width: 100 },
  { key: "action", header: "Action", render: (r) => verdictBadge(acVerdict(r)), width: 100 },
  { key: "app", header: "Application", render: (r) => <span className="text-[var(--qz-fg-1)]">{r.app}</span>, width: 130 },
  { key: "cat", header: "Category", render: (r) => <span className="text-[var(--qz-fg-2)]">{r.category ?? "—"}</span>, width: 130 },
  // Source and Destination stay in their own columns (the local WebUI merges
  // them into one "Source → Destination" cell — kept split here on request).
  { key: "src", header: "Source", render: (r) => endpointCell(r.src, r.spt), width: 190 },
  { key: "dst", header: "Destination", render: (r) => endpointCell(r.dst, r.dpt), width: 190 },
  { key: "sni", header: "SNI / Host", render: (r) => <span className="text-[var(--qz-fg-1)]">{r.sni || "—"}</span> },
  { key: "policy", header: "Policy", render: (r) => <span className="text-[var(--qz-fg-2)]">{r.action_name || "—"}</span>, width: 120 },
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
      searchPlaceholder="Filter alerts…"
      noun="alerts"
      timeOf={(r) => r.ts}
      storageKey="appcontrol"
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
      noun="blocks"
      timeOf={(r) => r.ts}
      storageKey="geolocation"
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
      searchPlaceholder="Filter requests…"
      noun="requests"
      timeOf={(r) => Date.parse(r.ts)}
      storageKey="content-filtering"
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
