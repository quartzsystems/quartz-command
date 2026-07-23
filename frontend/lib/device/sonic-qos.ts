// Data layer for QoS classification (phase 1: trust mode + DSCP→TC maps) on
// QuartzSONiC switches, fetched live through the device proxy against the
// agent's management API (quartz-sonic src/mgmtapi.rs). Backed by CONFIG_DB
// DSCP_TO_TC_MAP objects and each port's PORT_QOS_MAP binding. Queues,
// scheduling, PFC, and ECN are a later phase. Keep these shapes in step with
// quartz-sonic — the agent is the source of truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

/** One DSCP→traffic-class map. Only explicitly mapped code points are
 *  listed; unlisted DSCPs fall to the image default (TC 0). */
export interface DscpTcMap {
  name: string;
  entries: { dscp: number; tc: number }[];
  /** Ports currently bound to this map (read-only, for delete guarding). */
  bound_ports: string[];
}

/** How a port classifies incoming traffic. "dscp" trusts the packet's DSCP
 *  through the bound map; "none" leaves everything in the default class.
 *  (dot1p trust arrives with a later QoS phase.) */
export type QosTrustMode = "dscp" | "none";

export interface QosPort {
  name: string;
  alias: string | null;
  trust: QosTrustMode;
  /** Bound DSCP→TC map; null when trust is "none". */
  dscp_to_tc_map: string | null;
}

export interface QosDoc {
  capability: FeatureCapability;
  dscp_tc_maps: DscpTcMap[];
  ports: QosPort[];
}

export async function fetchQos(): Promise<QosDoc> {
  return apiFetch<QosDoc>("/qos");
}

/** Upsert a map — `entries` is the full desired set for the map. */
export async function updateDscpMap(
  name: string,
  entries: { dscp: number; tc: number }[],
): Promise<void> {
  await apiFetch(`/qos/dscp-maps/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify({ entries }),
  });
}

/** Rejected while any port is still bound to the map. */
export async function deleteDscpMap(name: string): Promise<void> {
  await apiFetch(`/qos/dscp-maps/${encodeURIComponent(name)}`, { method: "DELETE" });
}

/** Set a port's trust mode and map binding. trust "dscp" requires a map;
 *  trust "none" clears the binding. */
export async function updatePortQos(
  port: string,
  input: { trust: QosTrustMode; dscp_to_tc_map: string | null },
): Promise<void> {
  await apiFetch(`/qos/ports/${encodeURIComponent(port)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
