"use client";

// Dashboard widget cards for the Overview (org and sub-org scopes): event
// feed, audit activity, needs-attention list, fleet health, firmware spread,
// security rollup, and the MSP "organizations needing attention" table. All
// presentational — data arrives via props from OverviewDashboard so one
// refresh cycle drives every card.

import { Fragment } from "react";
import {
  CircleAlert,
  CirclePlus,
  Clock,
  ShieldAlert,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import type {
  AuditEntry,
  Device,
  DeviceSecurityTelemetry,
  EnrollmentToken,
  FleetStatsResponse,
  OrgEvent,
  SubOrganization,
} from "@/lib/api";
import { parseVersion, versionLt, type Version } from "@/components/fleet/firmware";
import { CardHeader } from "@/components/fleet/FleetCards";
import { Sparkline } from "@/components/monitor/Sparkline";

// ── shared bits ──────────────────────────────────────────────────────────────

/// Compact relative age for feed rows: "now", "12m", "3h", "2d".
export function timeAgo(iso: string, now: number): string {
  const diff = now - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < 60_000) return "now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function SeverityBadge({ severity }: { severity: OrgEvent["severity"] }) {
  const cls =
    severity === "critical" ? "badge-crit" : severity === "warning" ? "badge-warn" : "badge-info";
  const label = severity === "critical" ? "CRIT" : severity === "warning" ? "WARN" : "INFO";
  return <span className={`badge ${cls} flex-shrink-0`}>{label}</span>;
}

const detailStr = (details: Record<string, unknown>, key: string): string | null => {
  const v = details[key];
  return typeof v === "string" && v ? v : null;
};

/// The sub-organization an event belongs to, when its details carry one
/// (device lifecycle events do); null = org-wide / unscoped.
export function eventSubOrg(e: OrgEvent): string | null {
  return detailStr(e.details, "sub_org_id");
}

/// Events visible in a scope: everything at org level, else only rows tagged
/// with the sub-org (unscoped org-wide events stay at the org level).
export function scopeEvents(events: OrgEvent[], subGuid?: string): OrgEvent[] {
  return subGuid ? events.filter((e) => eventSubOrg(e) === subGuid) : events;
}

const feedRow = "flex items-start gap-[10px] py-[9px] border-b last:border-b-0";
const feedRowStyle = { borderColor: "var(--qz-divider)" } as const;

// ── Recent Events ────────────────────────────────────────────────────────────

