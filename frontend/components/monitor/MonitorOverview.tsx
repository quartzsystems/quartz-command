"use client";

import { useCloudOrg } from "@/components/CloudShell";
import { useLatestFirmware } from "@/components/fleet/firmware";
import {
  FirewallStatusCard,
  FirmwareUpgradesCard,
  ManagedFirewallsStat,
  ManagedSwitchesStat,
} from "@/components/fleet/FleetCards";

/// The organization-level Monitor landing view: the managed-firewall and
/// managed-switch stats and the fleet Status + Firmware cards across the
/// whole organization. No sub-nav here (that begins at the sub-organization /
/// device scope).
export function MonitorOverview() {
  const { org, devices } = useCloudOrg();
  const { latest, latestVer } = useLatestFirmware();

  const scoped = devices ?? [];
  const managed = scoped.filter((d) => d.state !== "revoked");
  const subtitle = (product: string) => {
    const n = new Set(
      managed
        .filter((d) => d.product === product)
        .map((d) => d.sub_org_id)
        .filter((id): id is string => id != null),
    ).size;
    return `In ${n} ${n === 1 ? "organization" : "organizations"}`;
  };

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

      <div
        className="grid gap-4 max-w-[740px]"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
      >
        <ManagedFirewallsStat devices={scoped} subtitle={subtitle("quartzfire")} />
        <ManagedSwitchesStat devices={scoped} subtitle={subtitle("quartzsonic")} />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <FirewallStatusCard devices={scoped} />
        <FirmwareUpgradesCard devices={scoped} latest={latest} latestVer={latestVer} />
      </div>
    </div>
  );
}
