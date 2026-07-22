// Data layer for OSPFv2 on QuartzSONiC switches, fetched live through the
// device proxy against the agent's management API (quartz-sonic
// src/mgmtapi.rs). Config lives in the frrcfgd CONFIG_DB tables
// (OSPFV2_ROUTER / OSPFV2_ROUTER_AREA / OSPFV2_ROUTER_AREA_NETWORK /
// OSPFV2_INTERFACE, keyed by vrf); ospfd only runs when
// frr_mgmt_framework_config is enabled, so on default community images the
// capability envelope reports unsupported. Neighbor state comes from FRR's
// `show ip ospf neighbor json`. Keep these shapes in step with quartz-sonic
// — the agent is the source of truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

export interface OspfInstance {
  /** "default" or a data VRF name. */
  vrf: string;
  router_id: string | null;
  /** Administrative distance; null means FRR default (110). */
  distance: number | null;
  areas: OspfArea[];
}

export interface OspfArea {
  /** Dotted-quad or decimal area id, e.g. "0.0.0.0". */
  area_id: string;
  stub: boolean;
  /** `network <prefix> area <id>` statements for this area. */
  networks: string[];
}

export interface OspfInterface {
  name: string;
  /** Area the interface is placed in directly (interface-mode config);
   *  null when the interface only participates via network statements. */
  area: string | null;
  cost: number | null;
  hello_interval: number | null;
  dead_interval: number | null;
  network_type: "broadcast" | "point-to-point" | null;
  passive: boolean;
  bfd: boolean;
}

export interface OspfNeighborStatus {
  neighbor_id: string;
  address: string;
  interface: string;
  /** FRR adjacency state, e.g. "Full/DR", "2-Way". */
  state: string;
  priority: number | null;
  /** Seconds until the dead timer expires; null when unknown. */
  dead_time_secs: number | null;
}

export interface OspfDoc {
  capability: FeatureCapability;
  instances: OspfInstance[];
  interfaces: OspfInterface[];
  neighbors: OspfNeighborStatus[];
}

export async function fetchOspfDoc(): Promise<OspfDoc> {
  return apiFetch<OspfDoc>("/routing/ospf");
}

export interface OspfInstanceInput {
  /** False removes the OSPF router for the VRF entirely. */
  enabled: boolean;
  router_id?: string | null;
  distance?: number | null;
}

export async function updateOspfInstance(vrf: string, input: OspfInstanceInput): Promise<void> {
  await apiFetch(`/routing/ospf/instances/${encodeURIComponent(vrf)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export interface OspfAreaInput {
  stub: boolean;
  /** Full desired network set — the agent diffs it against
   *  OSPFV2_ROUTER_AREA_NETWORK. */
  networks: string[];
}

export async function upsertOspfArea(
  vrf: string,
  areaId: string,
  input: OspfAreaInput,
): Promise<void> {
  await apiFetch(
    `/routing/ospf/instances/${encodeURIComponent(vrf)}/areas/${encodeURIComponent(areaId)}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export async function deleteOspfArea(vrf: string, areaId: string): Promise<void> {
  await apiFetch(
    `/routing/ospf/instances/${encodeURIComponent(vrf)}/areas/${encodeURIComponent(areaId)}`,
    { method: "DELETE" },
  );
}

/** `area: null` removes the interface from OSPF. */
export interface OspfInterfaceInput {
  area: string | null;
  cost?: number | null;
  hello_interval?: number | null;
  dead_interval?: number | null;
  network_type?: "broadcast" | "point-to-point" | null;
  passive: boolean;
  bfd: boolean;
}

export async function updateOspfInterface(name: string, input: OspfInterfaceInput): Promise<void> {
  await apiFetch(`/routing/ospf/interfaces/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
