// Data layer for LLDP on QuartzSONiC switches, fetched live through the
// device proxy against the agent's management API (quartz-sonic
// src/mgmtapi.rs). Neighbors and local chassis facts come from APPL_DB
// (LLDP_ENTRY_TABLE / LLDP_LOC_CHASSIS, written by lldp_syncd); the enable
// switch is the FEATURE|lldp table. Community SONiC's lldpmgrd ignores the
// LLDP/LLDP_PORT CONFIG_DB tables, so timers and per-port modes are only
// configurable on images whose management stack consumes them — the
// capability envelope says which. Keep these shapes in step with
// quartz-sonic — the agent is the source of truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

export interface LldpConfig {
  /** FEATURE table state — whether the lldp container runs at all. */
  enabled: boolean;
  /** Transmit interval in seconds (5–254); null when the image doesn't
   *  expose it. */
  hello_time: number | null;
  /** TTL multiplier (1–10); null when not exposed. */
  multiplier: number | null;
  /** Advertised system name; on community SONiC this follows the switch
   *  hostname and is read-only here. */
  system_name: string | null;
  /** True when timers/system-name are actually configurable on this image. */
  timers_supported: boolean;
}

export interface LldpLocalChassis {
  chassis_id: string | null;
  system_name: string | null;
  system_description: string | null;
  mgmt_addresses: string[];
}

export interface LldpNeighbor {
  /** Local interface the neighbor was heard on. */
  local_port: string;
  remote_system_name: string | null;
  remote_port_id: string | null;
  remote_port_description: string | null;
  remote_chassis_id: string | null;
  remote_system_description: string | null;
  remote_mgmt_addresses: string[];
  /** Enabled capability letters as decoded by the agent, e.g.
   *  ["Bridge", "Router"]. */
  capabilities: string[];
}

export interface LldpDoc {
  capability: FeatureCapability;
  config: LldpConfig;
  local: LldpLocalChassis | null;
  neighbors: LldpNeighbor[];
}

export async function fetchLldp(): Promise<LldpDoc> {
  return apiFetch<LldpDoc>("/switching/lldp");
}

/** Timer/system-name fields are rejected by the agent when
 *  `timers_supported` is false. */
export interface LldpConfigInput {
  enabled: boolean;
  hello_time?: number | null;
  multiplier?: number | null;
  system_name?: string | null;
}

export async function updateLldpConfig(input: LldpConfigInput): Promise<void> {
  await apiFetch("/switching/lldp/config", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
