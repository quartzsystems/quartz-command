// Data layer for QuartzSONiC switch state, fetched live through the device
// proxy against the agent's in-process management API (quartz-sonic
// src/mgmtapi.rs). The agent assembles these documents from the switch's
// redis databases: CONFIG_DB (PORT / VLAN / VLAN_MEMBER / PORTCHANNEL /
// PORTCHANNEL_MEMBER), STATE_DB (PORT_TABLE / LAG_TABLE oper state), and
// COUNTERS_DB (per-port SAI error counters). Keep these shapes in step with
// quartz-sonic — the agent is the source of truth for the contract.

import { apiFetch } from "@/lib/device/api";

// ── Ports ───────────────────────────────────────────────────────────────────

export type PortStatus = "up" | "down" | "unknown";

/** How a port participates in L2: untagged-only member of one VLAN (access),
 *  any tagged membership (trunk), or no VLAN membership at all (routed). */
export type VlanMode = "access" | "trunk" | "routed";

export interface SwitchPort {
  /** SONiC interface name, e.g. "Ethernet0". */
  name: string;
  /** Front-panel alias from CONFIG_DB, e.g. "Eth1/1". */
  alias: string | null;
  description: string | null;
  admin_status: "up" | "down";
  oper_status: PortStatus;
  /** Operational speed (STATE_DB), falling back to configured speed. */
  speed_mbps: number | null;
  /** Forward error correction: "rs", "fc", or "none". */
  fec: string | null;
  mtu: number | null;
  vlan_mode: VlanMode | null;
  untagged_vlan: number | null;
  tagged_vlans: number[];
  /** Cumulative SAI error/discard counters; null when COUNTERS_DB has no
   *  entry for the port (e.g. right after boot). */
  rx_err: number | null;
  tx_err: number | null;
  rx_drops: number | null;
  tx_drops: number | null;
}

export async function fetchSwitchPorts(): Promise<SwitchPort[]> {
  const resp = await apiFetch<{ ports: SwitchPort[] }>("/switching/ports");
  return resp.ports;
}

// ── Port channels ───────────────────────────────────────────────────────────

export interface PortChannelMember {
  name: string;
  oper_status: PortStatus;
  /** LACP selection state; null for static LAGs or when teamd state is
   *  unavailable. */
  selected: boolean | null;
}

export interface PortChannel {
  /** e.g. "PortChannel0001". */
  name: string;
  protocol: "lacp" | "static";
  admin_status: "up" | "down";
  oper_status: PortStatus;
  mtu: number | null;
  min_links: number | null;
  fallback: boolean;
  fast_rate: boolean;
  members: PortChannelMember[];
}

export async function fetchPortChannels(): Promise<PortChannel[]> {
  const resp = await apiFetch<{ port_channels: PortChannel[] }>("/switching/port-channels");
  return resp.port_channels;
}

// ── VLANs ───────────────────────────────────────────────────────────────────

export interface VlanMember {
  /** Port or port-channel name. */
  name: string;
  tagging: "tagged" | "untagged";
}

export interface SwitchVlan {
  vlan_id: number;
  /** SONiC VLAN key, e.g. "Vlan10". */
  name: string;
  description: string | null;
  /** SVI addresses from VLAN_INTERFACE, CIDR strings. */
  ip_addresses: string[];
  /** DHCP relay destinations configured on the VLAN. */
  dhcp_helpers: string[];
  members: VlanMember[];
}

export async function fetchVlans(): Promise<SwitchVlan[]> {
  const resp = await apiFetch<{ vlans: SwitchVlan[] }>("/switching/vlans");
  return resp.vlans;
}

// ── Formatting helpers ──────────────────────────────────────────────────────

/** "25G" / "100G" / "400M" — switch-style short speed labels. */
export function formatPortSpeed(mbps: number | null): string | null {
  if (mbps == null || mbps <= 0) return null;
  if (mbps < 1000) return `${mbps}M`;
  const g = mbps / 1000;
  return `${Number.isInteger(g) ? g : g.toFixed(1)}G`;
}
