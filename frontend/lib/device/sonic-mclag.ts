// Data layer for MCLAG on QuartzSONiC switches. MCLAG is configured from the
// sub-organization's High Availability section — a domain only makes sense
// across a pair of switches — so reads fan out across the sub-org
// (GET /api/ha/mclag on every switch) and writes go to each member of the
// pair explicitly via deviceApiFetch. Backed by CONFIG_DB MCLAG_DOMAIN /
// MCLAG_INTERFACE (iccpd), oper state from STATE_DB/iccpd the way
// `mclagdctl dump state` reports it. Keep these shapes in step with
// quartz-sonic — the agent is the source of truth for the contract.

import { deviceApiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

/** The switch's MCLAG domain config (SONiC supports one domain per switch). */
export interface MclagDomain {
  domain_id: number;
  /** This switch's keepalive source address. */
  source_ip: string;
  /** The paired switch's keepalive address. */
  peer_ip: string;
  /** Port channel carrying the peer link; null when unset. */
  peer_link: string | null;
  /** Keepalive interval in seconds; null = image default (1). */
  keepalive_interval_s: number | null;
  /** Session timeout in seconds; null = image default (15). */
  session_timeout_s: number | null;
  /** Shared MCLAG system MAC; null = unset. */
  system_mac: string | null;
  /** Port channels enslaved to the domain (MCLAG_INTERFACE). */
  members: string[];
}

export interface MclagMemberState {
  name: string;
  local_status: "up" | "down" | "unknown";
  remote_status: "up" | "down" | "unknown";
}

/** Live iccpd state; null fields when the daemon reports nothing. */
export interface MclagState {
  session_status: "up" | "down" | null;
  role: "active" | "standby" | null;
  peer_link_status: "up" | "down" | null;
  members: MclagMemberState[];
}

export interface MclagDoc {
  capability: FeatureCapability;
  /** null = MCLAG not configured on this switch. */
  domain: MclagDomain | null;
  /** null when no domain is configured or iccpd isn't running. */
  state: MclagState | null;
}

export async function fetchMclag(orgGuid: string, deviceId: string): Promise<MclagDoc> {
  return deviceApiFetch<MclagDoc>(orgGuid, deviceId, "/ha/mclag");
}

/** Upsert the switch's whole MCLAG domain. The HA page writes the mirrored
 *  object (source/peer IPs swapped) to each switch of the pair. */
export async function updateMclag(
  orgGuid: string,
  deviceId: string,
  domain: MclagDomain,
): Promise<void> {
  await deviceApiFetch(orgGuid, deviceId, "/ha/mclag", {
    method: "PUT",
    body: JSON.stringify(domain),
  });
}

/** Remove the domain and all MCLAG_INTERFACE rows from one switch. */
export async function deleteMclag(orgGuid: string, deviceId: string): Promise<void> {
  await deviceApiFetch(orgGuid, deviceId, "/ha/mclag", { method: "DELETE" });
}
