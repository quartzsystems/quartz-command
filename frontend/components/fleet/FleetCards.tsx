"use client";

import { ArrowUpCircle, EthernetPort, Flame } from "lucide-react";
import type { Device } from "@/lib/api";
import { parseVersion, upgradeableCount, type Version } from "@/components/fleet/firmware";

// ── Shared bits ─────────────────────────────────────────────────────────────

/// Optional "View All" link on a card header — hidden when no handler is given
/// (e.g. on the Monitor page you're already where "View All" would take you).
function CardHeader({ title, onViewAll }: { title: string; onViewAll?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-[14px] font-semibold text-[var(--qz-fg-1)] m-0">{title}</h2>
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
  );
}

interface StatusSegment {
  label: string;
  value: number;
  color: string;
}

/// Inline-SVG donut of firewall statuses (no chart library). Rotated so the
/// first segment starts at 12 o'clock; an empty fleet shows a plain track ring.
function StatusDonut({ segments, total }: { segments: StatusSegment[]; total: number }) {
  const size = 132;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const track = "color-mix(in oklab, var(--qz-fg-4) 22%, transparent)";

  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => {
              const len = (s.value / total) * c;
              const el = (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })}
      </g>
      <text
        x="50%"
        y="47%"
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fill: "var(--qz-fg-1)", fontSize: 26, fontWeight: 700 }}
      >
        {total}
      </text>
      <text
        x="50%"
        y="62%"
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fill: "var(--qz-fg-4)", fontSize: 11 }}
      >
        {total === 1 ? "Device" : "Devices"}
      </text>
    </svg>
  );
}

// ── Cards ───────────────────────────────────────────────────────────────────

/// Shared body of the per-product "Managed …" stat tiles.
function ManagedStat({
  count,
  label,
  subtitle,
  icon: Icon,
}: {
  count: number;
  label: string;
  subtitle: string;
  icon: typeof Flame;
}) {
  return (
    <div className="surface p-5 flex items-center gap-4">
      <div
        className="w-12 h-12 rounded-xl grid place-items-center flex-shrink-0"
        style={{ background: "var(--qz-accent-soft)", color: "var(--qz-accent)" }}
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

/// "Managed QuartzFire Firewalls" stat tile. `devices` is already scoped (but
/// may mix products — only QuartzFire counts here); revoked devices are
/// excluded. `subtitle` names the scope.
export function ManagedFirewallsStat({
  devices,
  subtitle,
}: {
  devices: Device[];
  subtitle: string;
}) {
  const count = devices.filter(
    (d) => d.product === "quartzfire" && d.state !== "revoked",
  ).length;
  return (
    <ManagedStat count={count} label="Managed QuartzFire Firewalls" subtitle={subtitle} icon={Flame} />
  );
}

/// "Managed QuartzSONiC Switches" stat tile — the switch-fleet counterpart.
export function ManagedSwitchesStat({
  devices,
  subtitle,
}: {
  devices: Device[];
  subtitle: string;
}) {
  const count = devices.filter(
    (d) => d.product === "quartzsonic" && d.state !== "revoked",
  ).length;
  return (
    <ManagedStat count={count} label="Managed QuartzSONiC Switches" subtitle={subtitle} icon={EthernetPort} />
  );
}

/// "QuartzFire Firewall Status" donut + legend — live Online vs Offline over
/// the active fleet. Connectivity is the gateway's real-time signal
/// (`device.connected`); revoked (decommissioned) devices are excluded.
export function FirewallStatusCard({
  devices,
  onViewAll,
}: {
  devices: Device[];
  onViewAll?: () => void;
}) {
  const active = devices.filter((d) => d.product === "quartzfire" && d.state !== "revoked");
  const online = active.filter((d) => d.connected).length;
  const segments: StatusSegment[] = [
    { label: "Online", value: online, color: "var(--qz-green-500)" },
    { label: "Offline", value: active.length - online, color: "var(--qz-danger)" },
  ];
  return (
    <section className="surface p-5">
      <CardHeader title="QuartzFire Firewall Status" onViewAll={onViewAll} />
      <div className="flex items-center gap-6">
        <StatusDonut segments={segments} total={active.length} />
        <ul className="flex flex-col gap-[10px] m-0 p-0 list-none flex-1 min-w-0">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center gap-[10px] text-[13px]">
              <span className="w-[10px] h-[10px] rounded-full flex-shrink-0" style={{ background: s.color }} />
              <span className="text-[var(--qz-fg-2)]">{s.label}</span>
              <span className="ml-auto font-semibold text-[var(--qz-fg-1)] tabular-nums">{s.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/// "QuartzFire Firewall Firmware Upgrades" — devices behind the latest release.
export function FirmwareUpgradesCard({
  devices,
  latest,
  latestVer,
  onViewAll,
}: {
  devices: Device[];
  latest: string | null;
  latestVer: Version | null;
  onViewAll?: () => void;
}) {
  const managed = devices.filter((d) => d.product === "quartzfire" && d.state !== "revoked");
  const upgradeable = upgradeableCount(managed, latestVer);
  return (
    <section className="surface p-5">
      <CardHeader title="QuartzFire Firewall Firmware Upgrades" onViewAll={onViewAll} />
      <div className="flex items-center gap-3 mb-1">
        <ArrowUpCircle size={22} style={{ color: "var(--qz-accent)" }} />
        <span
          className="text-[28px] font-bold text-[var(--qz-fg-1)] leading-none"
          style={{ letterSpacing: "-0.02em" }}
        >
          {latest === null ? "—" : upgradeable}
        </span>
      </div>
      <p className="text-[13px] m-0 mb-4" style={{ color: "var(--qz-fg-3)" }}>
        {latest === null
          ? "Latest release unavailable"
          : `Devices ready to upgrade${parseVersion(latest) ? ` to ${latest}` : ""}`}
      </p>
      <div className="flex items-center justify-between text-[12.5px] mb-[6px]">
        <span style={{ color: "var(--qz-fg-2)" }}>Firewalls</span>
        <span className="tabular-nums" style={{ color: "var(--qz-fg-3)" }}>
          {upgradeable} of {managed.length}
        </span>
      </div>
      <div
        className="h-[8px] rounded-full overflow-hidden"
        style={{ background: "color-mix(in oklab, var(--qz-fg-4) 20%, transparent)" }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${managed.length ? (upgradeable / managed.length) * 100 : 0}%`,
            background: "var(--qz-accent)",
            transition: "width 200ms",
          }}
        />
      </div>
    </section>
  );
}
