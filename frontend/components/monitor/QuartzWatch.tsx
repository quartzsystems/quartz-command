"use client";

// Monitoring → Dashboards → QuartzWatch — a FireWatch-style "top talkers"
// treemap over the last few minutes of traffic. One tab per dimension (Source,
// Destination, Application, Protocol); each cell is an entity sized AND shaded
// by traffic (a single-hue sequential encoding — area and color both ∝ the
// active metric, so the heaviest talkers read first). "Filter" narrows every
// tab to that entity, so you can pivot from a source to where it's going.
//
// Data is the same windowed flow feed as Traffic Flow (/monitoring/flows via
// lib/device/flows). All grouping happens client-side, so switching tabs or
// filtering never refetches.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { ChartTooltip } from "@/components/ui/ChartTooltip";
import { fetchFlows, FlowRecord, FlowMetric, FlowsResponse, FlowWindow, isLoopbackFlow } from "@/lib/device/flows";
import {
  fetchGeoCountries,
  fetchGeoTraffic,
  type GeoCountries,
  type GeoTraffic,
} from "@/lib/device/geolocation";
import { fanoutApi } from "@/lib/device/fanout";
import { formatBytes } from "@/lib/device/format";

const POLL_MS = 5000;
/** Cells kept before the tail folds into a single "Other" block. */
const MAX_CELLS = 140;
const CHART_H = 660;
/** Sentinel key for the folded-tail rollup (never a real entity). */
const OTHER = "\x00other";

// ── dimensions (the tabs) ───────────────────────────────────────────────────

type TabId = "src" | "dst" | "app" | "proto" | "country";

const TABS: { id: TabId; label: string }[] = [
  { id: "src", label: "Source" },
  { id: "dst", label: "Destination" },
  { id: "app", label: "Application" },
  { id: "proto", label: "Protocol" },
  { id: "country", label: "Countries" },
];

/// Active connections per country, resolved by libloc on the firewall. Its own
/// feed (conntrack sampled by the geolocation service), so the Countries tab is
/// sized by connection count and has no bytes or per-flow filtering.
export interface CountryCell {
  code: string;
  name: string;
  count: number;
}

/** Well-known service ports → an application label (best-effort L4 naming;
 *  anything unmapped falls back to proto/port). */
const WELL_KNOWN: Record<number, string> = {
  20: "FTP", 21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
  67: "DHCP", 68: "DHCP", 80: "HTTP", 110: "POP3", 123: "NTP", 143: "IMAP",
  161: "SNMP", 179: "BGP", 389: "LDAP", 443: "HTTPS", 445: "SMB", 465: "SMTPS",
  514: "Syslog", 587: "SMTP", 636: "LDAPS", 993: "IMAPS", 995: "POP3S",
  1194: "OpenVPN", 1701: "L2TP", 1723: "PPTP", 3306: "MySQL", 3389: "RDP",
  5060: "SIP", 5061: "SIP", 5432: "Postgres", 6379: "Redis", 8080: "HTTP-alt",
  8443: "HTTPS-alt", 51820: "WireGuard",
};

function appOf(proto: string, dport: number): { key: string; label: string } {
  const app = dport ? WELL_KNOWN[dport] : undefined;
  if (app) return { key: `app:${app}`, label: app };
  if (dport > 0) return { key: `${proto}/${dport}`, label: `${(proto || "?").toUpperCase()}/${dport}` };
  return { key: proto || "—", label: (proto || "—").toUpperCase() };
}

/** The grouping key for a flow under a given dimension (stable across polls). */
function facetKey(f: FlowRecord, tab: TabId): string {
  if (tab === "src") return f.src;
  if (tab === "dst") return f.dst;
  if (tab === "proto") return f.proto || "—";
  return appOf(f.proto, f.dport).key;
}

interface Cell {
  key: string;
  label: string;
  bytes: number;
  conns: number;
  /** Real entity (clickable filter); false for the "Other" rollup. */
  filterable: boolean;
}