/// The org_events feed: severity chip, title, device/sub context, relative
/// time. `subGuid` filters to events tagged with that sub-organization.
export function EventsFeedCard({
  events,
  subGuid,
  now,
  onViewAll,
}: {
  events: OrgEvent[] | null;
  subGuid?: string;
  now: number;
  onViewAll?: () => void;
}) {
  const scoped = scopeEvents(events ?? [], subGuid).slice(0, 6);
  const critical24h = scopeEvents(events ?? [], subGuid).filter(
    (e) => e.severity !== "info" && now - Date.parse(e.created_at) < 24 * 3600_000,
  ).length;

  return (
    <section className="surface p-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-[14px] font-semibold text-[var(--qz-fg-1)] m-0">Recent Events</h2>
        <div className="flex items-center gap-2">
          {critical24h > 0 && <span className="badge badge-crit">{critical24h} · 24H</span>}
          {onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="text-[12.5px] font-medium bg-transparent border-0 cursor-pointer p-0"
              style={{ color: "var(--qz-accent)" }}
            >
              View All
            </button>
          )}
        </div>
      </div>
      {scoped.length === 0 ? (
        <p className="text-[12.5px] m-0" style={{ color: "var(--qz-fg-4)" }}>
          {events === null ? "Loading…" : "No events yet."}
        </p>
      ) : (
        <div className="flex flex-col">
          {scoped.map((e) => {
            const host = detailStr(e.details, "hostname") ?? detailStr(e.details, "device_id");
            return (
              <div key={e.id} className={feedRow} style={feedRowStyle}>
                <SeverityBadge severity={e.severity} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-[var(--qz-fg-1)] truncate">
                    {e.title}
                    {host && (
                      <span className="ml-[6px]" style={{ fontFamily: "var(--qz-font-mono)", color: "var(--qz-fg-3)", fontSize: 12 }}>
                        {host}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className="text-[11px] flex-shrink-0"
                  style={{ fontFamily: "var(--qz-font-mono)", color: "var(--qz-fg-4)" }}
                >
                  {timeAgo(e.created_at, now)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Recent Activity (audit) ──────────────────────────────────────────────────

/// Human sentence for a known audit action; falls back to the raw action slug.
function describeAudit(entry: AuditEntry): string {
  const dev = detailStr(entry.details, "device_id");
  switch (entry.action) {
    case "device.revoked":
      return `Revoked device ${dev ?? ""}`.trim();
    case "device.allocated":
      return `Allocated ${dev ?? "a device"} to a sub-organization`;
    case "device.deallocated":
      return `Returned ${dev ?? "a device"} to the unallocated pool`;
    case "device.foldered":
      return `Moved ${dev ?? "a device"} into a folder`;
    case "device.unfoldered":
      return `Removed ${dev ?? "a device"} from its folder`;
    default:
      return entry.action.replace(/[._]/g, " ");
  }
}

function actorChip(actor: string): { label: string; bg: string; fg: string } {
  if (actor === "system") return { label: "SY", bg: "var(--qz-ink-3)", fg: "var(--qz-fg-3)" };
  if (actor.startsWith("device:"))
    return { label: "DV", bg: "var(--qz-info-soft)", fg: "var(--qz-info)" };
  return { label: "US", bg: "var(--qz-accent-soft)", fg: "var(--qz-accent)" };
}

/// The audit_log strip: who did what, newest first.
export function AuditActivityCard({
  entries,
  now,
  onViewAll,
}: {
  entries: AuditEntry[] | null;
  now: number;
  onViewAll?: () => void;
}) {
  const rows = (entries ?? []).slice(0, 5);
  return (
    <section className="surface p-5">
      <CardHeader title="Recent Activity" onViewAll={onViewAll} />
      {rows.length === 0 ? (
        <p className="text-[12.5px] m-0" style={{ color: "var(--qz-fg-4)" }}>
          {entries === null ? "Loading…" : "No activity recorded yet."}
        </p>
      ) : (
        <div className="flex flex-col">
          {rows.map((a) => {
            const chip = actorChip(a.actor);
            return (
              <div key={a.id} className={feedRow} style={feedRowStyle}>
                <span
                  className="w-[26px] h-[26px] rounded-full grid place-items-center text-[10px] font-bold flex-shrink-0"
                  style={{ background: chip.bg, color: chip.fg }}
                >
                  {chip.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-[var(--qz-fg-1)] truncate">{describeAudit(a)}</div>
                </div>
                <span
                  className="text-[11px] flex-shrink-0"
                  style={{ fontFamily: "var(--qz-font-mono)", color: "var(--qz-fg-4)" }}
                >
                  {timeAgo(a.created_at, now)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Needs Attention ──────────────────────────────────────────────────────────

interface AttentionRow {
  key: string;
  icon: typeof TriangleAlert;
  tone: "warn" | "crit" | "info";
  title: string;
  detail: string;
}

const DAY_MS = 24 * 3600_000;

/// Actionable states already present in the inventory data: certificates
/// nearing expiry, devices pending adoption, devices offline for over a day,
/// and enrollment tokens expiring this week.
export function attentionRows(
  devices: Device[],
  tokens: EnrollmentToken[] | null,
  now: number,
): AttentionRow[] {
  const rows: AttentionRow[] = [];
  const name = (d: Device) => d.hostname ?? d.device_id;

  const expiring = devices.filter((d) => {
    if (d.state !== "adopted" || !d.cert_not_after) return false;
    const left = Date.parse(d.cert_not_after) - now;
    return left > 0 && left < 30 * DAY_MS;
  });
  if (expiring.length > 0) {
    rows.push({
      key: "certs",
      icon: TriangleAlert,
      tone: "warn",
      title: `${expiring.length} certificate${expiring.length === 1 ? "" : "s"} expire within 30 days`,
      detail: expiring
        .slice(0, 3)
        .map((d) => `${name(d)} (${Math.ceil((Date.parse(d.cert_not_after!) - now) / DAY_MS)}d)`)
        .join(" · "),
    });
  }

  const pending = devices.filter((d) => d.state === "pending");
  if (pending.length > 0) {
    rows.push({
      key: "pending",
      icon: CirclePlus,
      tone: "info",
      title: `${pending.length} device${pending.length === 1 ? "" : "s"} pending adoption`,
      detail: pending.slice(0, 3).map(name).join(" · "),
    });
  }

  const longOffline = devices.filter(
    (d) =>
      d.state === "adopted" &&
      !d.connected &&
      d.last_seen_at != null &&
      now - Date.parse(d.last_seen_at) > DAY_MS,
  );
  if (longOffline.length > 0) {
    rows.push({
      key: "offline",
      icon: WifiOff,
      tone: "crit",
      title: `${longOffline.length} device${longOffline.length === 1 ? "" : "s"} offline for more than 24 hours`,
      detail: longOffline
        .slice(0, 3)
        .map((d) => `${name(d)} · last seen ${timeAgo(d.last_seen_at!, now)} ago`)
        .join(" · "),
    });
  }

  const expiringTokens = (tokens ?? []).filter((t) => {
    if (t.revoked_at) return false;
    const left = Date.parse(t.expires_at) - now;
    return left > 0 && left < 7 * DAY_MS;
  });
  if (expiringTokens.length > 0) {
    rows.push({
      key: "tokens",
      icon: Clock,
      tone: "warn",
      title: `${expiringTokens.length} enrollment token${expiringTokens.length === 1 ? "" : "s"} expire this week`,
      detail: expiringTokens
        .slice(0, 3)
        .map((t) => t.label ?? t.token_id)
        .join(" · "),
    });
  }

  return rows;
}

const toneStyles: Record<AttentionRow["tone"], { bg: string; fg: string }> = {
  warn: { bg: "var(--qz-warn-soft)", fg: "var(--qz-warn)" },
  crit: { bg: "var(--qz-danger-soft)", fg: "var(--qz-danger)" },
  info: { bg: "var(--qz-info-soft)", fg: "var(--qz-info)" },
};

/// The dashboard as a to-do list. Everything derives from data the shell
/// already loads (devices) plus the enrollment-token list.
export function NeedsAttentionCard({
  devices,
  tokens,
  now,
  onViewAll,
}: {
  devices: Device[];
  tokens: EnrollmentToken[] | null;
  now: number;
  onViewAll?: () => void;
}) {
  const rows = attentionRows(devices, tokens, now);
  return (
    <section className="surface p-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-[14px] font-semibold text-[var(--qz-fg-1)] m-0">Needs Attention</h2>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <span className="badge badge-warn">
              {rows.length} ITEM{rows.length === 1 ? "" : "S"}
            </span>
          )}
          {onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="text-[12.5px] font-medium bg-transparent border-0 cursor-pointer p-0"
              style={{ color: "var(--qz-accent)" }}
            >
              Inventory
            </button>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] m-0" style={{ color: "var(--qz-fg-4)" }}>
          Nothing needs attention. All clear.
        </p>
      ) : (
        <div className="flex flex-col">
          {rows.map((r) => {
            const tone = toneStyles[r.tone];
            const Icon = r.icon;
            return (
              <div key={r.key} className={feedRow} style={feedRowStyle}>
                <span
                  className="w-[32px] h-[32px] rounded-[9px] grid place-items-center flex-shrink-0"
                  style={{ background: tone.bg, color: tone.fg }}
                >
                  <Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-[var(--qz-fg-1)]">{r.title}</div>
                  <div
                    className="text-[11.5px] mt-[2px] truncate"
                    style={{ color: "var(--qz-fg-4)", fontFamily: "var(--qz-font-mono)" }}
                  >
                    {r.detail}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Fleet Health ─────────────────────────────────────────────────────────────

interface HealthRow {
  device: Device;
  cpu: number;
  mem: number;
  disk: number;
  series: number[];
  worst: number;
}

function healthRows(
  devices: Device[],
  fleet: FleetStatsResponse | null,
  subGuid?: string,
): HealthRow[] {
  if (!fleet) return [];
  const byId = new Map(
    devices
      .filter((d) => d.state === "adopted" && (subGuid ? d.sub_org_id === subGuid : true))
      .map((d) => [d.device_id, d]),
  );
  const series = new Map<string, number[]>();
  for (const s of fleet.samples) {
    if (!byId.has(s.device_id)) continue;
    const arr = series.get(s.device_id) ?? [];
    arr.push(s.cpu_pct);
    series.set(s.device_id, arr);
  }
  return fleet.stats
    .filter((s) => byId.has(s.device_id))
    .map((s) => ({
      device: byId.get(s.device_id)!,
      cpu: s.cpu_pct,
      mem: s.mem_pct,
      disk: s.disk_pct,
      series: series.get(s.device_id) ?? [],
      worst: Math.max(s.cpu_pct, s.mem_pct, s.disk_pct),
    }))
    .sort((a, b) => b.worst - a.worst);
}

function pctCell(v: number, warnAt: number) {
  const color =
    v >= 90 ? "var(--qz-danger)" : v >= warnAt ? "var(--qz-warn)" : "var(--qz-fg-2)";
  const weight = v >= warnAt ? 600 : 400;
  return (
    <span className="tabular-nums" style={{ color, fontWeight: weight }}>
      {Math.round(v)}%
    </span>
  );
}

/// Threshold chips plus the worst offenders with their CPU sparklines. Fed by
/// the one-round-trip fleet-stats endpoint.
export function FleetHealthCard({
  devices,
  fleet,
  subGuid,
  showOrgColumn,
  onViewAll,
}: {
  devices: Device[];
  fleet: FleetStatsResponse | null;
  subGuid?: string;
  /** Show the owning sub-organization column (org scope). */
  showOrgColumn?: boolean;
  onViewAll?: () => void;
}) {
  const rows = healthRows(devices, fleet, subGuid);
  const cpuHot = rows.filter((r) => r.cpu >= 80).length;
  const memHot = rows.filter((r) => r.mem >= 80).length;
  const diskHot = rows.filter((r) => r.disk >= 90).length;
  const healthy = rows.length - rows.filter((r) => r.cpu >= 80 || r.mem >= 80 || r.disk >= 90).length;
  const top = rows.slice(0, 4);

  return (
    <section className="surface p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-[14px] font-semibold text-[var(--qz-fg-1)] m-0">Fleet Health</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {cpuHot > 0 && <span className="badge badge-warn">CPU &gt; 80% · {cpuHot}</span>}
          {memHot > 0 && <span className="badge badge-warn">MEM &gt; 80% · {memHot}</span>}
          {diskHot > 0 && <span className="badge badge-crit">DISK &gt; 90% · {diskHot}</span>}
          {rows.length > 0 && <span className="badge badge-ok">{healthy} HEALTHY</span>}
          {onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="text-[12.5px] font-medium bg-transparent border-0 cursor-pointer p-0"
              style={{ color: "var(--qz-accent)" }}
            >
              View All
            </button>
          )}
        </div>
      </div>
      {top.length === 0 ? (
        <p className="text-[12.5px] m-0" style={{ color: "var(--qz-fg-4)" }}>
          {fleet === null ? "Loading…" : "No devices have reported health stats yet."}
        </p>
      ) : (
        <table className="qz-table">
          <thead>
            <tr>
              <th>Device</th>
              {showOrgColumn && <th>Organization</th>}
              <th>CPU · Recent</th>
              <th className="text-right">CPU</th>
              <th className="text-right">Mem</th>
              <th className="text-right">Disk</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.device.device_id} style={{ cursor: "default" }}>
                <td className="mono">{r.device.hostname ?? r.device.device_id}</td>
                {showOrgColumn && (
                  <td style={{ color: "var(--qz-fg-3)" }}>{r.device.sub_org_name ?? "—"}</td>
                )}
                <td style={{ width: 140 }}>
                  <Sparkline values={r.series} color="var(--qz-accent)" height={26} />
                </td>
                <td className="text-right">{pctCell(r.cpu, 80)}</td>
                <td className="text-right">{pctCell(r.mem, 80)}</td>
                <td className="text-right">{pctCell(r.disk, 90)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── Firmware version spread ──────────────────────────────────────────────────

/// Distribution of reported firmware versions across one product's managed
/// fleet — the mixed-version smell test. One hue: accent = on latest, neutral
/// = behind (recency is ordinal, not categorical).
export function FirmwareSpreadCard({
  devices,
  product,
  latestVer,
  title,
}: {
  devices: Device[];
  product: "quartzfire" | "quartzsonic";
  latestVer: Version | null;
  title?: string;
}) {
  const managed = devices.filter((d) => d.product === product && d.state !== "revoked");
  const groups = new Map<string, { count: number; ver: Version | null }>();
  for (const d of managed) {
    const ver = parseVersion(d.qf_version);
    const key = ver ? `${ver[0]}.${ver[1]}.${ver[2]}` : "unreported";
    const cur = groups.get(key);
    if (cur) cur.count += 1;
    else groups.set(key, { count: 1, ver });
  }
  const rows = [...groups.entries()].sort((a, b) => {
    if (!a[1].ver) return 1;
    if (!b[1].ver) return -1;
    return versionLt(a[1].ver, b[1].ver) ? 1 : -1;
  });
  const behind = latestVer
    ? managed.filter((d) => {
        const v = parseVersion(d.qf_version);
        return v != null && versionLt(v, latestVer);
      }).length
    : 0;

  return (
    <section className="surface p-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-[14px] font-semibold text-[var(--qz-fg-1)] m-0">
          {title ?? "Firmware Versions"}
        </h2>
        {behind > 0 && <span className="badge badge-warn">{behind} BEHIND LATEST</span>}
      </div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] m-0" style={{ color: "var(--qz-fg-4)" }}>
          No managed devices.
        </p>
      ) : (
        <div className="flex flex-col gap-[11px]">
          {rows.map(([key, g]) => {
            const onLatest = g.ver != null && latestVer != null && !versionLt(g.ver, latestVer);
            return (
              <div key={key}>
                <div className="flex items-center justify-between text-[12px] mb-[5px]">
                  <span
                    style={{
                      fontFamily: "var(--qz-font-mono)",
                      color: onLatest ? "var(--qz-fg-1)" : "var(--qz-fg-2)",
                      fontWeight: onLatest ? 600 : 400,
                    }}
                  >
                    {key}
                    {onLatest && <span className="badge badge-ok ml-2">LATEST</span>}
                  </span>
                  <span className="tabular-nums" style={{ color: "var(--qz-fg-3)" }}>
                    {g.count} device{g.count === 1 ? "" : "s"}
                  </span>
                </div>
                <div
                  className="h-[8px] rounded-full overflow-hidden"
                  style={{ background: "color-mix(in oklab, var(--qz-fg-4) 20%, transparent)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(g.count / managed.length) * 100}%`,
                      background: onLatest ? "var(--qz-accent)" : "var(--qz-ink-7)",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Security activity rollup ─────────────────────────────────────────────────

/// Fleet-wide sums of the latest per-device security counters. Snapshots only
/// — the muted chip is honest that this is not a trend.
export function SecurityRollupCard({
  telemetry,
  devices,
  subGuid,
  onViewAll,
}: {
  telemetry: DeviceSecurityTelemetry[] | null;
  devices: Device[];
  subGuid?: string;
  onViewAll?: () => void;
}) {
  const scoped = (telemetry ?? []).filter((t) => (subGuid ? t.sub_org_id === subGuid : true));
  const sum = (f: (t: DeviceSecurityTelemetry) => number) =>
    scoped.reduce((acc, t) => acc + f(t), 0);
  const ipsOf = (t: DeviceSecurityTelemetry) => t.ips_prevented + t.ips_detected;
  const tiles = [
    { label: "IPS EVENTS", value: sum(ipsOf) },
    { label: "APP BLOCKS", value: sum((t) => t.ac_blocked) },
    { label: "CONTENT BLOCKS", value: sum((t) => t.cf_blocked) },
    { label: "GEO BLOCKS", value: sum((t) => t.geo_blocked) },
  ];
  const most = [...scoped].sort((a, b) => ipsOf(b) - ipsOf(a))[0];
  const mostName = most
    ? devices.find((d) => d.device_id === most.device_id)?.hostname ?? most.device_id
    : null;

  return (
    <section className="surface p-5">
      <CardHeader title="Security Activity" onViewAll={onViewAll} />
      <div className="grid grid-cols-2 gap-[10px] mb-3">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-lg p-3"
            style={{
              background: "var(--qz-surface-raised)",
              border: "1px solid var(--qz-border-subtle)",
            }}
          >
            <div
              className="text-[9.5px]"
              style={{ fontFamily: "var(--qz-font-mono)", color: "var(--qz-fg-4)", letterSpacing: "0.1em" }}
            >
              {t.label}
            </div>
            <div
              className="text-[20px] font-semibold mt-[5px] leading-none tabular-nums"
              style={{ fontFamily: "var(--qz-font-mono)", color: "var(--qz-fg-1)" }}
            >
              {t.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--qz-fg-3)" }}>
        {mostName ? (
          <Fragment>
            <ShieldAlert size={13} style={{ color: "var(--qz-fg-4)" }} />
            <span>
              Most active: <span style={{ fontFamily: "var(--qz-font-mono)", color: "var(--qz-fg-1)" }}>{mostName}</span>
            </span>
          </Fragment>
        ) : (
          <span>{telemetry === null ? "Loading…" : "No security telemetry yet."}</span>
        )}
        <span className="badge badge-muted ml-auto">SNAPSHOT</span>
      </div>
    </section>
  );
}

// ── Organizations needing attention (org scope) ──────────────────────────────

interface OrgRow {
  sub: SubOrganization;
  devices: number;
  offline: number;
  behind: number;
  alerts24h: number;
  worstCpu: number | null;
  score: number;
}

/// One row per sub-organization holding devices, scored so problems float and
/// healthy orgs sink. Everything derives from data the dashboard already has.
export function orgAttentionRows(
  subs: SubOrganization[],
  devices: Device[],
  fleet: FleetStatsResponse | null,
  events: OrgEvent[],
  latestVer: Version | null,
  now: number,
): OrgRow[] {
  const cpuBySub = new Map<string, number>();
  for (const s of fleet?.stats ?? []) {
    if (!s.sub_org_id) continue;
    cpuBySub.set(s.sub_org_id, Math.max(cpuBySub.get(s.sub_org_id) ?? 0, s.cpu_pct));
  }
  const alertsBySub = new Map<string, number>();
  for (const e of events) {
    const sub = eventSubOrg(e);
    if (!sub || e.severity === "info" || now - Date.parse(e.created_at) > DAY_MS) continue;
    alertsBySub.set(sub, (alertsBySub.get(sub) ?? 0) + 1);
  }

  return subs
    .map((sub) => {
      const managed = devices.filter((d) => d.sub_org_id === sub.id && d.state !== "revoked");
      const offline = managed.filter((d) => d.state === "adopted" && !d.connected).length;
      const behind = latestVer
        ? managed.filter((d) => {
            const v = parseVersion(d.qf_version);
            return v != null && versionLt(v, latestVer);
          }).length
        : 0;
      const alerts24h = alertsBySub.get(sub.id) ?? 0;
      const worstCpu = cpuBySub.get(sub.id) ?? null;
      const score =
        offline * 3 +
        alerts24h * 2 +
        behind +
        (worstCpu != null && worstCpu >= 90 ? 2 : worstCpu != null && worstCpu >= 80 ? 1 : 0);
      return { sub, devices: managed.length, offline, behind, alerts24h, worstCpu, score };
    })
    .filter((r) => r.devices > 0)
    .sort((a, b) => b.score - a.score || b.devices - a.devices);
}

const mutedZero = (
  <span className="tabular-nums" style={{ color: "var(--qz-fg-4)" }}>
    0
  </span>
);

/// The MSP centerpiece: which of my organizations needs me today. Row click
/// opens that sub-organization's dashboard.
export function OrgAttentionTable({
  subs,
  devices,
  fleet,
  events,
  latestVer,
  now,
  onOpenSub,
  onViewAll,
}: {
  subs: SubOrganization[];
  devices: Device[];
  fleet: FleetStatsResponse | null;
  events: OrgEvent[] | null;
  latestVer: Version | null;
  now: number;
  onOpenSub: (subGuid: string) => void;
  onViewAll?: () => void;
}) {
  const rows = orgAttentionRows(subs, devices, fleet, events ?? [], latestVer, now);
  return (
    <section className="surface p-5">
      <CardHeader title="Organizations Needing Attention" onViewAll={onViewAll} />
      {rows.length === 0 ? (
        <p className="text-[12.5px] m-0 flex items-center gap-2" style={{ color: "var(--qz-fg-4)" }}>
          <CircleAlert size={13} />
          No sub-organizations hold devices yet.
        </p>
      ) : (
        <table className="qz-table">
          <thead>
            <tr>
              <th>Organization</th>
              <th className="text-right">Devices</th>
              <th className="text-right">Offline</th>
              <th className="text-right">FW Behind</th>
              <th className="text-right">Alerts 24h</th>
              <th className="text-right">Worst CPU</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sub.id} onClick={() => onOpenSub(r.sub.id)}>
                <td className="font-semibold text-[var(--qz-fg-1)]">{r.sub.name}</td>
                <td className="text-right tabular-nums">{r.devices}</td>
                <td className="text-right">
                  {r.offline > 0 ? <span className="badge badge-crit">{r.offline}</span> : mutedZero}
                </td>
                <td className="text-right">
                  {r.behind > 0 ? (
                    <span className="tabular-nums" style={{ color: "var(--qz-warn)" }}>
                      {r.behind}
                    </span>
                  ) : (
                    mutedZero
                  )}
                </td>
                <td className="text-right">
                  {r.alerts24h > 0 ? (
                    <span className="badge badge-warn">{r.alerts24h}</span>
                  ) : (
                    mutedZero
                  )}
                </td>
                <td className="text-right">
                  {r.worstCpu != null ? (
                    pctCell(r.worstCpu, 80)
                  ) : (
                    <span style={{ color: "var(--qz-fg-4)" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
