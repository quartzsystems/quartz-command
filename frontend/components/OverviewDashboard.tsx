"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { useCloudOrg } from "@/components/CloudShell";
import { getCurrentUser, type AuthUserInfo } from "@/lib/api";
import { useLatestFirmware } from "@/components/fleet/firmware";
import {
  FirewallStatusCard,
  FirmwareUpgradesCard,
  ManagedFirewallsStat,
} from "@/components/fleet/FleetCards";

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

/// The Overview / Dashboard landing page. Rendered at the organization level
/// (no `subGuid`) or scoped to a single sub-organization. The heavy data
/// (devices, sub-orgs) is already loaded by the shell; firmware is fetched from
/// GitHub client-side.
export function OverviewDashboard({ subGuid }: { subGuid?: string }) {
  const { orgGuid, org, subs, devices, refreshSubs, refreshDevices, refreshFolders } =
    useCloudOrg();
  const router = useRouter();

  const [user, setUser] = useState<AuthUserInfo | null>(null);
  useEffect(() => setUser(getCurrentUser()), []);

  const { latest, latestVer, reload: reloadFirmware } = useLatestFirmware();

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
    setUpdatedAt(Date.now());
    setNow(Date.now());
  };

  const sub = subGuid ? subs?.find((s) => s.id === subGuid) : undefined;
  const scoped = (devices ?? []).filter((d) => (subGuid ? d.sub_org_id === subGuid : true));
  const managed = scoped.filter((d) => d.state !== "revoked");

  // Distinct sub-orgs that hold at least one firewall (org level only).
  const orgsWithFirewalls = new Set(
    managed.map((d) => d.sub_org_id).filter((id): id is string => id != null),
  ).size;

  const monitorHref = subGuid
    ? `/cloud/${orgGuid}/orgs/${subGuid}/monitor`
    : `/cloud/${orgGuid}/monitor`;

  const scopeName = subGuid ? sub?.name ?? "Loading…" : org?.name ?? "Loading…";
  const greetingName = user ? user.full_name || user.email : "…";
  const statSubtitle = subGuid
    ? `In ${sub?.name ?? "this sub-organization"}`
    : `In ${orgsWithFirewalls} ${orgsWithFirewalls === 1 ? "organization" : "organizations"}`;

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header: profile greeting + scope, refresh on the right */}
      <header className="flex items-start justify-between gap-4">
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

      <div className="max-w-[360px]">
        <ManagedFirewallsStat devices={scoped} subtitle={statSubtitle} />
      </div>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
      >
        <FirewallStatusCard devices={scoped} onViewAll={() => router.push(monitorHref)} />
        <FirmwareUpgradesCard
          devices={scoped}
          latest={latest}
          latestVer={latestVer}
          onViewAll={() => router.push(monitorHref)}
        />
      </div>
    </div>
  );
}
