"use client";

import { useCloudOrg } from "@/components/CloudShell";
import { useLatestFirmware } from "@/components/fleet/firmware";
import {
  FirewallStatusCard,
  FirmwareUpgradesCard,
  ManagedFirewallsStat,
} from "@/components/fleet/FleetCards";

/// The organization-level Monitor landing view: the managed-firewall stat and
/// the fleet Status + Firmware cards across the whole organization. No sub-nav
/// here (that begins at the sub-organization / device scope).
export function MonitorOverview() {
  const { org, devices } = useCloudOrg();
  const { latest, latestVer } = useLatestFirmware();

  const scoped = devices ?? [];
  const managed = scoped.filter((d) => d.state !== "revoked");
  const orgsWithFirewalls = new Set(
    managed.map((d) => d.sub_org_id).filter((id): id is string => id != null),
  ).size;

  return (
    <div className="p-6 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1
          className="text-[20px] font-bold text-[var(--qz-fg-1)] m-0"
          style={{ letterSpacing: "-0.02em" }}
        >
          Monitor
        </h1>
        <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
          {org?.name ?? "Loading…"}
        </p>
      </header>

      <div className="max-w-[360px]">
        <ManagedFirewallsStat
          devices={scoped}
          subtitle={`In ${orgsWithFirewalls} ${orgsWithFirewalls === 1 ? "organization" : "organizations"}`}
        />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <FirewallStatusCard devices={scoped} />
        <FirmwareUpgradesCard devices={scoped} latest={latest} latestVer={latestVer} />
      </div>
    </div>
  );
}
