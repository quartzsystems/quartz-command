"use client";

import { AppWindow, Filter, Globe, LucideIcon, ShieldAlert } from "lucide-react";
import { formatCount, type MonitorTelemetryState } from "@/lib/monitor/telemetry";

/// The shared coverage footnote — every card draws its numbers from the same
/// stored snapshots, so they share one "N of M firewalls reporting" note.
function coverageNote(t: MonitorTelemetryState, suffix?: string): string {
  if (t.loading) return "Loading telemetry…";
  if (t.error) return "Telemetry unavailable.";
  if (t.data.total === 0) return "No firewalls in this scope.";
  if (t.data.reported === 0) return "No firewalls have reported telemetry yet.";
  const base = `${t.data.reported} of ${t.data.total} ${
    t.data.total === 1 ? "firewall" : "firewalls"
  } reporting`;
  return suffix ? `${base} · ${suffix}` : base;
}

/// One security-service card, driven by aggregated live telemetry.
function ServiceCard({
  title,
  icon: Icon,
  primary,
  metrics,
  footnote,
  loading,
}: {
  title: string;
  icon: LucideIcon;
  primary: { label: string; value: string };
  metrics: { label: string; value: string }[];
  footnote: string;
  loading: boolean;
}) {
  return (
    <section className="surface p-5 flex flex-col gap-4" style={{ opacity: loading ? 0.6 : 1 }}>
      <div className="flex items-center gap-2">
        <Icon size={16} style={{ color: "var(--qz-fg-3)" }} />
        <h2 className="text-[14px] font-semibold text-[var(--qz-fg-1)] m-0">{title}</h2>
      </div>

      <div className="flex flex-col">
        <span
          className="text-[26px] font-bold text-[var(--qz-fg-1)] leading-none tabular-nums"
          style={{ letterSpacing: "-0.02em" }}
        >
          {primary.value}
        </span>
        <span className="text-[12px] mt-1" style={{ color: "var(--qz-fg-3)" }}>
          {primary.label}
        </span>
      </div>

      <ul className="flex flex-col gap-[8px] m-0 p-0 list-none">
        {metrics.map((m) => (
          <li key={m.label} className="flex items-center justify-between text-[13px]">
            <span style={{ color: "var(--qz-fg-2)" }}>{m.label}</span>
            <span className="font-semibold text-[var(--qz-fg-1)] tabular-nums">{m.value}</span>
          </li>
        ))}
      </ul>

      <span className="text-[11px] mt-auto" style={{ color: "var(--qz-fg-4)" }}>
        {footnote}
      </span>
    </section>
  );
}

export function IntrusionPreventionCard({ t }: { t: MonitorTelemetryState }) {
  const m = t.data.ips;
  return (
    <ServiceCard
      title="Intrusion Prevention"
      icon={ShieldAlert}
      primary={{ label: "Prevented", value: formatCount(m.prevented) }}
      metrics={[
        { label: "Detected", value: formatCount(m.detected) },
        { label: "Scans", value: m.scansAvailable ? formatCount(m.scans) : "—" },
      ]}
      footnote={coverageNote(t)}
      loading={t.loading}
    />
  );
}

export function ApplicationControlCard({ t }: { t: MonitorTelemetryState }) {
  const m = t.data.appControl;
  return (
    <ServiceCard
      title="Application Control"
      icon={AppWindow}
      primary={{ label: "Blocked", value: formatCount(m.blocked) }}
      metrics={[
        { label: "Detected", value: formatCount(m.detected) },
        { label: "Total requests", value: formatCount(m.totalRequests) },
      ]}
      footnote={coverageNote(t)}
      loading={t.loading}
    />
  );
}

export function GeolocationCard({ t }: { t: MonitorTelemetryState }) {
  const m = t.data.geo;
  return (
    <ServiceCard
      title="Geolocation"
      icon={Globe}
      primary={{ label: "Blocked", value: formatCount(m.blocked) }}
      metrics={[
        { label: "Connections checked", value: formatCount(m.connections) },
        { label: "Countries blocked", value: formatCount(m.countries) },
      ]}
      footnote={coverageNote(t)}
      loading={t.loading}
    />
  );
}

export function ContentFilteringCard({ t }: { t: MonitorTelemetryState }) {
  const m = t.data.content;
  return (
    <ServiceCard
      title="Content Filtering"
      icon={Filter}
      primary={{ label: "Blocked", value: formatCount(m.blocked) }}
      metrics={[
        { label: "Allowed", value: formatCount(m.allowed) },
        { label: "Total requests", value: formatCount(m.totalRequests) },
      ]}
      footnote={coverageNote(t)}
      loading={t.loading}
    />
  );
}