/** Aggregate flows into one cell per entity for the active tab. */
function buildCells(flows: FlowRecord[], tab: TabId, names: Map<string, string>): Cell[] {
  const map = new Map<string, Cell>();
  for (const f of flows) {
    const key = facetKey(f, tab);
    let label: string;
    if (tab === "src") label = names.get(f.src) ?? f.src;
    else if (tab === "dst") label = names.get(f.dst) ?? f.dst;
    else if (tab === "proto") label = (f.proto || "—").toUpperCase();
    else label = appOf(f.proto, f.dport).label;
    const cur = map.get(key);
    if (cur) {
      cur.bytes += f.bytes;
      cur.conns += f.conns;
    } else {
      map.set(key, { key, label, bytes: f.bytes, conns: f.conns, filterable: true });
    }
  }
  return [...map.values()];
}

// ── squarified treemap layout (Bruls, Huizing & van Wijk) ────────────────────

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  cell: Cell;
  value: number;
}

/** Lay `cells` (each with a positive `value`) out as a squarified treemap in a
 *  W×H box, keeping cells as close to square as possible so labels fit. */
function squarify(cells: { cell: Cell; value: number }[], W: number, H: number): Rect[] {
  const items = cells.filter((c) => c.value > 0);
  const total = items.reduce((s, c) => s + c.value, 0);
  if (total <= 0 || W <= 0 || H <= 0) return [];
  // Scale each value to an area in px² so a row's area equals its byte share.
  const scaled = items
    .map((c) => ({ cell: c.cell, value: c.value, area: (c.value / total) * W * H }))
    .sort((a, b) => b.area - a.area);

  const out: Rect[] = [];
  let x = 0;
  let y = 0;
  let w = W;
  let h = H;

  const worst = (row: { area: number }[], side: number): number => {
    if (row.length === 0 || side <= 0) return Infinity;
    const s = row.reduce((a, r) => a + r.area, 0);
    let max = -Infinity;
    let min = Infinity;
    for (const r of row) {
      if (r.area > max) max = r.area;
      if (r.area < min) min = r.area;
    }
    const s2 = s * s;
    return Math.max((side * side * max) / s2, s2 / (side * side * min));
  };

  const flush = (row: { cell: Cell; value: number; area: number }[]) => {
    const s = row.reduce((a, r) => a + r.area, 0);
    if (w >= h) {
      const dw = s / h; // column of full remaining height
      let cy = y;
      for (const r of row) {
        const dh = r.area / dw;
        out.push({ x, y: cy, w: dw, h: dh, cell: r.cell, value: r.value });
        cy += dh;
      }
      x += dw;
      w -= dw;
    } else {
      const dh = s / w; // row of full remaining width
      let cx = x;
      for (const r of row) {
        const dw = r.area / dh;
        out.push({ x: cx, y, w: dw, h: dh, cell: r.cell, value: r.value });
        cx += dw;
      }
      y += dh;
      h -= dh;
    }
  };

  const rest = [...scaled];
  let row: typeof scaled = [];
  while (rest.length > 0) {
    const side = Math.min(w, h);
    const next = rest[0];
    if (row.length === 0 || worst(row, side) >= worst([...row, next], side)) {
      row.push(next);
      rest.shift();
    } else {
      flush(row);
      row = [];
    }
  }
  if (row.length > 0) flush(row);
  return out;
}

// ── the view (shared by device + sub-org scopes) ─────────────────────────────

interface ActiveFilter {
  facet: TabId;
  key: string;
  label: string;
}

