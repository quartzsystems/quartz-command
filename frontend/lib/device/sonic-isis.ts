// Data layer for IS-IS on QuartzSONiC switches, fetched live through the
// device proxy against the agent's management API (quartz-sonic
// src/mgmtapi.rs). Community SONiC has no IS-IS integration (isisd isn't
// even started in the FRR container), so on community images the capability
// envelope reports unsupported; on images that do run isisd the agent
// manages it through FRR (vtysh) and reads adjacency state from
// `show isis neighbor json`. Keep these shapes in step with quartz-sonic —
// the agent is the source of truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

export type IsisLevel = "level-1" | "level-2" | "level-1-2";

export interface IsisInstance {
  /** Network entity title, e.g. "49.0001.1921.6800.1001.00". */
  net: string | null;
  level: IsisLevel;
  /** Advertise the hostname in LSPs. */
  dynamic_hostname: boolean;
}

export interface IsisInterface {
  name: string;
  enabled: boolean;
  circuit_type: IsisLevel | null;
  metric: number | null;
  passive: boolean;
  point_to_point: boolean;
}

export interface IsisAdjacency {
  system_id: string;
  interface: string;
  level: string;
  /** FRR adjacency state, e.g. "Up", "Init". */
  state: string;
  holdtime_secs: number | null;
}

export interface IsisDoc {
  capability: FeatureCapability;
  /** Null when no IS-IS instance is configured. */
  instance: IsisInstance | null;
  interfaces: IsisInterface[];
  adjacencies: IsisAdjacency[];
}

export async function fetchIsisDoc(): Promise<IsisDoc> {
  return apiFetch<IsisDoc>("/routing/isis");
}

/** `net: null` removes the IS-IS instance. */
export interface IsisInstanceInput {
  net: string | null;
  level: IsisLevel;
  dynamic_hostname: boolean;
}

export async function updateIsisInstance(input: IsisInstanceInput): Promise<void> {
  await apiFetch("/routing/isis/instance", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export interface IsisInterfaceInput {
  enabled: boolean;
  circuit_type?: IsisLevel | null;
  metric?: number | null;
  passive: boolean;
  point_to_point: boolean;
}

export async function updateIsisInterface(name: string, input: IsisInterfaceInput): Promise<void> {
  await apiFetch(`/routing/isis/interfaces/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
