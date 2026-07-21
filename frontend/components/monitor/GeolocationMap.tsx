"use client";

// Monitoring → Dashboards → Geolocation Map — a world choropleth of active
// connections per country, from the firewall's libloc traffic sampler
// (/geolocation/traffic). Countries are outlined and shaded by connection
// count; hovering one shows its total. Device scope maps one firewall; sub-org
// scope sums every firewall's per-country counts.
//
// Geometry is a bundled, simplified Natural Earth 110m GeoJSON keyed by ISO
// alpha-2 (public/geo/world-110m.geojson) — no map library, no network fetch to
// a third party. It's fetched once and cached for the session.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ChartTooltip } from "@/components/ui/ChartTooltip";
import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import { fetchGeoTraffic, type GeoTraffic } from "@/lib/device/geolocation";
import { fanoutApi } from "@/lib/device/fanout";

const POLL_MS = 12_000;

// ── world geometry (bundled asset, loaded once) ──────────────────────────────

interface GeoFeature {
  properties: { iso: string; name: string };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
}
interface Country {
  iso: string;
  name: string;
  /** Pre-projected SVG path (equirectangular, viewBox 0 0 360 180). */
  path: string;
}

/** lon/lat → equirectangular viewBox units (0..360, 0..180). */
const ring = (r: number[][]): string =>
  r.map(([lon, lat], i) => `${i ? "L" : "M"}${(lon + 180).toFixed(2)} ${(90 - lat).toFixed(2)}`).join(" ") + "Z";

function geomToPath(g: GeoFeature["geometry"]): string {
  if (g.type === "Polygon") return (g.coordinates as number[][][]).map(ring).join(" ");
  return (g.coordinates as number[][][][]).map((poly) => poly.map(ring).join(" ")).join(" ");
}

let worldPromise: Promise<Country[]> | null = null;
function loadWorld(): Promise<Country[]> {
  if (!worldPromise) {
    worldPromise = fetch("/geo/world-110m.geojson")
      .then((r) => {
        if (!r.ok) throw new Error(`map data ${r.status}`);
        return r.json();
      })
      .then((fc: { features: GeoFeature[] }) =>
        fc.features.map((f) => ({ iso: f.properties.iso, name: f.properties.name, path: geomToPath(f.geometry) })),
      )
      .catch((e) => {
        worldPromise = null; // allow a later retry
        throw e;
      });
  }
  return worldPromise;
}

// ── shared map view ──────────────────────────────────────────────────────────

interface Hover {
  name: string;
  count: number;
  x: number;
  y: number;
}

