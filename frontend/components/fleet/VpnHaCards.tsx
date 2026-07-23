"use client";

// Sub-org dashboard rollups fed by the read-only monitor fan-out: VPN tunnel
// up/down counts per type (mirroring the Monitor → VPN aggregates' parsing)
// and MCLAG/VRRP pair health for the QuartzSONiC switches.

import { useCallback, useEffect, useState } from "react";
import type { Device } from "@/lib/api";
import { fanoutShow } from "@/lib/device/fanout";
import { fetchHaDocs, sonicSwitches, switchLabel } from "@/lib/device/ha-fanout";
import { colIndex, parseFixedTable, parseWireguardStatus } from "@/lib/device/vpn-status";
import type { MclagDoc } from "@/lib/device/sonic-mclag";
import type { VrrpDoc } from "@/lib/device/sonic-vrrp";
import { CardHeader } from "@/components/fleet/FleetCards";

const POLL_MS = 60_000;

/// Count "up" rows in an op-mode table by a state column — same heuristics as
/// the Monitor → VPN aggregate pages.
function countUp(
  text: string,
  headerKeyword: string,
  stateCandidates: string[],
  isUp: (s: string) => boolean,
): { up: number; total: number } {
  const table = parseFixedTable(text, headerKeyword);
  const col = colIndex(table, ...stateCandidates);
  const total = table.rows.length;
  const up = col >= 0 ? table.rows.filter((r) => isUp(r[col] ?? "")).length : 0;
  return { up, total };
}

interface VpnRow {
  label: string;
  up: number;
  total: number;
}

function sumRows(texts: (string | null)[], count: (t: string) => { up: number; total: number }) {
  let up = 0;
  let total = 0;
  for (const t of texts) {
    if (t == null) continue;
    const c = count(t);
    up += c.up;
    total += c.total;
  }
  return { up, total };
}

