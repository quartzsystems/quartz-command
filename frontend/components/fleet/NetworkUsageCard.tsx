"use client";

// The dashboard's Network Usage card — a cloud-side replica of the QuartzFire
// WebUI's tile: green RX area + lighter green TX line, "↓ … down" / "up … ↑"
// header stats, a Live pill, and the bottom-center legend. Data is the
// controller's minute-bucketed aggregate of device-reported WAN throughput
// (GET /orgs/{org}/traffic), summed across the scope's devices.

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Gauge, RefreshCw } from "lucide-react";
import { getOrgTraffic, type TrafficPoint } from "@/lib/api";
import { ChartTooltip, DOWN_COLOR, UP_COLOR } from "@/components/ui/ChartTooltip";

const POLL_MS = 30_000;
const CHART_H = 200;
const PAD_L = 46;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 22;

/// "23.8 Kbps" — decimal (network) units, one decimal below 100.
export function formatBps(bps: number): string {
  const units = [
    { at: 1e9, suffix: "Gbps" },
    { at: 1e6, suffix: "Mbps" },
    { at: 1e3, suffix: "Kbps" },
  ];
  for (const u of units) {
    if (bps >= u.at) {
      const v = bps / u.at;
      return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u.suffix}`;
    }
  }
  return `${Math.round(bps)} bps`;
}

/// Short axis label: "45K", "1.2M".
function formatAxis(bps: number): string {
  if (bps >= 1e9) return `${+(bps / 1e9).toFixed(1)}G`;
  if (bps >= 1e6) return `${+(bps / 1e6).toFixed(1)}M`;
  if (bps >= 1e3) return `${Math.round(bps / 1e3)}K`;
  return `${Math.round(bps)}`;
}

/// Round up to a friendly axis ceiling (1/2/5 × 10^k).
function niceCeil(v: number): number {
  if (v <= 0) return 1000;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

function clockLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/// Live aggregate WAN throughput for the org or one sub-organization. Renders
/// an explanatory empty state until agents report throughput samples.
export function NetworkUsageCard({ orgGuid, subGuid }: { orgGuid: string; subGuid?: string }) {
  const [points, setPoints] = useState<TrafficPoint[] | null>(null);
  const [stale, setStale] = useState(false);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    roRef.current = ro;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const rows = await getOrgTraffic(orgGuid, { sub: subGuid, minutes: 60 });
        if (!cancelled) {
          setPoints(rows);
          setStale(false);
        }
      } catch {
        if (!cancelled) setStale(true);
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [orgGuid, subGuid]);

  const pts = points ?? [];
  const latest = pts[pts.length - 1];
  const maxVal = niceCeil(Math.max(...pts.map((p) => Math.max(p.rx_bps, p.tx_bps)), 0) * 1.1);
  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const plotH = CHART_H - PAD_T - PAD_B;
  const x = (i: number) => PAD_L + (pts.length <= 1 ? plotW : (i / (pts.length - 1)) * plotW);
  const y = (v: number) => PAD_T + plotH - (Math.min(v, maxVal) / maxVal) * plotH;

  const line = (f: (p: TrafficPoint) => number) =>
    pts.map((p, i) => `${x(i).toFixed(1)},${y(f(p)).toFixed(1)}`).join(" ");
  const rxLine = line((p) => p.rx_bps);
  const txLine = line((p) => p.tx_bps);
  const baseline = PAD_T + plotH;
  const rxArea = pts.length > 0 ? `${PAD_L},${baseline} ${rxLine} ${x(pts.length - 1).toFixed(1)},${baseline}` : "";

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxVal);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (pts.length === 0 || plotW <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - PAD_L) / plotW) * (pts.length - 1));
    if (i < 0 || i >= pts.length) {
      setHover(null);
      return;
    }
    setHover({ i, x: x(i) });
  };

  return (
    <section className="surface p-5">
      {/* Header: title + Live pill */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-[9px]">
          <Gauge size={18} style={{ color: "var(--qz-accent)" }} />
          <h2 className="text-[15px] font-semibold text-[var(--qz-fg-1)] m-0">Network Usage</h2>
        </div>
        <span
          className="inline-flex items-center gap-[6px] rounded-full px-[10px] py-[4px] text-[11px] font-semibold"
          style={
            stale
              ? { background: "var(--qz-warn-soft)", color: "var(--qz-warn)" }
              : { background: "var(--qz-accent)", color: "var(--qz-fg-on-accent)" }
          }
        >
          <RefreshCw size={11} />
          {stale ? "Stale" : "Live"}
        </span>
      </div>

      {/* Current rates: "↓ 23.8 Kbps down" left, "up 10.2 Kbps ↑" right */}
      <div className="flex items-center justify-between mb-2 text-[13px]">
        <span className="inline-flex items-center gap-[6px]">
          <ArrowDown size={14} style={{ color: DOWN_COLOR }} />
          <span
            className="font-bold tabular-nums"
            style={{ fontFamily: "var(--qz-font-mono)", color: DOWN_COLOR, fontSize: 15 }}
          >
            {latest ? formatBps(latest.rx_bps) : "—"}
          </span>
          <span style={{ color: "var(--qz-fg-4)" }}>down</span>
        </span>
        <span className="inline-flex items-center gap-[6px]">
          <span style={{ color: "var(--qz-fg-4)" }}>up</span>
          <span
            className="font-bold tabular-nums"
            style={{ fontFamily: "var(--qz-font-mono)", color: UP_COLOR, fontSize: 15 }}
          >
            {latest ? formatBps(latest.tx_bps) : "—"}
          </span>
          <ArrowUp size={14} style={{ color: UP_COLOR }} />
        </span>
      </div>

      {/* Chart */}
      <div
        ref={measureRef}
        className="relative"
        style={{ height: CHART_H }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {pts.length === 0 ? (
          <div
            className="absolute inset-0 grid place-items-center text-center text-[12px] px-6"
            style={{ color: "var(--qz-fg-4)" }}
          >
            {points === null
              ? "Loading…"
              : "No throughput reported yet — devices begin reporting WAN usage after their next agent update."}
          </div>
        ) : (
          width > 0 && (
            <svg width={width} height={CHART_H} className="block">
              {/* Grid + y-axis labels */}
              {yTicks.map((t) => (
                <g key={t}>
                  <line
                    x1={PAD_L}
                    y1={y(t)}
                    x2={width - PAD_R}
                    y2={y(t)}
                    stroke="var(--qz-divider)"
                    strokeWidth={1}
                  />
                  <text
                    x={PAD_L - 8}
                    y={y(t) + 3}
                    textAnchor="end"
                    style={{ fontFamily: "var(--qz-font-mono)", fontSize: 9, fill: "var(--qz-fg-4)" }}
                  >
                    {formatAxis(t)}
                  </text>
                </g>
              ))}
              {/* X-axis labels: window start, midpoint, now */}
              <text
                x={PAD_L}
                y={CHART_H - 6}
                style={{ fontFamily: "var(--qz-font-mono)", fontSize: 9, fill: "var(--qz-fg-4)" }}
              >
                {clockLabel(pts[0].bucket)}
              </text>
              {pts.length > 2 && (
                <text
                  x={PAD_L + plotW / 2}
                  y={CHART_H - 6}
                  textAnchor="middle"
                  style={{ fontFamily: "var(--qz-font-mono)", fontSize: 9, fill: "var(--qz-fg-4)" }}
                >
                  {clockLabel(pts[Math.floor(pts.length / 2)].bucket)}
                </text>
              )}
              <text
                x={width - PAD_R}
                y={CHART_H - 6}
                textAnchor="end"
                style={{ fontFamily: "var(--qz-font-mono)", fontSize: 9, fill: "var(--qz-fg-4)" }}
              >
                now
              </text>

              {/* Download: filled area + stroke; Upload: line */}
              <defs>
                <linearGradient id="qz-usage-rx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={DOWN_COLOR} stopOpacity="0.26" />
                  <stop offset="100%" stopColor={DOWN_COLOR} stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <polygon points={rxArea} fill="url(#qz-usage-rx)" stroke="none" />
              <polyline
                points={rxLine}
                fill="none"
                stroke={DOWN_COLOR}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <polyline
                points={txLine}
                fill="none"
                stroke={UP_COLOR}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />

              {/* Hover crosshair + markers */}
              {hover && (
                <g>
                  <line
                    x1={hover.x}
                    y1={PAD_T}
                    x2={hover.x}
                    y2={baseline}
                    stroke="var(--qz-fg-4)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={hover.x}
                    cy={y(pts[hover.i].rx_bps)}
                    r={4}
                    fill={DOWN_COLOR}
                    stroke="var(--qz-surface)"
                    strokeWidth={2}
                  />
                  <circle
                    cx={hover.x}
                    cy={y(pts[hover.i].tx_bps)}
                    r={4}
                    fill={UP_COLOR}
                    stroke="var(--qz-surface)"
                    strokeWidth={2}
                  />
                </g>
              )}
            </svg>
          )
        )}
        {hover && pts[hover.i] && (
          <ChartTooltip
            x={hover.x}
            width={width}
            title={clockLabel(pts[hover.i].bucket)}
            rows={[
              { label: "Download", value: formatBps(pts[hover.i].rx_bps), color: DOWN_COLOR },
              { label: "Upload", value: formatBps(pts[hover.i].tx_bps), color: UP_COLOR },
            ]}
          />
        )}
      </div>

      {/* Bottom-center legend */}
      <div
        className="flex items-center justify-center gap-5 mt-2 text-[12px]"
        style={{ color: "var(--qz-fg-3)" }}
      >
        <span className="inline-flex items-center gap-[6px]">
          <span className="w-[8px] h-[8px] rounded-full" style={{ background: DOWN_COLOR }} />
          Download (RX)
        </span>
        <span className="inline-flex items-center gap-[6px]">
          <span className="w-[8px] h-[8px] rounded-full" style={{ background: UP_COLOR }} />
          Upload (TX)
        </span>
      </div>
    </section>
  );
}
