"use client";

import { useParams } from "next/navigation";
import { useCloudOrg } from "@/components/CloudShell";
import { useLatestFirmware } from "@/components/fleet/firmware";
import { FirewallStatusCard, FirmwareUpgradesCard } from "@/components/fleet/FleetCards";
import {
  ApplicationControlCard,
  ContentFilteringCard,
  GeolocationCard,
  IntrusionPreventionCard,
} from "@/components/monitor/ServiceCards";
import { useMonitorTelemetry } from "@/lib/monitor/telemetry";

/// Monitor → Summary for a sub-organization (or a single device within one).
/// Fleet cards are scoped to the devices in view; the security-service cards
/// render their shape with zeroed metrics until that telemetry exists.
export function MonitorSummary() {
  const { orgGuid, subs, devices } = useCloudOrg();
  const params = useParams<{ sub_guid?: string; device_id?: string }>();
  const { latest, latestVer } = useLatestFirmware();

  const sub = params.sub_guid ? subs?.find((s) => s.id === params.sub_guid) : undefined;
  const device = params.device_id
    ? (devices ?? []).find((d) => d.device_id === params.device_id)
    : undefined;

  const scoped = (devices ?? []).filter((d) =>
    params.device_id
      ? d.device_id === params.device_id
      : params.sub_guid
        ? d.sub_org_id === params.sub_guid
        : true,
  );

  const scopeName = params.device_id
    ? `${(device?.hostname ?? params.device_id).toUpperCase()} · ${sub?.name ?? ""}`
    : sub?.name ?? "Loading…";

  // Live security telemetry, aggregated across the scoped online firewalls.
  const telemetry = useMonitorTelemetry(orgGuid, scoped);

  return (
    <div className="p-6 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1
          className="text-[20px] font-bold text-[var(--qz-fg-1)] m-0"
          style={{ letterSpacing: "-0.02em" }}
        >
          Summary
        </h1>
        <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
          {scopeName}
        </p>
      </header>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <FirewallStatusCard devices={scoped} />
        <FirmwareUpgradesCard devices={scoped} latest={latest} latestVer={latestVer} />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <IntrusionPreventionCard t={telemetry} />
        <ApplicationControlCard t={telemetry} />
        <GeolocationCard t={telemetry} />
        <ContentFilteringCard t={telemetry} />
      </div>
    </div>
  );
}
