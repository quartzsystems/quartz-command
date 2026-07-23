"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, TriangleAlert, WifiOff } from "lucide-react";
import { useCloudOrg } from "@/components/CloudShell";
import {
  getCurrentUser,
  getFleetStats,
  listAuditLog,
  listEnrollmentTokens,
  listOrgEvents,
  listSecurityTelemetry,
  type AuditEntry,
  type AuthUserInfo,
  type DeviceSecurityTelemetry,
  type EnrollmentToken,
  type FleetStatsResponse,
  type OrgEvent,
} from "@/lib/api";
import { useLatestFirmware } from "@/components/fleet/firmware";
import {
  FirewallStatusCard,
  FirmwareUpgradesCard,
  ManagedFirewallsStat,
  ManagedSwitchesStat,
  SwitchFirmwareUpgradesCard,
  SwitchStatusCard,
} from "@/components/fleet/FleetCards";
import {
  AuditActivityCard,
  EventsFeedCard,
  FirmwareSpreadCard,
  FleetHealthCard,
  NeedsAttentionCard,
  OrgAttentionTable,
  SecurityRollupCard,
  scopeEvents,
} from "@/components/fleet/DashboardCards";
import { NetworkUsageCard } from "@/components/fleet/NetworkUsageCard";
import { TopTalkersCard } from "@/components/fleet/TopTalkersCard";
import { VpnTunnelsCard, HaHealthCard } from "@/components/fleet/VpnHaCards";

/// Avatar initials: first letters of the full name's words ("Cody Wellman" →
/// "CW"), else the first two letters of the email. Mirrors CloudShell.
function userInitials(user: AuthUserInfo): string {
  const words = (user.full_name ?? "").split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? user.email).slice(0, 2).toUpperCase();
}

