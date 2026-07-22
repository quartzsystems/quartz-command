// Data layer for IGMP snooping on QuartzSONiC switches, fetched live through
// the device proxy against the agent's management API (quartz-sonic
// src/mgmtapi.rs). Community SONiC never merged L2 multicast snooping, so on
// community images the capability envelope reports unsupported and the lists
// are empty; on Enterprise SONiC the agent maps the vendor's snooping tables
// (CFG_L2MC_TABLE-style config plus learned group state) into these shapes.
// Keep these shapes in step with quartz-sonic — the agent is the source of
// truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

export interface IgmpSnoopingVlan {
  vlan_id: number;
  enabled: boolean;
  /** Whether this switch acts as IGMP querier on the VLAN. */
  querier: boolean;
  fast_leave: boolean;
  /** IGMP version 1–3; null means the image default. */
  version: number | null;
  /** Seconds; null means the image default. */
  query_interval: number | null;
  last_member_query_interval: number | null;
  query_max_response_time: number | null;
}

export interface IgmpGroup {
  vlan_id: number;
  group_address: string;
  /** Source address for SSM (v3) entries; null for *,G groups. */
  source_address: string | null;
  /** Member ports the group is forwarded to. */
  ports: string[];
  /** "dynamic" (learned) or "static" (configured). */
  origin: "dynamic" | "static";
}

export interface IgmpSnoopingDoc {
  capability: FeatureCapability;
  vlans: IgmpSnoopingVlan[];
  /** Learned/static multicast groups across all snooping VLANs. */
  groups: IgmpGroup[];
}

export async function fetchIgmpSnooping(): Promise<IgmpSnoopingDoc> {
  return apiFetch<IgmpSnoopingDoc>("/switching/igmp-snooping");
}

export interface IgmpSnoopingVlanInput {
  enabled: boolean;
  querier: boolean;
  fast_leave: boolean;
  version?: number | null;
  query_interval?: number | null;
  last_member_query_interval?: number | null;
  query_max_response_time?: number | null;
}

export async function updateIgmpSnoopingVlan(
  vlanId: number,
  input: IgmpSnoopingVlanInput,
): Promise<void> {
  await apiFetch(`/switching/igmp-snooping/vlans/${vlanId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
