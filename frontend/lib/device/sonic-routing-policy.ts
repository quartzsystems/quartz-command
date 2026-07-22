// Data layer for routing policy (prefix lists + route maps) on QuartzSONiC
// switches, fetched live through the device proxy against the agent's
// management API (quartz-sonic src/mgmtapi.rs). The agent programs FRR in
// the bgp container directly (vtysh), because community SONiC has no
// CONFIG_DB schema for route maps; enterprise images that do get the same
// document shape. Keep these shapes in step with quartz-sonic — the agent is
// the source of truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

export type SonicPrefixFamily = "ipv4" | "ipv6";
export type SonicPolicyAction = "permit" | "deny";

// ── Prefix lists ────────────────────────────────────────────────────────────

export interface SonicPrefixRule {
  seq: number;
  action: SonicPolicyAction;
  /** CIDR, e.g. "10.0.0.0/8" or "fc00::/7". */
  prefix: string;
  /** Match mask length >= ge; null = exact unless le set. */
  ge: number | null;
  /** Match mask length <= le. */
  le: number | null;
}

export interface SonicPrefixList {
  name: string;
  family: SonicPrefixFamily;
  rules: SonicPrefixRule[];
}

// ── Route maps ──────────────────────────────────────────────────────────────

/** Match conditions of one route-map entry. All null = match everything. */
export interface SonicRouteMapMatch {
  /** IPv4 prefix-list name. */
  ip_prefix_list: string | null;
  /** IPv6 prefix-list name. */
  ipv6_prefix_list: string | null;
  /** BGP community value, e.g. "65000:100". */
  community: string | null;
  metric: number | null;
  tag: number | null;
}

/** Actions applied by one route-map entry when it matches. */
export interface SonicRouteMapSet {
  local_preference: number | null;
  metric: number | null;
  /** Communities to set, e.g. "65000:100 65000:200". */
  community: string | null;
  /** ASN to prepend, repeated, e.g. "65000 65000". */
  as_path_prepend: string | null;
  ip_next_hop: string | null;
  origin: "igp" | "egp" | "incomplete" | null;
  tag: number | null;
}

export interface SonicRouteMapEntry {
  seq: number;
  action: SonicPolicyAction;
  description: string | null;
  match: SonicRouteMapMatch;
  set: SonicRouteMapSet;
}

export interface SonicRouteMap {
  name: string;
  entries: SonicRouteMapEntry[];
}

// ── Document + calls ────────────────────────────────────────────────────────

export interface RoutingPolicyDoc {
  capability: FeatureCapability;
  prefix_lists: SonicPrefixList[];
  route_maps: SonicRouteMap[];
}

export async function fetchRoutingPolicy(): Promise<RoutingPolicyDoc> {
  return apiFetch<RoutingPolicyDoc>("/routing/policy");
}

/** Upsert a whole prefix list (rules replace the live set — the agent diffs
 *  and rewrites the FRR object atomically). */
export async function putPrefixList(list: SonicPrefixList): Promise<void> {
  await apiFetch(`/routing/policy/prefix-lists/${encodeURIComponent(list.name)}`, {
    method: "PUT",
    body: JSON.stringify(list),
  });
}

/** Rejected while a route map still references the list. */
export async function deletePrefixList(name: string): Promise<void> {
  await apiFetch(`/routing/policy/prefix-lists/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

/** Upsert a whole route map (entries replace the live set). */
export async function putRouteMap(map: SonicRouteMap): Promise<void> {
  await apiFetch(`/routing/policy/route-maps/${encodeURIComponent(map.name)}`, {
    method: "PUT",
    body: JSON.stringify(map),
  });
}

/** Rejected while BGP/OSPF still references the map. */
export async function deleteRouteMap(name: string): Promise<void> {
  await apiFetch(`/routing/policy/route-maps/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export function emptySonicMatch(): SonicRouteMapMatch {
  return { ip_prefix_list: null, ipv6_prefix_list: null, community: null, metric: null, tag: null };
}

export function emptySonicSet(): SonicRouteMapSet {
  return {
    local_preference: null,
    metric: null,
    community: null,
    as_path_prepend: null,
    ip_next_hop: null,
    origin: null,
    tag: null,
  };
}

export function emptySonicRouteMapEntry(seq: number): SonicRouteMapEntry {
  return { seq, action: "permit", description: null, match: emptySonicMatch(), set: emptySonicSet() };
}
