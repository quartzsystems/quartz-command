// Data layer for sFlow on QuartzSONiC switches, fetched live through the
// device proxy against the agent's management API (quartz-sonic
// src/mgmtapi.rs). Backed by the CONFIG_DB SFLOW (global), SFLOW_COLLECTOR
// (at most two), and SFLOW_SESSION (per-port) tables consumed by hsflowd in
// the sflow container. Keep these shapes in step with quartz-sonic — the
// agent is the source of truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

export interface SflowCollector {
  /** CONFIG_DB collector name (row key). */
  name: string;
  /** IPv4/IPv6 address of the collector. */
  address: string;
  /** UDP port; null = default (6343). */
  port: number | null;
  /** null/"default" = front-panel routing; "mgmt" = management VRF. */
  vrf: "default" | "mgmt" | null;
}

export interface SflowPort {
  /** Front-panel port name, e.g. "Ethernet0". */
  name: string;
  alias: string | null;
  oper_status: "up" | "down" | "unknown";
  /** Per-port admin state (SFLOW_SESSION); sampling requires the global
   *  enable too. */
  enabled: boolean;
  /** 1-in-N packets; null = the speed-based image default. */
  sample_rate: number | null;
}

export interface SflowDoc {
  capability: FeatureCapability;
  enabled: boolean;
  /** Counter polling interval in seconds (0 disables polling); null = image
   *  default (20). */
  polling_interval: number | null;
  /** Interface whose address stamps datagrams as agent-id; null = auto. */
  agent_id: string | null;
  collectors: SflowCollector[];
  /** Every front-panel port with its session state. */
  ports: SflowPort[];
}

export async function fetchSflow(): Promise<SflowDoc> {
  return apiFetch<SflowDoc>("/switching/sflow");
}

/** Global settings + the full desired collector set (the agent diffs;
 *  SONiC allows at most two collectors). */
export interface SflowGlobalInput {
  enabled: boolean;
  polling_interval: number | null;
  agent_id: string | null;
  collectors: SflowCollector[];
}

export async function updateSflowGlobal(input: SflowGlobalInput): Promise<void> {
  await apiFetch("/switching/sflow", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function updateSflowPort(
  name: string,
  input: { enabled: boolean; sample_rate: number | null },
): Promise<void> {
  await apiFetch(`/switching/sflow/ports/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
