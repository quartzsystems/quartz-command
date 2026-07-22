// Data layer for BGP on QuartzSONiC switches, fetched live through the
// device proxy against the agent's management API (quartz-sonic
// src/mgmtapi.rs). Config lives in CONFIG_DB consumed by frrcfgd
// (BGP_GLOBALS / BGP_GLOBALS_AF / BGP_NEIGHBOR / BGP_NEIGHBOR_AF keyed by
// vrf); on legacy images without frr_mgmt_framework the agent falls back to
// the flat BGP_NEIGHBOR schema plus DEVICE_METADATA bgp_asn and the
// capability envelope reports read_only for the fields that path can't
// express. Session state comes from STATE_DB NEIGH_STATE_TABLE (bgpmon)
// enriched with FRR's `show bgp ... json`. Keep these shapes in step with
// quartz-sonic — the agent is the source of truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

export const BGP_ADDRESS_FAMILIES = ["ipv4_unicast", "ipv6_unicast", "l2vpn_evpn"] as const;
export type BgpAddressFamily = (typeof BGP_ADDRESS_FAMILIES)[number];

export const BGP_AF_LABEL: Record<BgpAddressFamily, string> = {
  ipv4_unicast: "IPv4",
  ipv6_unicast: "IPv6",
  l2vpn_evpn: "EVPN",
};

export interface BgpGlobals {
  /** "default" or a data VRF name. */
  vrf: string;
  local_asn: number | null;
  router_id: string | null;
  keepalive: number | null;
  holdtime: number | null;
  graceful_restart: boolean;
  /** ECMP path limits; null means FRR default. */
  max_ebgp_paths: number | null;
  max_ibgp_paths: number | null;
}

export interface BgpNeighbor {
  vrf: string;
  /** Peer address, or interface name for unnumbered sessions. */
  peer: string;
  remote_asn: number | null;
  /** Free-form neighbor description. */
  name: string | null;
  peer_group: string | null;
  local_addr: string | null;
  keepalive: number | null;
  holdtime: number | null;
  /** eBGP multihop TTL; null when disabled. */
  ebgp_multihop_ttl: number | null;
  bfd: boolean;
  admin_status: "up" | "down";
  address_families: BgpAddressFamily[];
  // Operational state.
  /** FRR session state, e.g. "Established", "Idle", "Active"; null when
   *  unknown. */
  session_state: string | null;
  /** Prefixes received across enabled AFs; null when not established. */
  prefixes_received: number | null;
  /** Session uptime in seconds; null when not established. */
  uptime_secs: number | null;
}

export interface BgpDoc {
  capability: FeatureCapability;
  /** Which config path the agent is using on this image. */
  mode: "frrcfgd" | "legacy" | "unavailable";
  globals: BgpGlobals[];
  neighbors: BgpNeighbor[];
}

export async function fetchBgpDoc(): Promise<BgpDoc> {
  return apiFetch<BgpDoc>("/routing/bgp");
}

export interface BgpGlobalsInput {
  local_asn: number | null;
  router_id?: string | null;
  keepalive?: number | null;
  holdtime?: number | null;
  graceful_restart?: boolean;
  max_ebgp_paths?: number | null;
  max_ibgp_paths?: number | null;
}

export async function updateBgpGlobals(vrf: string, input: BgpGlobalsInput): Promise<void> {
  await apiFetch(`/routing/bgp/globals/${encodeURIComponent(vrf)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export interface BgpNeighborInput {
  remote_asn: number | null;
  name?: string | null;
  peer_group?: string | null;
  local_addr?: string | null;
  keepalive?: number | null;
  holdtime?: number | null;
  ebgp_multihop_ttl?: number | null;
  bfd: boolean;
  admin_status: "up" | "down";
  /** Full desired AF set — the agent diffs it against BGP_NEIGHBOR_AF. */
  address_families: BgpAddressFamily[];
}

export async function createBgpNeighbor(
  vrf: string,
  peer: string,
  input: BgpNeighborInput,
): Promise<void> {
  await apiFetch("/routing/bgp/neighbors", {
    method: "POST",
    body: JSON.stringify({ vrf, peer, ...input }),
  });
}

export async function updateBgpNeighbor(
  vrf: string,
  peer: string,
  input: BgpNeighborInput,
): Promise<void> {
  await apiFetch(
    `/routing/bgp/neighbors/${encodeURIComponent(vrf)}/${encodeURIComponent(peer)}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export async function deleteBgpNeighbor(vrf: string, peer: string): Promise<void> {
  await apiFetch(
    `/routing/bgp/neighbors/${encodeURIComponent(vrf)}/${encodeURIComponent(peer)}`,
    { method: "DELETE" },
  );
}
