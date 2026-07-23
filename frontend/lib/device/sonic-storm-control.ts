// Data layer for per-port storm control on QuartzSONiC switches, fetched
// live through the device proxy against the agent's management API
// (quartz-sonic src/mgmtapi.rs). Backed by the CONFIG_DB PORT_STORM_CONTROL
// table (key `port|{broadcast,unknown-unicast,unknown-multicast}`, field
// `kbps`). Keep these shapes in step with quartz-sonic — the agent is the
// source of truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

export interface StormControlPort {
  /** Front-panel port name, e.g. "Ethernet0". */
  port: string;
  /** Front-panel alias from CONFIG_DB, e.g. "Eth1/1". */
  alias: string | null;
  /** kbps limits; null = no limit configured for that traffic class. */
  broadcast_kbps: number | null;
  unknown_unicast_kbps: number | null;
  unknown_multicast_kbps: number | null;
}

export interface StormControlDoc {
  capability: FeatureCapability;
  /** Every front-panel port, whether or not it has limits. */
  ports: StormControlPort[];
}

export async function fetchStormControl(): Promise<StormControlDoc> {
  return apiFetch<StormControlDoc>("/switching/storm-control");
}

/** Full desired limits for one port; null clears that traffic class's row. */
export interface StormControlInput {
  broadcast_kbps: number | null;
  unknown_unicast_kbps: number | null;
  unknown_multicast_kbps: number | null;
}

export async function updateStormControl(
  port: string,
  input: StormControlInput,
): Promise<void> {
  await apiFetch(`/switching/storm-control/${encodeURIComponent(port)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
