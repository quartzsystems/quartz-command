// Data layer for port mirroring (SPAN/ERSPAN) on QuartzSONiC switches,
// fetched live through the device proxy against the agent's management API
// (quartz-sonic src/mgmtapi.rs). Backed by the CONFIG_DB MIRROR_SESSION
// table (SPAN sessions need a 202012+ image; ERSPAN is older) with the
// session's operational status from STATE_DB MIRROR_SESSION_TABLE. Keep
// these shapes in step with quartz-sonic — the agent is the source of truth
// for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

export type MirrorDirection = "rx" | "tx" | "both";

export interface ErspanParams {
  /** Local tunnel source, e.g. the switch's loopback or SVI address. */
  src_ip: string;
  /** Remote collector/analyzer address the GRE tunnel targets. */
  dst_ip: string;
  /** GRE protocol type, e.g. "0x88be"; null = image default. */
  gre_type: string | null;
  dscp: number | null;
  ttl: number | null;
  /** Egress queue for mirrored traffic; null = image default. */
  queue: number | null;
}

export interface MirrorSession {
  name: string;
  type: "span" | "erspan";
  /** Ports (or port channels) whose traffic is copied. */
  source_ports: string[];
  direction: MirrorDirection;
  /** SPAN only: the local analyzer port the copies egress. */
  dst_port: string | null;
  /** ERSPAN only. */
  erspan: ErspanParams | null;
  /** Operational status from STATE_DB; null when the state entry is absent. */
  status: "active" | "inactive" | null;
}

export interface MirrorSessionDoc {
  capability: FeatureCapability;
  sessions: MirrorSession[];
}

export async function fetchMirrorSessions(): Promise<MirrorSessionDoc> {
  return apiFetch<MirrorSessionDoc>("/switching/mirror-sessions");
}

/** Upsert payload — the whole desired session (status is agent-derived and
 *  ignored on write). */
export interface MirrorSessionInput {
  type: "span" | "erspan";
  source_ports: string[];
  direction: MirrorDirection;
  dst_port: string | null;
  erspan: ErspanParams | null;
}

export async function updateMirrorSession(
  name: string,
  input: MirrorSessionInput,
): Promise<void> {
  await apiFetch(`/switching/mirror-sessions/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteMirrorSession(name: string): Promise<void> {
  await apiFetch(`/switching/mirror-sessions/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}