/// VPN tunnels across the sub-org's firewalls, one row per type with an
/// up/total badge and fill bar. Types with zero configured tunnels are hidden.
export function VpnTunnelsCard({
  orgGuid,
  subGuid,
  onViewAll,
}: {
  orgGuid: string;
  subGuid: string;
  onViewAll?: () => void;
}) {
  const [rows, setRows] = useState<VpnRow[] | null>(null);

  const load = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const [wg, ovpn, ipsec, l2tpPrimary] = await Promise.all([
        fanoutShow(orgGuid, subGuid, ["interfaces", "wireguard"]),
        fanoutShow(orgGuid, subGuid, ["interfaces", "openvpn"]),
        fanoutShow(orgGuid, subGuid, ["vpn", "ipsec", "sa"]),
        fanoutShow(orgGuid, subGuid, ["vpn", "remote-access"]),
      ]);
      // Older builds only know `show l2tp-server sessions`.
      let l2tp = l2tpPrimary;
      if (l2tpPrimary.some((it) => it.data == null)) {
        const fallback = await fanoutShow(orgGuid, subGuid, ["l2tp-server", "sessions"]);
        const byId = new Map(fallback.map((it) => [it.deviceId, it]));
        l2tp = l2tpPrimary.map((it) => (it.data == null ? byId.get(it.deviceId) ?? it : it));
      }

      const wgPeers = wg
        .flatMap((it) => (it.data == null ? [] : parseWireguardStatus(it.data)))
        .flatMap((i) => i.peers);
      const openvpnUp = (s: string) => {
        const [a, l] = s.split("/");
        return a?.toLowerCase() === "u" && l?.toLowerCase() === "u";
      };
      const ipsecUp = (s: string) =>
        s.toLowerCase().startsWith("up") || s.toLowerCase().startsWith("est");
      const l2tpActive = (s: string) => {
        const v = s.toLowerCase();
        return v.startsWith("active") || v.startsWith("estab") || v.startsWith("up");
      };

      const next: VpnRow[] = [
        {
          label: "WireGuard",
          up: wgPeers.filter((p) => p.latest_handshake && p.latest_handshake.trim() !== "").length,
          total: wgPeers.length,
        },
        {
          label: "IPsec",
          ...sumRows(ipsec.map((it) => it.data), (t) => countUp(t, "Connection", ["State"], ipsecUp)),
        },
        {
          label: "OpenVPN",
          ...sumRows(ovpn.map((it) => it.data), (t) => countUp(t, "Interface", ["S/L"], openvpnUp)),
        },
        {
          label: "L2TP",
          ...sumRows(l2tp.map((it) => it.data), (t) => countUp(t, "user", ["state"], l2tpActive)),
        },
      ].filter((r) => r.total > 0);
      setRows(next);
    } catch {
      setRows((prev) => prev ?? []);
    }
  }, [orgGuid, subGuid]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const down = (rows ?? []).reduce((acc, r) => acc + (r.total - r.up), 0);

  return (
    <section className="surface p-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-[14px] font-semibold text-[var(--qz-fg-1)] m-0">VPN Tunnels</h2>
        <div className="flex items-center gap-2">
          {down > 0 ? (
            <span className="badge badge-warn">{down} DOWN</span>
          ) : (
            (rows?.length ?? 0) > 0 && <span className="badge badge-ok">ALL UP</span>
          )}
          {onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="text-[12.5px] font-medium bg-transparent border-0 cursor-pointer p-0"
              style={{ color: "var(--qz-accent)" }}
            >
              Monitor
            </button>
          )}
        </div>
      </div>
      {rows === null ? (
        <p className="text-[12.5px] m-0" style={{ color: "var(--qz-fg-4)" }}>
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[12.5px] m-0" style={{ color: "var(--qz-fg-4)" }}>
          No VPN tunnels configured.
        </p>
      ) : (
        <div className="flex flex-col gap-[11px]">
          {rows.map((r) => {
            const allUp = r.up === r.total;
            return (
              <div key={r.label}>
                <div className="flex items-center justify-between text-[12px] mb-[5px]">
                  <span style={{ color: "var(--qz-fg-2)" }}>{r.label}</span>
                  <span
                    className="tabular-nums"
                    style={{ color: allUp ? "var(--qz-fg-3)" : "var(--qz-warn)" }}
                  >
                    {r.up} / {r.total} up
                  </span>
                </div>
                <div
                  className="h-[8px] rounded-full overflow-hidden"
                  style={{ background: "color-mix(in oklab, var(--qz-fg-4) 20%, transparent)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(r.up / r.total) * 100}%`,
                      background: allUp ? "var(--qz-accent)" : "var(--qz-warn)",
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

// ── High Availability ────────────────────────────────────────────────────────

interface HaRow {
  key: string;
  title: string;
  detail: string;
  state: "ok" | "warn" | "muted";
  badge: string;
}

/// MCLAG session + VRRP group health across the sub-org's QuartzSONiC
/// switches. Renders nothing when the sub-org has no switches.
export function HaHealthCard({
  orgGuid,
  subGuid,
  devices,
  onViewAll,
}: {
  orgGuid: string;
  subGuid: string;
  devices: Device[] | null;
  onViewAll?: () => void;
}) {
  const switches = sonicSwitches(devices, subGuid);
  const [rows, setRows] = useState<HaRow[] | null>(null);

  const load = useCallback(async () => {
    if (switches.length === 0) return;
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const [mclag, vrrp] = await Promise.all([
        fetchHaDocs<MclagDoc>(orgGuid, subGuid, "/ha/mclag", switches),
        fetchHaDocs<VrrpDoc>(orgGuid, subGuid, "/ha/vrrp", switches),
      ]);

      const next: HaRow[] = [];
      for (const d of mclag) {
        const domain = d.doc?.domain;
        if (!domain) continue;
        const session = d.doc?.state?.session_status;
        const members = d.doc?.state?.members ?? [];
        const inSync = members.filter(
          (m) => m.local_status === "up" && m.remote_status === "up",
        ).length;
        next.push({
          key: `mclag:${d.device.device_id}`,
          title: `MCLAG ${domain.domain_id} · ${switchLabel(d.device)}`,
          detail:
            members.length > 0
              ? `${inSync} / ${members.length} member LAGs in sync`
              : `peer ${domain.peer_ip}`,
          state: session === "up" ? "ok" : d.connected ? "warn" : "muted",
          badge: session === "up" ? "HEALTHY" : d.connected ? "DEGRADED" : "OFFLINE",
        });
      }

      // VRRP health is a pair property: exactly one master per group id.
      const groups = new Map<number, { interfaces: Set<string>; masters: number; total: number; vips: string[] }>();
      for (const d of vrrp) {
        for (const g of d.doc?.groups ?? []) {
          const cur =
            groups.get(g.vrid) ?? { interfaces: new Set<string>(), masters: 0, total: 0, vips: [] };
          cur.interfaces.add(g.interface);
          cur.total += 1;
          if (g.state === "master") cur.masters += 1;
          if (cur.vips.length === 0 && g.virtual_ips.length > 0) cur.vips = g.virtual_ips;
          groups.set(g.vrid, cur);
        }
      }
      for (const [vrid, g] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
        const healthy = g.masters === 1 && g.total >= 2;
        next.push({
          key: `vrrp:${vrid}`,
          title: `VRRP ${vrid}${g.vips.length > 0 ? ` · ${g.vips[0]}` : ""}`,
          detail:
            g.total >= 2
              ? `${g.masters} master / ${g.total - g.masters} backup`
              : "single member — no failover peer",
          state: healthy ? "ok" : "warn",
          badge: healthy ? "HEALTHY" : "DEGRADED",
        });
      }
      setRows(next);
    } catch {
      setRows((prev) => prev ?? []);
    }
    // switches derives from devices; identity churn is fine for this poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgGuid, subGuid, devices]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (switches.length === 0) return null;

  return (
    <section className="surface p-5">
      <CardHeader title="High Availability" onViewAll={onViewAll} />
      {rows === null ? (
        <p className="text-[12.5px] m-0" style={{ color: "var(--qz-fg-4)" }}>
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[12.5px] m-0" style={{ color: "var(--qz-fg-4)" }}>
          No MCLAG domains or VRRP groups configured.
        </p>
      ) : (
        <div className="flex flex-col">
          {rows.map((r) => (
            <div
              key={r.key}
              className="flex items-center gap-3 py-[9px] border-b last:border-b-0"
              style={{ borderColor: "var(--qz-divider)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-[var(--qz-fg-1)]" style={{ fontFamily: "var(--qz-font-mono)" }}>
                  {r.title}
                </div>
                <div className="text-[11.5px] mt-[2px]" style={{ color: "var(--qz-fg-4)" }}>
                  {r.detail}
                </div>
              </div>
              <span
                className={`badge flex-shrink-0 ${
                  r.state === "ok" ? "badge-ok" : r.state === "warn" ? "badge-warn" : "badge-muted"
                }`}
              >
                {r.badge}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
