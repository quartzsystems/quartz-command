// Monitor → Summary security telemetry.
//
// Each firewall pushes a security-service snapshot (IDS/IPS, Application
// Control, Geolocation, Content Filtering) to Quartz Command over its control
// stream every ~60s; the controller stores the latest per device. The console
// reads all of an org's snapshots in one call and this module aggregates them
// over whatever scope is in view (a sub-organization, or a single device).
//
// Counters are cumulative (Prometheus-counter semantics). Aggregating across
// devices is a plain sum — except "countries blocked", which is a per-device
// distinct count, so its cross-device total can double-count a country blocked
// on more than one firewall (acceptable for a summary tile).

import { useEffect, useState } from "react";
import { listSecurityTelemetry, type Device, type DeviceSecurityTelemetry } from "@/lib/api";

export interface MonitorTelemetry {
  ips: { prevented: number; detected: number; scans: number; scansAvailable: boolean };
  appControl: { blocked: number; detected: number; totalRequests: number };
  geo: { blocked: number; connections: number; countries: number };
  content: { blocked: number; allowed: number; totalRequests: number };
  /** Firewalls in scope that have a stored snapshot. */
  reported: number;
  /** All firewalls in scope. */
  total: number;
}

const ZERO: MonitorTelemetry = {
  ips: { prevented: 0, detected: 0, scans: 0, scansAvailable: false },
  appControl: { blocked: 0, detected: 0, totalRequests: 0 },
  geo: { blocked: 0, connections: 0, countries: 0 },
  content: { blocked: 0, allowed: 0, totalRequests: 0 },
  reported: 0,
  total: 0,
};

/// Sum the stored snapshots of the scoped devices into one total.
export function aggregate(
  rows: DeviceSecurityTelemetry[],
  scoped: Device[],
): MonitorTelemetry {
  const byId = new Map(rows.map((r) => [r.device_id, r]));
  const out: MonitorTelemetry = {
    ips: { ...ZERO.ips },
    appControl: { ...ZERO.appControl },
    geo: { ...ZERO.geo },
    content: { ...ZERO.content },
    reported: 0,
    total: scoped.length,
  };
  for (const d of scoped) {
    const r = byId.get(d.device_id);
    if (!r) continue;
    out.reported += 1;

    out.ips.prevented += r.ips_prevented;
    out.ips.detected += r.ips_detected;
    if (r.ips_scans_available) {
      out.ips.scans += r.ips_scans;
      out.ips.scansAvailable = true;
    }

    out.appControl.blocked += r.ac_blocked;
    out.appControl.detected += r.ac_detected;
    out.appControl.totalRequests += r.ac_total_requests;

    out.geo.blocked += r.geo_blocked;
    out.geo.connections += r.geo_connections;
    out.geo.countries += r.geo_countries_blocked;

    out.content.blocked += r.cf_blocked;
    out.content.allowed += r.cf_allowed;
    out.content.totalRequests += r.cf_total_requests;
  }
  return out;
}

// ── hook ─────────────────────────────────────────────────────────────────────

export interface MonitorTelemetryState {
  data: MonitorTelemetry;
  loading: boolean;
  error: string | null;
}

/// Aggregate the stored security telemetry across the scoped firewalls. Fetches
/// the org's snapshots once (re-fetching if the org changes) and re-aggregates
/// whenever the scope's device set changes.
export function useMonitorTelemetry(
  orgGuid: string,
  scoped: Device[],
): MonitorTelemetryState {
  const [rows, setRows] = useState<DeviceSecurityTelemetry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    listSecurityTelemetry(orgGuid)
      .then((r) => !cancelled && setRows(r))
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load telemetry.");
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgGuid]);

  const loading = rows === null;
  const data = rows ? aggregate(rows, scoped) : { ...ZERO, total: scoped.length };
  return { data, loading, error };
}

// ── display formatting ───────────────────────────────────────────────────────

/// Compact count: 1234 → "1.2K", 11_400_000 → "11.4M".
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "")}K`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
}
