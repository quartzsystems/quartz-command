"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCloudOrg } from "@/components/CloudShell";
import { Toast } from "@/components/dashboard/Toast";
import {
  ApplicationControlCard,
  ContentFilteringCard,
  GeolocationCard,
  IntrusionPreventionCard,
} from "@/components/monitor/ServiceCards";
import { Sparkline } from "@/components/monitor/Sparkline";
import { ModalHeader, ModalShell } from "@/components/ui/Modal";
import * as api from "@/lib/api";
import type { DeviceStatsResponse } from "@/lib/api";
import { formatVersion } from "@/components/fleet/firmware";
import {
  counterKey,
  fetchFirewall,
  fetchRuleCounters,
  type FirewallRule,
  type RuleCounter,
} from "@/lib/device/firewall";
import { formatBytes, formatUptime } from "@/lib/device/format";
import { useMonitorTelemetry } from "@/lib/monitor/telemetry";

const STATS_POLL_MS = 30_000;

/// Device Monitor overview. Top row: identity + reboot, device information, and
/// CPU/memory/disk sparklines. Then the live security-service cards scoped to
/// this one firewall, and the Most Active Rules table. Health and stats come
/// from the device-stats snapshot the firewall pushes over its control stream;
/// the security cards from the security-telemetry snapshot. Most Active Rules
/// reads the device's live firewall config and per-rule counters through the
/// proxy (the same source as the Rules page), so it shows the user's named
/// rules and the default action — not the raw nftables chains the agent's
/// top_policies telemetry reports.
export function DeviceMonitorSummary() {
  const { orgGuid, org, subs, devices, refreshDevices } = useCloudOrg();
  const params = useParams<{ sub_guid?: string; device_id?: string }>();
  const deviceId = params.device_id ?? "";

  const device = (devices ?? []).find((d) => d.device_id === deviceId);
  const sub = params.sub_guid ? subs?.find((s) => s.id === params.sub_guid) : undefined;
  const scoped = device ? [device] : [];
  const telemetry = useMonitorTelemetry(orgGuid, scoped);

  const name = (device?.hostname ?? deviceId).toUpperCase();
  const canManage = org?.role === "owner" || org?.role === "admin";

  // ── Device stats (health + policies), polled at the device cadence. ────────
  const [stats, setStats] = useState<DeviceStatsResponse | null>(null);
  const [statsError, setStatsError] = useState(false);
  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    const load = () =>
      api
        .getDeviceStats(orgGuid, deviceId)
        .then((r) => !cancelled && (setStats(r), setStatsError(false)))
        .catch(() => !cancelled && setStatsError(true));
    load();
    const t = setInterval(load, STATS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [orgGuid, deviceId]);

  const latest = stats?.latest ?? null;
  const samples = stats?.samples ?? [];
  const publicIp = latest?.public_ip || device?.last_seen_ip || "—";

  // ── Reboot ─────────────────────────────────────────────────────────────────
  const [rebooting, setRebooting] = useState(false);
  const [confirmReboot, setConfirmReboot] = useState(false);
  const [toast, setToast] = useState("");
  const reboot = useCallback(async () => {
    if (!device) return;
    setRebooting(true);
    try {
      await api.rebootDevice(orgGuid, deviceId);
      setToast(`Reboot command sent to ${name}.`);
      // The stream drops as it restarts — refresh connectivity shortly after.
      setTimeout(refreshDevices, 3000);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Reboot failed.");
    } finally {
      setRebooting(false);
      setConfirmReboot(false);
    }
  }, [device, name, orgGuid, deviceId, refreshDevices]);

  const connected = device?.connected ?? false;
  const rebootDisabled = rebooting || !connected || !canManage;
  const rebootTitle = !canManage
    ? "Requires owner or admin"
    : !connected
      ? "Device is offline"
      : undefined;

  return (
    <div className="p-6 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1
          className="text-[20px] font-bold text-[var(--qz-fg-1)] m-0"
          style={{ letterSpacing: "-0.02em" }}
        >
          {name}
        </h1>
        <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
          {sub?.name ?? "Loading…"}
        </p>
      </header>

      {/* Level 1: identity · device information · resource stats */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        {/* Identity + reboot */}
        <section className="surface p-5 flex flex-col items-center justify-center gap-3 text-center">
          <img src="/logo-mark.png" alt="Quartz Systems" className="w-16 h-16" />
          <div className="flex items-center gap-[7px]">
            <span
              className="w-[9px] h-[9px] rounded-full flex-shrink-0"
              style={{ background: connected ? "var(--qz-success)" : "var(--qz-fg-4)" }}
            />
            <span className="text-[13px] font-medium text-[var(--qz-fg-1)]">
              {connected ? "Connected" : "Offline"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setConfirmReboot(true)}
            disabled={rebootDisabled}
            title={rebootTitle}
            className="flex items-center gap-[7px] px-3 py-[7px] rounded-md text-[12.5px] font-medium border transition-all duration-[120ms] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 text-[var(--qz-fg-2)] border-[var(--qz-border)] hover:text-[var(--qz-fg-1)] hover:bg-[color-mix(in_oklab,white_4%,transparent)]"
          >
            <RotateCcw size={14} className={rebooting ? "animate-spin" : undefined} />
            <span>{rebooting ? "Rebooting…" : "Reboot Device"}</span>
          </button>
        </section>

        {/* Device information */}
        <section className="surface p-5 flex flex-col gap-4">
          <h2 className="text-[14px] font-semibold text-[var(--qz-fg-1)] m-0">Device Information</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-[10px] m-0">
            <InfoRow label="Name" value={device?.hostname ?? deviceId} />
            <InfoRow label="Version" value={formatVersion(device?.qf_version)} />
            <InfoRow label="Public IP" value={publicIp} mono />
            <InfoRow label="Uptime" value={formatUptime(latest?.uptime_secs)} />
          </dl>
        </section>

        {/* Resource stats */}
        <section className="surface p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-[var(--qz-fg-1)] m-0">Device Stats</h2>
            {statsError && (
              <span className="text-[11px]" style={{ color: "var(--qz-fg-4)" }}>
                Unavailable
              </span>
            )}
          </div>
          <StatMeter
            label="CPU Usage"
            value={latest?.cpu_pct}
            series={samples.map((s) => s.cpu_pct)}
            color="var(--qz-accent)"
          />
          <StatMeter
            label="Memory Usage"
            value={latest?.mem_pct}
            series={samples.map((s) => s.mem_pct)}
            color="var(--qz-accent)"
            detail={memDetail(latest)}
          />
          <StatMeter
            label="Disk Usage"
            value={latest?.disk_pct}
            series={samples.map((s) => s.disk_pct)}
            color="var(--qz-accent)"
            detail={diskDetail(latest)}
          />
        </section>
      </div>

      {/* Level 2: live security-service cards, scoped to this firewall */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <IntrusionPreventionCard t={telemetry} />
        <ApplicationControlCard t={telemetry} />
        <GeolocationCard t={telemetry} />
        <ContentFilteringCard t={telemetry} />
      </div>

      {/* Level 3: most active rules (live per-rule counters via the proxy) */}
      <MostActiveRules deviceId={deviceId} connected={connected} />

      {confirmReboot && (
        <RebootConfirmModal
          name={name}
          working={rebooting}
          onCancel={() => setConfirmReboot(false)}
          onConfirm={reboot}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}

/// Themed replacement for window.confirm on the reboot action, so the warning
/// reads inside the console instead of a bare browser dialog. Backdrop/Escape
/// closes are ignored while the command is in flight (the parent unmounts this
/// once the reboot is sent).
function RebootConfirmModal({
  name,
  working,
  onCancel,
  onConfirm,
}: {
  name: string;
  working: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const close = () => {
    if (!working) onCancel();
  };
  return (
    <ModalShell onClose={close} maxWidth={440}>
      <ModalHeader title="Reboot device" onClose={close} />
      <div className="flex flex-col gap-4">
        <div
          className="flex gap-3 rounded-md px-3 py-3"
          style={{
            background: "var(--qz-warn-soft)",
            border: "1px solid color-mix(in oklab, var(--qz-warn) 35%, transparent)",
          }}
        >
          <AlertTriangle size={16} className="flex-shrink-0 mt-[1px]" style={{ color: "var(--qz-warn)" }} />
          <p className="text-[13px] text-[var(--qz-fg-2)] m-0">
            Reboot <span className="font-semibold text-[var(--qz-fg-1)]">{name}</span>? It will drop offline for a
            minute or two.
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={close}
            disabled={working}
            className="px-4 py-[9px] rounded-md text-[13px] font-medium cursor-pointer disabled:opacity-50"
            style={{ background: "transparent", border: "1px solid var(--qz-border)", color: "var(--qz-fg-2)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={working}
            className="px-4 py-[9px] rounded-md text-[13px] font-semibold cursor-pointer border-0 disabled:opacity-70"
            style={{ background: "var(--qz-warn)", color: "white" }}
          >
            {working ? "Rebooting…" : "Reboot"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-[12.5px] font-medium" style={{ color: "var(--qz-fg-3)" }}>
        {label}
      </dt>
      <dd
        className={`text-[12.5px] text-[var(--qz-fg-1)] m-0 text-right truncate${mono ? " tabular-nums" : ""}`}
        style={mono ? { fontFamily: "var(--qz-font-mono)" } : undefined}
        title={value}
      >
        {value}
      </dd>
    </>
  );
}

/// One resource gauge: a percentage plus its rolling sparkline, and — when the
/// firewall reports absolute figures — a muted "used / free / total" line.
function StatMeter({
  label,
  value,
  series,
  color,
  detail,
}: {
  label: string;
  value: number | undefined;
  series: number[];
  color: string;
  /** Absolute-figures line (e.g. "2.02 GB used · 60.5 GB free · 62.5 GB total"). */
  detail?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Sparkline values={series} color={color} />
      <div className="flex items-center justify-between">
        <span className="text-[12px]" style={{ color: "var(--qz-fg-3)" }}>
          {label}
        </span>
        <span className="text-[12.5px] font-semibold text-[var(--qz-fg-1)] tabular-nums">
          {value == null ? "—" : `${Math.round(value)}%`}
        </span>
      </div>
      {detail && (
        <span className="text-[11px] tabular-nums" style={{ color: "var(--qz-fg-4)" }}>
          {detail}
        </span>
      )}
    </div>
  );
}

/// "used · free · total" for RAM, or null when the firewall didn't report bytes.
function memDetail(latest: api.DeviceStats | null): string | null {
  if (!latest || latest.mem_total_bytes <= 0) return null;
  const free = Math.max(0, latest.mem_total_bytes - latest.mem_used_bytes);
  return `${formatBytes(latest.mem_used_bytes)} used · ${formatBytes(free)} free · ${formatBytes(latest.mem_total_bytes)} total`;
}

/// "used of total" for the root filesystem, or null when bytes weren't reported.
function diskDetail(latest: api.DeviceStats | null): string | null {
  if (!latest || latest.disk_total_bytes <= 0) return null;
  return `${formatBytes(latest.disk_used_bytes)} of ${formatBytes(latest.disk_total_bytes)}`;
}

/** One ranked line in the Most Active Rules table. */
type RuleRow = { name: string; bytes: number; hits: number; muted?: boolean };

/// Most Active Rules: the device's firewall rules ranked by traffic, read from
/// the live config and per-rule counters through the proxy — the same source
/// the Rules page uses — plus the forward default action pinned at the bottom.
/// This is the accurate view: the agent's top_policies telemetry reports raw
/// nftables chains (state-policy, raw/mangle default-actions) that crowd out
/// the user's own rules, so we don't use it here. Refreshed on the device
/// cadence; needs the device online since it proxies live counters.
function MostActiveRules({ deviceId, connected }: { deviceId: string; connected: boolean }) {
  // How many rule rows to show before the default-action row.
  const MAX_RULES = 12;
  const [rows, setRows] = useState<RuleRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!deviceId || !connected) {
      setRows(null);
      setError(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const fw = await fetchFirewall();
        // Counters depend on the zone pairs the config reports.
        const counters = await fetchRuleCounters(fw.zone_pairs);
        if (cancelled) return;
        // A rule spanning several zone pairs is counted once per pair — its
        // real total is the sum across its scopes (see the Rules page).
        const ruleRows: RuleRow[] = fw.rules
          .map((r: FirewallRule) => {
            const parts = r.scopes
              .map((s) => counters.get(counterKey(s.chain, r.rule)))
              .filter((c): c is RuleCounter => c !== undefined);
            const c = parts.reduce(
              (a, b) => ({ packets: a.packets + b.packets, bytes: a.bytes + b.bytes }),
              { packets: 0, bytes: 0 },
            );
            return { name: r.name || `Rule ${r.rule}`, bytes: c.bytes, hits: c.packets };
          })
          .sort((a, b) => b.bytes - a.bytes || b.hits - a.hits)
          .slice(0, MAX_RULES);
        // The forward default action — what forwarded traffic matching no rule
        // gets. Its counter uses the `default` pseudo-rule key.
        const dflt = counters.get(counterKey("forward", "default"));
        ruleRows.push({
          name: `Default action · ${fw.default_action === "drop" ? "Deny" : "Allow"}`,
          bytes: dflt?.bytes ?? 0,
          hits: dflt?.packets ?? 0,
          muted: true,
        });
        setRows(ruleRows);
        setError(false);
      } catch {
        if (!cancelled) {
          setError(true);
          setRows(null);
        }
      }
    };
    load();
    const t = setInterval(load, STATS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [deviceId, connected]);

  return (
    <section className="surface p-5 flex flex-col gap-4">
      <h2 className="text-[14px] font-semibold text-[var(--qz-fg-1)] m-0">Most Active Rules</h2>
      {rows === null ? (
        <p className="text-[12.5px] m-0" style={{ color: "var(--qz-fg-4)" }}>
          {!connected ? "Firewall is offline." : error ? "Rule telemetry unavailable." : "Loading rules…"}
        </p>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--qz-border)" }}>
              <th className="text-left font-medium py-[6px]" style={{ color: "var(--qz-fg-3)" }}>
                Name
              </th>
              <th className="text-right font-medium py-[6px]" style={{ color: "var(--qz-fg-3)" }}>
                Bytes
              </th>
              <th className="text-right font-medium py-[6px]" style={{ color: "var(--qz-fg-3)" }}>
                Hits
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={`${p.name}-${i}`} style={{ borderBottom: "1px solid var(--qz-border)" }}>
                <td
                  className="py-[7px] truncate max-w-[420px]"
                  style={{ color: p.muted ? "var(--qz-fg-3)" : "var(--qz-fg-1)" }}
                  title={p.name}
                >
                  {p.name}
                </td>
                <td className="py-[7px] text-right text-[var(--qz-fg-2)] tabular-nums">
                  {formatBytes(p.bytes)}
                </td>
                <td className="py-[7px] text-right text-[var(--qz-fg-2)] tabular-nums">
                  {p.hits.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