function GeoMapView({
  counts,
  available,
  error,
  loading,
  updated,
  onRefresh,
  scopeNote,
}: {
  /** ISO alpha-2 (upper) → active connections. */
  counts: Map<string, number>;
  available: boolean;
  error: string | null;
  loading: boolean;
  updated: Date | null;
  onRefresh: () => void;
  scopeNote: string;
}) {
  const [world, setWorld] = useState<Country[] | null>(null);
  const [worldError, setWorldError] = useState(false);
  useEffect(() => {
    loadWorld().then(setWorld).catch(() => setWorldError(true));
  }, []);

  const max = useMemo(() => Math.max(1, ...counts.values()), [counts]);
  const total = useMemo(() => [...counts.values()].reduce((s, n) => s + n, 0), [counts]);

  // Sequential single-hue: hotter country → more accent over the surface. Sqrt
  // so a few very-busy countries don't flatten everyone else to the floor.
  const fillFor = useCallback(
    (iso: string): string => {
      const c = counts.get(iso) ?? 0;
      if (c <= 0) return "var(--qz-surface-2)";
      const t = 0.3 + 0.7 * Math.sqrt(c / max);
      return `color-mix(in oklab, var(--qz-accent) ${Math.round(t * 100)}%, var(--qz-surface))`;
    },
    [counts, max],
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width || 900);
    const ro = new ResizeObserver((e) => {
      const w = e[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [world]);

  const [hover, setHover] = useState<Hover | null>(null);
  const svgPos = (e: React.MouseEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const ranked = useMemo(
    () =>
      [...counts.entries()]
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
    [counts],
  );
  const nameOf = useMemo(() => new Map((world ?? []).map((c) => [c.iso, c.name])), [world]);

  const note = !available
    ? "Geolocation isn't available on this scope yet — enable the Geolocation service (with its traffic sampler) to populate the map."
    : total === 0
      ? loading
        ? "Loading…"
        : "No active connections have resolved to a country yet."
      : null;

  return (
    <MonitorPageShell
      title="Geolocation Map"
      subtitle={`Active connections by country — ${scopeNote}. Countries shade darker with more connections.`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[13px] text-[var(--qz-fg-3)]">
            {error ? "Telemetry unavailable" : `${total.toLocaleString()} active connections · ${ranked.length ? counts.size : 0} countries`}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <Button kind="secondary" size="sm" icon={RotateCw} onClick={onRefresh}>
              Refresh
            </Button>
            {updated && <span className="text-[12px] text-[var(--qz-fg-4)]">Updated {updated.toLocaleTimeString()}</span>}
          </div>
        </div>

        <div
          className="rounded-md relative overflow-hidden"
          style={{ border: "1px solid var(--qz-border)", background: "var(--qz-surface)" }}
        >
          {worldError ? (
            <div className="p-8 text-center text-[13px] text-[var(--qz-fg-4)]">Map data failed to load.</div>
          ) : !world ? (
            <div className="p-8 text-center text-[13px] text-[var(--qz-fg-4)]">Loading map…</div>
          ) : (
            <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
              <svg viewBox="0 0 360 180" width={width} height={width / 2} style={{ display: "block" }}>
                {world.map((c) => (
                  <path
                    key={c.iso}
                    d={c.path}
                    fill={fillFor(c.iso)}
                    stroke="var(--qz-border)"
                    strokeWidth={0.18}
                    strokeLinejoin="round"
                    onMouseMove={(e) => {
                      const p = svgPos(e);
                      setHover({ name: c.name, count: counts.get(c.iso) ?? 0, x: p.x, y: p.y });
                    }}
                  />
                ))}
              </svg>
              {hover && (
                <ChartTooltip
                  x={hover.x}
                  width={width}
                  title={hover.name}
                  rows={[{ label: "Connections", value: hover.count.toLocaleString(), color: "var(--qz-accent)" }]}
                  top={Math.min(hover.y + 12, width / 2 - 60)}
                />
              )}
            </div>
          )}
        </div>

        {note && <div className="text-[12.5px]" style={{ color: "var(--qz-fg-4)" }}>{note}</div>}

        {ranked.length > 0 && (
          <div className="rounded-md overflow-hidden" style={{ border: "1px solid var(--qz-border)" }}>
            <table className="qz-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Country</th>
                  <th className="text-right" style={{ width: 180 }}>
                    Active connections
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(([iso, n]) => (
                  <tr key={iso} style={{ cursor: "default" }}>
                    <td className="text-[var(--qz-fg-1)]">
                      {nameOf.get(iso) ?? iso} <span className="text-[var(--qz-fg-4)] mono text-[11px]">{iso}</span>
                    </td>
                    <td className="text-right mono">{n.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </MonitorPageShell>
  );
}

// ── device scope ─────────────────────────────────────────────────────────────

export function DeviceGeolocationMap() {
  const [geo, setGeo] = useState<GeoTraffic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetchGeoTraffic()
      .then((g) => {
        setGeo(g);
        setUpdated(new Date());
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of geo?.countries ?? []) m.set(c.code.toUpperCase(), c.count);
    return m;
  }, [geo]);

  return (
    <GeoMapView
      counts={counts}
      available={geo != null && !error}
      error={error}
      loading={loading}
      updated={updated}
      onRefresh={load}
      scopeNote="this firewall"
    />
  );
}

// ── sub-org scope ────────────────────────────────────────────────────────────

export function SubOrgGeolocationMap() {
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fanoutApi<GeoTraffic>(params.organization_guid, params.sub_guid, "/geolocation/traffic")
      .then((items) => {
        const m = new Map<string, number>();
        let any = false;
        for (const it of items) {
          if (!it.data) continue;
          any = true;
          for (const c of it.data.countries) {
            const code = c.code.toUpperCase();
            m.set(code, (m.get(code) ?? 0) + c.count);
          }
        }
        setCounts(m);
        setAvailable(any);
        setUpdated(new Date());
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load"))
      .finally(() => setLoading(false));
  }, [params.organization_guid, params.sub_guid]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <GeoMapView
      counts={counts}
      available={available}
      error={error}
      loading={loading}
      updated={updated}
      onRefresh={load}
      scopeNote="summed across this sub-organization's firewalls"
    />
  );
}