function QuartzWatchView({
  flows: allFlows,
  countries,
  geoAvailable,
  available,
  loading,
  error,
  metric,
  setMetric,
  window_,
  setWindow,
  onRefresh,
  statusRight,
}: {
  flows: FlowRecord[];
  countries: CountryCell[];
  geoAvailable: boolean;
  available: boolean;
  loading: boolean;
  error: string | null;
  metric: FlowMetric;
  setMetric: (m: FlowMetric) => void;
  window_: FlowWindow;
  setWindow: (w: FlowWindow) => void;
  onRefresh: () => void;
  statusRight?: React.ReactNode;
}) {
  const [tab, setTab] = useState<TabId>("src");
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const isCountry = tab === "country";

  // Drop the firewall's own loopback traffic (internal API calls) so it doesn't
  // dominate the top-talkers treemap as a giant "127.0.0.1" block.
  const flows = useMemo(() => allFlows.filter((f) => !isLoopbackFlow(f)), [allFlows]);

  // IP → device name, from the flow records the backend already enriches.
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of flows) {
      if (f.src_name) m.set(f.src, f.src_name);
      if (f.dst_name) m.set(f.dst, f.dst_name);
    }
    return m;
  }, [flows]);

  // Flows narrowed by the active filters (a flow must match every filter).
  const filtered = useMemo(() => {
    if (filters.length === 0) return flows;
    return flows.filter((f) => filters.every((flt) => facetKey(f, flt.facet) === flt.key));
  }, [flows, filters]);

  // The Countries feed only carries a connection count, so that tab is always
  // sized by connections regardless of the bytes/connections toggle.
  const value = useCallback(
    (c: Cell) => (isCountry ? c.conns : metric === "bytes" ? c.bytes : c.conns),
    [metric, isCountry],
  );

  // Cells for the active tab: aggregate, rank by the metric, fold the tail.
  const cells = useMemo(() => {
    const base: Cell[] = isCountry
      ? countries.map((c) => ({ key: c.code, label: c.name || c.code, bytes: 0, conns: c.count, filterable: false }))
      : buildCells(filtered, tab, names);
    const all = base.sort((a, b) => value(b) - value(a));
    if (all.length <= MAX_CELLS) return all;
    const head = all.slice(0, MAX_CELLS);
    const tail = all.slice(MAX_CELLS);
    head.push({
      key: OTHER,
      label: `Other (${tail.length})`,
      bytes: tail.reduce((s, c) => s + c.bytes, 0),
      conns: tail.reduce((s, c) => s + c.conns, 0),
      filterable: false,
    });
    return head;
  }, [isCountry, countries, filtered, tab, names, value]);

  const maxValue = cells.length ? value(cells[0]) : 1;

  // ── width measurement (treemap fills the page width) ──
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const attachWrap = useCallback((el: HTMLDivElement | null) => {
    wrapRef.current = el;
    setWrapEl(el);
  }, []);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    if (!wrapEl) return;
    setWidth(wrapEl.getBoundingClientRect().width || 900);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(wrapEl);
    return () => ro.disconnect();
  }, [wrapEl]);

  const rects = useMemo(
    () => squarify(cells.map((c) => ({ cell: c, value: value(c) })), width, CHART_H),
    [cells, width, value],
  );

  const [hover, setHover] = useState<{ rect: Rect; x: number; y: number } | null>(null);

  const addFilter = (c: Cell) =>
    setFilters((prev) =>
      prev.some((f) => f.facet === tab && f.key === c.key)
        ? prev
        : [...prev, { facet: tab, key: c.key, label: c.label }],
    );
  const removeFilter = (f: ActiveFilter) =>
    setFilters((prev) => prev.filter((p) => !(p.facet === f.facet && p.key === f.key)));

  const sizingLabel = isCountry ? "active connections" : metric === "bytes" ? "bytes" : "connections";
  const tabLabel = isCountry ? "country" : (TABS.find((t) => t.id === tab)?.label ?? "").toLowerCase();

  // What to show instead of the treemap (null → render it). Error wins earlier.
  const notice = isCountry
    ? !geoAvailable
      ? "Geolocation isn't available on this firewall yet — enable the Geolocation service (with its traffic sampler) to see per-country connections."
      : rects.length === 0
        ? loading
          ? "Loading…"
          : "No active connections have resolved to a country yet."
        : null
    : available === false
      ? "Flow recording isn't available yet. It needs a qfdevd build with per-flow buckets — update the system image (or restart qfdevd) and traffic will appear within a snapshot interval."
      : rects.length === 0
        ? loading
          ? "Loading…"
          : filters.length > 0
            ? "No traffic matches the current filters."
            : "No traffic recorded in this window yet — flows appear within one conntrack snapshot (~30s) of qfdevd seeing them."
        : null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          QuartzWatch
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Top talkers over the window — each block is a {tabLabel} sized by {sizingLabel}.
          {!isCountry && " Click Filter to narrow every tab to that entity."}
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        <div className="flex flex-col gap-3">
          {/* Tabs */}
          <div className="flex items-center gap-1 border-b" style={{ borderColor: "var(--qz-border)" }}>
            {TABS.map((t) => {
              const active = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className="relative px-[14px] py-[9px] text-[13.5px] font-medium bg-transparent border-0 cursor-pointer transition-colors"
                  style={{ color: active ? "var(--qz-fg-1)" : "var(--qz-fg-4)" }}
                >
                  {t.label}
                  {active && (
                    <span
                      className="absolute left-0 right-0 bottom-[-1px] h-[2px] rounded-full"
                      style={{ background: "var(--qz-accent)" }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <Segmented
              items={[
                { value: "5m", label: "5 min" },
                { value: "15m", label: "15 min" },
                { value: "1h", label: "1 hour" },
              ]}
              value={window_}
              onChange={(v) => setWindow(v as FlowWindow)}
            />
            <Segmented
              items={[
                { value: "bytes", label: "Bytes" },
                { value: "hits", label: "Connections" },
              ]}
              value={metric}
              onChange={(v) => setMetric(v as FlowMetric)}
            />
            <div className="ml-auto flex items-center gap-3">
              <Button kind="secondary" size="sm" icon={RotateCw} onClick={onRefresh}>
                Refresh
              </Button>
              <span className="text-[12px] text-[var(--qz-fg-4)]">{statusRight}</span>
            </div>
          </div>

          {/* Active filters */}
          {filters.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-[12px]">
              <span className="text-[var(--qz-fg-4)]">Filtered to:</span>
              {filters.map((f) => (
                <button
                  key={`${f.facet}:${f.key}`}
                  type="button"
                  onClick={() => removeFilter(f)}
                  className="inline-flex items-center gap-[4px] px-[8px] py-[3px] rounded-full border cursor-pointer"
                  style={{
                    background: "var(--qz-accent-soft)",
                    borderColor: "color-mix(in oklab, var(--qz-accent) 30%, transparent)",
                    color: "var(--qz-fg-1)",
                  }}
                  title="Remove this filter"
                >
                  {TABS.find((t) => t.id === f.facet)?.label}: {f.label}
                  <X size={11} />
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFilters([])}
                className="text-[var(--qz-fg-4)] underline cursor-pointer bg-transparent border-0 p-0"
              >
                Clear
              </button>
            </div>
          )}

          {/* The treemap */}
          <div
            className="rounded-md relative overflow-hidden"
            style={{ border: "1px solid var(--qz-border)", background: "var(--qz-surface)" }}
          >
            {error ? (
              <div className="p-8 text-center text-[13px] text-[var(--qz-fg-4)]">{error}</div>
            ) : notice ? (
              <div className="p-8 text-center text-[13px] text-[var(--qz-fg-4)]">{notice}</div>
            ) : (
              <div ref={attachWrap} style={{ position: "relative", width: "100%", height: CHART_H }} onMouseLeave={() => setHover(null)}>
                {rects.map((r) => {
                  const t = maxValue > 0 ? r.value / maxValue : 0;
                  const isOther = r.cell.key === OTHER;
                  // Sequential single-hue: heavier talker → more accent over the
                  // surface. Kept light enough that ink-token labels stay legible.
                  // The folded "Other" block stays neutral so it never reads as data.
                  const fill = isOther
                    ? `color-mix(in oklab, var(--qz-fg-4) 16%, var(--qz-surface))`
                    : `color-mix(in oklab, var(--qz-accent) ${Math.round(16 + t * 42)}%, var(--qz-surface))`;
                  const showText = r.w >= 46 && r.h >= 26;
                  const showMeta = r.w >= 84 && r.h >= 58;
                  const showFilter = r.cell.filterable && r.w >= 78 && r.h >= 84;
                  return (
                    <div
                      key={r.cell.key}
                      style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, padding: 1 }}
                      onMouseMove={(e) => {
                        const rect = wrapRef.current?.getBoundingClientRect();
                        setHover({ rect: r, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
                      }}
                    >
                      <div
                        className="w-full h-full rounded-[3px] overflow-hidden"
                        style={{ background: fill, padding: showText ? "6px 8px" : 0 }}
                      >
                        {showText && (
                          <div className="flex flex-col h-full min-w-0">
                            <div
                              // shrink-0: in a flex column an overflowing cell
                              // otherwise squeezes this single line below its
                              // own height, and `truncate`'s overflow:hidden
                              // then clips the label vertically (text cutoff).
                              className="text-[12px] font-semibold leading-tight truncate shrink-0"
                              style={{ color: "var(--qz-fg-1)", fontFamily: "var(--qz-font-mono)" }}
                              title={r.cell.label}
                            >
                              {r.cell.label}
                            </div>
                            {showMeta && (
                              <div className="text-[11px] leading-snug mt-[2px] shrink-0" style={{ color: "var(--qz-fg-3)" }}>
                                {!isCountry && <div>{formatBytes(r.cell.bytes)}</div>}
                                <div>Connections: {r.cell.conns.toLocaleString()}</div>
                              </div>
                            )}
                            {showFilter && (
                              <button
                                type="button"
                                onClick={() => addFilter(r.cell)}
                                className="mt-auto self-start text-[11px] underline bg-transparent border-0 p-0 cursor-pointer transition-colors"
                                style={{ color: "var(--qz-fg-3)" }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--qz-accent)")}
                                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--qz-fg-3)")}
                              >
                                Filter
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {hover && (
                  <ChartTooltip
                    x={hover.x}
                    width={width}
                    title={hover.rect.cell.label}
                    rows={[
                      ...(isCountry
                        ? []
                        : [{ label: "Bytes", value: formatBytes(hover.rect.cell.bytes), color: "var(--qz-accent)" }]),
                      { label: "Connections", value: hover.rect.cell.conns.toLocaleString(), color: "var(--qz-fg-4)" },
                    ]}
                    top={Math.min(hover.y + 12, CHART_H - 70)}
                  />
                )}
              </div>
            )}
          </div>

          <div className="text-[12px] text-[var(--qz-fg-4)]">
            Block area and shade both scale with {sizingLabel}
            {!isCountry && " · click Filter on a block to narrow every tab to it"}
            {cells.some((c) => c.key === OTHER) && " · smallest talkers are folded into “Other”"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── device scope: the FireWatch top-talkers for one firewall ─────────────────

export function DeviceQuartzWatch() {
  const [resp, setResp] = useState<FlowsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [window_, setWindow] = useState<FlowWindow>("5m");
  const [metric, setMetric] = useState<FlowMetric>("bytes");

  const load = useCallback(async (w: FlowWindow, m: FlowMetric) => {
    try {
      const r = await fetchFlows(w, m);
      setResp(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load flows");
    }
  }, []);

  // Countries feed (per-country active connections) + the code→name map. Its
  // own cadence, and independent of the flow window/metric.
  const [geo, setGeo] = useState<GeoTraffic | null>(null);
  const [geoNames, setGeoNames] = useState<Map<string, string>>(new Map());
  const loadGeo = useCallback(async () => {
    try {
      const g = await fetchGeoTraffic();
      setGeo(g);
    } catch {
      /* leave the Countries tab in its "unavailable" state */
    }
  }, []);
  useEffect(() => {
    fetchGeoCountries()
      .then((c: GeoCountries) => setGeoNames(new Map(c.countries.map((x) => [x.code, x.name]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load(window_, metric);
    loadGeo();
    const t = setInterval(() => {
      if (document.hidden) return;
      load(window_, metric);
      loadGeo();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load, loadGeo, window_, metric]);

  const countries: CountryCell[] = useMemo(
    () => (geo?.countries ?? []).map((c) => ({ code: c.code, name: geoNames.get(c.code) ?? c.code, count: c.count })),
    [geo, geoNames],
  );

  const status = resp
    ? `${metric === "bytes" ? formatBytes(resp.total_bytes) : `${resp.total_conns.toLocaleString()} conns`} · ${resp.flow_count} flows`
    : "Loading…";

  return (
    <QuartzWatchView
      flows={resp?.flows ?? []}
      countries={countries}
      geoAvailable={geo != null}
      available={resp?.available ?? true}
      loading={!resp}
      error={error}
      metric={metric}
      setMetric={setMetric}
      window_={window_}
      setWindow={setWindow}
      onRefresh={() => {
        load(window_, metric);
        loadGeo();
      }}
      statusRight={status}
    />
  );
}

// ── sub-org scope: top talkers merged across every firewall in the sub-org ───

export function SubOrgQuartzWatch() {
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  const [flows, setFlows] = useState<FlowRecord[]>([]);
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [window_, setWindow] = useState<FlowWindow>("15m");
  const [metric, setMetric] = useState<FlowMetric>("bytes");
  const [countries, setCountries] = useState<CountryCell[]>([]);
  const [geoAvailable, setGeoAvailable] = useState(false);

  const load = useCallback(
    async (w: FlowWindow, m: FlowMetric) => {
      try {
        const items = await fanoutApi<FlowsResponse>(
          params.organization_guid,
          params.sub_guid,
          `/monitoring/flows?window=${w}&metric=${m}&limit=250`,
        );
        const merged: FlowRecord[] = [];
        let anyAvailable = false;
        for (const it of items) {
          if (!it.data) continue;
          if (it.data.available) anyAvailable = true;
          merged.push(...it.data.flows);
        }
        setFlows(merged);
        setAvailable(anyAvailable || items.every((i) => !i.data));
        setError(null);
        setLoaded(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to load flows");
        setLoaded(true);
      }
    },
    [params.organization_guid, params.sub_guid],
  );

  // Per-country active connections, summed across every firewall in the sub-org.
  const loadGeo = useCallback(async () => {
    try {
      const [traffic, names] = await Promise.all([
        fanoutApi<GeoTraffic>(params.organization_guid, params.sub_guid, "/geolocation/traffic"),
        fanoutApi<GeoCountries>(params.organization_guid, params.sub_guid, "/geolocation/countries"),
      ]);
      const nameByCode = new Map<string, string>();
      for (const it of names) for (const c of it.data?.countries ?? []) nameByCode.set(c.code, c.name);
      const counts = new Map<string, number>();
      let any = false;
      for (const it of traffic) {
        if (!it.data) continue;
        any = true;
        for (const c of it.data.countries) counts.set(c.code, (counts.get(c.code) ?? 0) + c.count);
      }
      setCountries([...counts.entries()].map(([code, count]) => ({ code, name: nameByCode.get(code) ?? code, count })));
      setGeoAvailable(any);
    } catch {
      /* leave the Countries tab in its "unavailable" state */
    }
  }, [params.organization_guid, params.sub_guid]);

  useEffect(() => {
    load(window_, metric);
    loadGeo();
    const t = setInterval(() => {
      if (document.hidden) return;
      load(window_, metric);
      loadGeo();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load, loadGeo, window_, metric]);

  return (
    <QuartzWatchView
      flows={flows}
      countries={countries}
      geoAvailable={geoAvailable}
      available={available}
      loading={!loaded}
      error={error}
      metric={metric}
      setMetric={setMetric}
      window_={window_}
      setWindow={setWindow}
      onRefresh={() => {
        load(window_, metric);
        loadGeo();
      }}
      statusRight={loaded ? `${flows.length} flows` : "Loading…"}
    />
  );
}