function relativeTime(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/// A KPI stat tile in the ManagedStat shape, for the derived counts (offline,
/// alerts) that don't warrant their own card.
function StatTile({
  icon: Icon,
  tone,
  count,
  label,
  subtitle,
}: {
  icon: typeof WifiOff;
  tone: "accent" | "warn" | "crit";
  count: number;
  label: string;
  subtitle: string;
}) {
  const tones = {
    accent: { bg: "var(--qz-accent-soft)", fg: "var(--qz-accent)" },
    warn: { bg: "var(--qz-warn-soft)", fg: "var(--qz-warn)" },
    crit: { bg: "var(--qz-danger-soft)", fg: "var(--qz-danger)" },
  }[count > 0 ? tone : "accent"];
  return (
    <div className="surface p-5 flex items-center gap-4">
      <div
        className="w-12 h-12 rounded-xl grid place-items-center flex-shrink-0"
        style={{ background: tones.bg, color: tones.fg }}
      >
        <Icon size={22} />
      </div>
      <div className="flex flex-col">
        <span
          className="text-[30px] font-bold text-[var(--qz-fg-1)] leading-none"
          style={{ letterSpacing: "-0.02em" }}
        >
          {count}
        </span>
        <span className="text-[13px] mt-1" style={{ color: "var(--qz-fg-2)" }}>
          {label}
        </span>
        <span className="text-[12px] mt-[2px]" style={{ color: "var(--qz-fg-4)" }}>
          {subtitle}
        </span>
      </div>
    </div>
  );
}

const DASH_POLL_MS = 60_000;

/// The Overview / Dashboard landing page. Rendered at the organization level
/// (no `subGuid`) as the MSP rollup — cross-fleet KPIs, the organizations-
/// needing-attention table, events, per-product status — or scoped to one
/// sub-organization as the site view with device health, VPN/HA rollups, top
/// talkers, and network usage. The heavy inventory data (devices, sub-orgs)
/// is already loaded by the shell; the dashboard endpoints (events, audit,
/// fleet stats, telemetry, tokens) are polled here.
export function OverviewDashboard({ subGuid }: { subGuid?: string }) {
  const { orgGuid, org, subs, devices, refreshSubs, refreshDevices, refreshFolders } =
    useCloudOrg();
  const router = useRouter();

  const [user, setUser] = useState<AuthUserInfo | null>(null);
  useEffect(() => setUser(getCurrentUser()), []);

  const { latest, latestVer, reload: reloadFirmware } = useLatestFirmware();
  const { latest: sonicLatest, latestVer: sonicLatestVer, reload: reloadSonicFirmware } =
    useLatestFirmware("quartzsonic");

  // Dashboard feeds: events, audit, fleet health, security telemetry, tokens.
  const [events, setEvents] = useState<OrgEvent[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [fleet, setFleet] = useState<FleetStatsResponse | null>(null);
  const [telemetry, setTelemetry] = useState<DeviceSecurityTelemetry[] | null>(null);
  const [tokens, setTokens] = useState<EnrollmentToken[] | null>(null);

  const loadDashData = useCallback(async () => {
    if (!orgGuid) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const [ev, au, fs, tel, tok] = await Promise.allSettled([
      listOrgEvents(orgGuid),
      listAuditLog(orgGuid),
      getFleetStats(orgGuid),
      listSecurityTelemetry(orgGuid),
      listEnrollmentTokens(orgGuid),
    ]);
    setEvents((p) => (ev.status === "fulfilled" ? ev.value : p ?? []));
    setAudit((p) => (au.status === "fulfilled" ? au.value : p ?? []));
    setFleet((p) => (fs.status === "fulfilled" ? fs.value : p));
    setTelemetry((p) => (tel.status === "fulfilled" ? tel.value : p ?? []));
    setTokens((p) => (tok.status === "fulfilled" ? tok.value : p ?? []));
  }, [orgGuid]);

  useEffect(() => {
    loadDashData();
    const id = setInterval(loadDashData, DASH_POLL_MS);
    return () => clearInterval(id);
  }, [loadDashData]);

  // "Updated …" clock — recomputed every 30s so the relative label stays fresh.
  const [updatedAt, setUpdatedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const refresh = () => {
    refreshDevices();
    refreshSubs();
    refreshFolders();
    reloadFirmware(true);
    reloadSonicFirmware(true);
    loadDashData();
    setUpdatedAt(Date.now());
    setNow(Date.now());
  };

  const sub = subGuid ? subs?.find((s) => s.id === subGuid) : undefined;
  const scoped = (devices ?? []).filter((d) => (subGuid ? d.sub_org_id === subGuid : true));
  const managed = scoped.filter((d) => d.state !== "revoked");
  const scopedTokens = tokens?.filter((t) => (subGuid ? t.sub_org_id === subGuid : true)) ?? null;

  const offline = managed.filter((d) => d.state === "adopted" && !d.connected).length;
  const alerts24h = scopeEvents(events ?? [], subGuid).filter(
    (e) => e.severity !== "info" && now - Date.parse(e.created_at) < 24 * 3600_000,
  ).length;
  const hasSwitches = managed.some((d) => d.product === "quartzsonic");

  // Distinct sub-orgs that hold at least one device of a product (org level).
  const orgCount = (product: string) =>
    new Set(
      managed
        .filter((d) => d.product === product)
        .map((d) => d.sub_org_id)
        .filter((id): id is string => id != null),
    ).size;

  const monitorHref = subGuid
    ? `/cloud/${orgGuid}/orgs/${subGuid}/monitor`
    : `/cloud/${orgGuid}/monitor`;
  const inventoryHref = `/cloud/${orgGuid}/inventory`;
  const goMonitor = () => router.push(monitorHref);

  const scopeName = subGuid ? sub?.name ?? "Loading…" : org?.name ?? "Loading…";
  const greetingName = user ? user.full_name || user.email : "…";
  const statSubtitle = (product: string) => {
    if (subGuid) return `In ${sub?.name ?? "this sub-organization"}`;
    const n = orgCount(product);
    return `In ${n} ${n === 1 ? "organization" : "organizations"}`;
  };

  return (
    <div className="p-6 flex flex-col gap-4">
      {/* Header: profile greeting + scope, refresh on the right */}
      <header className="flex items-start justify-between gap-4 mb-2">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-full grid place-items-center text-[var(--qz-fg-on-accent)] font-bold text-[15px] flex-shrink-0"
            style={{ background: "linear-gradient(135deg, var(--qz-green-700), var(--qz-green-500))" }}
          >
            {user ? userInitials(user) : "…"}
          </div>
          <div className="flex flex-col">
            <h1
              className="text-[20px] font-bold text-[var(--qz-fg-1)] m-0"
              style={{ letterSpacing: "-0.02em" }}
            >
              Hi {greetingName}
            </h1>
            <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
              {scopeName}
              {!subGuid && (
                <span style={{ color: "var(--qz-fg-4)" }}>
                  {" · "}
                  {subs === null ? "…" : subs.length} Managed{" "}
                  {subs?.length === 1 ? "Organization" : "Organizations"}
                </span>
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={refresh}
          title="Refresh"
          className="inline-flex items-center gap-[7px] text-[12px] bg-transparent border-0 cursor-pointer p-1"
          style={{ color: "var(--qz-fg-4)" }}
        >
          <RotateCw size={14} />
          <span>Updated {relativeTime(updatedAt, now)}</span>
        </button>
      </header>

      {/* KPI tiles */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}
      >
        <ManagedFirewallsStat devices={scoped} subtitle={statSubtitle("quartzfire")} />
        <ManagedSwitchesStat devices={scoped} subtitle={statSubtitle("quartzsonic")} />
        <StatTile
          icon={WifiOff}
          tone="crit"
          count={offline}
          label="Devices Offline"
          subtitle={offline === 0 ? "Whole fleet connected" : "Live gateway signal"}
        />
        <StatTile
          icon={TriangleAlert}
          tone="warn"
          count={alerts24h}
          label="Alerts · 24h"
          subtitle="Warning and critical events"
        />
      </div>

      {subGuid ? (
        /* ── Sub-organization (site) dashboard ─────────────────────────── */
        <>
          <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
            <FleetHealthCard
              devices={scoped}
              fleet={fleet}
              subGuid={subGuid}
              onViewAll={goMonitor}
            />
            <EventsFeedCard events={events} subGuid={subGuid} now={now} />
          </div>

          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
          >
            <VpnTunnelsCard orgGuid={orgGuid} subGuid={subGuid} onViewAll={goMonitor} />
            <HaHealthCard
              orgGuid={orgGuid}
              subGuid={subGuid}
              devices={devices}
              onViewAll={goMonitor}
            />
            <SecurityRollupCard
              telemetry={telemetry}
              devices={scoped}
              subGuid={subGuid}
              onViewAll={goMonitor}
            />
            <NeedsAttentionCard
              devices={scoped}
              tokens={scopedTokens}
              now={now}
              onViewAll={() => router.push(inventoryHref)}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <TopTalkersCard
              orgGuid={orgGuid}
              subGuid={subGuid}
              onViewAll={() => router.push(`${monitorHref}/quartzwatch`)}
            />
            <NetworkUsageCard orgGuid={orgGuid} subGuid={subGuid} />
          </div>
        </>
      ) : (
        /* ── Organization (MSP) overview ───────────────────────────────── */
        <>
          <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
            <OrgAttentionTable
              subs={subs ?? []}
              devices={devices ?? []}
              fleet={fleet}
              events={events}
              latestVer={latestVer}
              now={now}
              onOpenSub={(id) => router.push(`/cloud/${orgGuid}/orgs/${id}`)}
            />
            <EventsFeedCard events={events} now={now} />
          </div>

          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}
          >
            <FirewallStatusCard devices={scoped} onViewAll={goMonitor} />
            {hasSwitches && <SwitchStatusCard devices={scoped} onViewAll={goMonitor} />}
            <FirmwareUpgradesCard
              devices={scoped}
              latest={latest}
              latestVer={latestVer}
              onViewAll={goMonitor}
            />
            {hasSwitches && (
              <SwitchFirmwareUpgradesCard
                devices={scoped}
                latest={sonicLatest}
                latestVer={sonicLatestVer}
                onViewAll={goMonitor}
              />
            )}
          </div>

          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
          >
            <FirmwareSpreadCard
              devices={scoped}
              product="quartzfire"
              latestVer={latestVer}
              title="QuartzFire Firmware Versions"
            />
            {hasSwitches && (
              <FirmwareSpreadCard
                devices={scoped}
                product="quartzsonic"
                latestVer={sonicLatestVer}
                title="QuartzSONiC Firmware Versions"
              />
            )}
            <SecurityRollupCard telemetry={telemetry} devices={scoped} onViewAll={goMonitor} />
            <NeedsAttentionCard
              devices={scoped}
              tokens={tokens}
              now={now}
              onViewAll={() => router.push(inventoryHref)}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
            <NetworkUsageCard orgGuid={orgGuid} />
            <AuditActivityCard entries={audit} now={now} />
          </div>
        </>
      )}
    </div>
  );
}
