"use client";

// Compact Top Talkers treemap for the sub-org dashboard — a card-sized slice
// of QuartzWatch: flows fanned out across the sub-org's firewalls, aggregated
// by source host, squarified into a fixed-height box. "QuartzWatch" in the
// header links to the full view.

import { useCallback, useEffect, useRef, useState } from "react";
import { fanoutApi } from "@/lib/device/fanout";
import { isLoopbackFlow, type FlowsResponse } from "@/lib/device/flows";
import { formatBytes } from "@/lib/device/format";
import { squarify, type Cell } from "@/components/monitor/QuartzWatch";
import { CardHeader } from "@/components/fleet/FleetCards";

const POLL_MS = 30_000;
const CHART_H = 220;
const MAX_TILES = 8;

/// Top talkers by source host over the trailing 15 minutes, summed across the
/// sub-org's firewalls; the tail folds into an "Other" tile.
export function TopTalkersCard({
  orgGuid,
  subGuid,
  onViewAll,
}: {
  orgGuid: string;
  subGuid: string;
  onViewAll?: () => void;
}) {
  const [cells, setCells] = useState<Cell[] | null>(null);
  const [width, setWidth] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);

  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    roRef.current = ro;
  }, []);

  const load = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const items = await fanoutApi<FlowsResponse>(
        orgGuid,
        subGuid,
        "/monitoring/flows?window=15m&metric=bytes&limit=200",
      );
      const map = new Map<string, Cell>();
      for (const it of items) {
        for (const f of it.data?.flows ?? []) {
          if (isLoopbackFlow(f)) continue;
          const key = f.src;
          const label = f.src_name ?? f.src;
          const cur = map.get(key);
          if (cur) {
            cur.bytes += f.bytes;
            cur.conns += f.conns;
          } else {
            map.set(key, { key, label, bytes: f.bytes, conns: f.conns, filterable: false });
          }
        }
      }
      const ranked = [...map.values()].sort((a, b) => b.bytes - a.bytes);
      const top = ranked.slice(0, MAX_TILES);
      const rest = ranked.slice(MAX_TILES);
      if (rest.length > 0) {
        top.push({
          key: "\x00other",
          label: `Other (${rest.length})`,
          bytes: rest.reduce((s, c) => s + c.bytes, 0),
          conns: rest.reduce((s, c) => s + c.conns, 0),
          filterable: false,
        });
      }
      setCells(top);
    } catch {
      setCells((prev) => prev ?? []);
    }
  }, [orgGuid, subGuid]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const rects =
    cells && width > 0
      ? squarify(
          cells.map((cell) => ({ cell, value: cell.bytes })),
          width,
          CHART_H,
        )
      : [];
  const maxValue = rects.reduce((m, r) => Math.max(m, r.value), 0);

  return (
    <section className="surface p-5">
      <CardHeader title="Top Talkers · 15m" onViewAll={onViewAll} />
      <div ref={measureRef} className="relative" style={{ height: CHART_H }}>
        {cells === null ? (
          <div className="absolute inset-0 grid place-items-center text-[12px]" style={{ color: "var(--qz-fg-4)" }}>
            Loading…
          </div>
        ) : rects.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center text-[12px]" style={{ color: "var(--qz-fg-4)" }}>
            No flow data reported in this window.
          </div>
        ) : (
          rects.map((r) => {
            const other = r.cell.key === "\x00other";
            const t = maxValue > 0 ? r.value / maxValue : 0;
            const fill = other
              ? "color-mix(in oklab, var(--qz-fg-4) 16%, var(--qz-surface))"
              : `color-mix(in oklab, var(--qz-accent) ${Math.round(16 + t * 42)}%, var(--qz-surface))`;
            const showLabel = r.w > 64 && r.h > 30;
            return (
              <div
                key={r.cell.key}
                className="absolute overflow-hidden rounded-[4px]"
                style={{
                  left: r.x,
                  top: r.y,
                  width: r.w,
                  height: r.h,
                  background: fill,
                  border: "2px solid var(--qz-surface)",
                  padding: showLabel ? "6px 8px" : 0,
                }}
                title={`${r.cell.label} · ${formatBytes(r.cell.bytes)}`}
              >
                {showLabel && (
                  <>
                    <div
                      className="text-[11px] font-semibold truncate"
                      style={{ fontFamily: "var(--qz-font-mono)", color: "var(--qz-fg-1)" }}
                    >
                      {r.cell.label}
                    </div>
                    <div className="text-[10px]" style={{ fontFamily: "var(--qz-font-mono)", color: "var(--qz-fg-3)" }}>
                      {formatBytes(r.cell.bytes)}
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
