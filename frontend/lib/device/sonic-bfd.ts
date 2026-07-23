// Data layer for BFD on QuartzSONiC switches, fetched live through the
// device proxy against the agent's management API (quartz-sonic
// src/mgmtapi.rs). Peers are programmed into FRR's bfdd (vtysh, like the
// routing-policy panels — community SONiC has no CONFIG_DB schema for BFD);
// session state comes from bfdd the same way `show bfd peers` reports it.
// Keep these shapes in step with quartz-sonic — the agent is the source of
// truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

/** One configured BFD peer. Identity = (peer, interface, vrf, multihop). */
export interface BfdPeer {
  /** Peer address, IPv4 or IPv6. */
  peer: string;
  /** Single-hop peers bind to an interface; null for multihop. */
  interface: string | null;
  /** Local source address; required for multihop, optional otherwise. */
  local_address: string | null;
  multihop: boolean;
  /** null = default VRF. */
  vrf: string | null;
  /** Desired minimum receive interval in ms; null = FRR default (300). */
  rx_interval_ms: number | null;
  /** Desired minimum transmit interval in ms; null = FRR default (300). */
  tx_interval_ms: number | null;
  /** Detection multiplier; null = FRR default (3). */
  multiplier: number | null;
  /** Passive peers wait for the remote side to open the session. */
  passive: boolean;
  /** Administratively shut down (configured but not running). */
  shutdown: boolean;
}

export interface BfdDoc {
  capability: FeatureCapability;
  peers: BfdPeer[];
}

export async function fetchBfd(): Promise<BfdDoc> {
  return apiFetch<BfdDoc>("/routing/bfd");
}

/** Upsert one peer — the whole desired peer object; the agent replaces the
 *  FRR peer block for its identity. */
export async function updateBfdPeer(peer: BfdPeer): Promise<void> {
  await apiFetch("/routing/bfd/peers", {
    method: "PUT",
    body: JSON.stringify(peer),
  });
}

/** POST-with-body delete (peer addresses aren't path-safe as identities —
 *  same pattern as static routes). */
export async function deleteBfdPeer(id: {
  peer: string;
  interface: string | null;
  vrf: string | null;
  multihop: boolean;
}): Promise<void> {
  await apiFetch("/routing/bfd/peers/delete", {
    method: "POST",
    body: JSON.stringify(id),
  });
}

// ── Live sessions (Monitor) ─────────────────────────────────────────────────

export type BfdSessionState = "up" | "down" | "init" | "admin_down";

/** One live bfdd session — includes sessions created dynamically by BGP/OSPF
 *  (`bfd profile`/`neighbor bfd`), not only the statically configured peers. */
export interface BfdSession {
  peer: string;
  local_address: string | null;
  interface: string | null;
  vrf: string | null;
  multihop: boolean;
  state: BfdSessionState;
  remote_state: BfdSessionState | null;
  /** Seconds in the current state; null when bfdd doesn't report it. */
  uptime_seconds: number | null;
  /** Negotiated intervals in ms. */
  rx_interval_ms: number | null;
  tx_interval_ms: number | null;
  multiplier: number | null;
  /** Last diagnostic, e.g. "control detection time expired"; null = none. */
  diagnostic: string | null;
  /** Protocols using the session, e.g. ["bgp"]; static peers report []. */
  clients: string[];
}

export interface BfdSessionsDoc {
  capability: FeatureCapability;
  sessions: BfdSession[];
}

export async function fetchBfdSessions(): Promise<BfdSessionsDoc> {
  return apiFetch<BfdSessionsDoc>("/routing/bfd/sessions");
}
