// Data layer for AAA (login authentication + TACACS+ / RADIUS servers) on
// QuartzSONiC switches, fetched live through the device proxy against the
// agent's management API (quartz-sonic src/mgmtapi.rs). The agent maps
// these onto the AAA, TACPLUS / TACPLUS_SERVER, and RADIUS / RADIUS_SERVER
// CONFIG_DB tables (hostcfgd rewrites PAM/NSS from them). Shared secrets
// are write-only: the doc only ever reports whether one is set. Keep these
// shapes in step with quartz-sonic — the agent is the source of truth for
// the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

/** PAM login sources, tried in order. */
export type AaaMethod = "local" | "tacacs+" | "radius";
export type AaaAuthType = "pap" | "chap" | "mschapv2" | "login";
export type AaaProtocol = "tacacs" | "radius";

export interface AaaServer {
  /** IP or hostname; identity of the row. */
  address: string;
  /** Lower tried first; null = SONiC default (1). */
  priority: number | null;
  /** TCP 49 (TACACS+) / UDP 1812 (RADIUS) when null. */
  port: number | null;
  /** Seconds; null = global timeout. */
  timeout: number | null;
  /** True when a per-server secret overrides the global one. */
  key_set: boolean;
}

export interface AaaProtocolConfig {
  auth_type: AaaAuthType;
  /** Global timeout seconds; null = SONiC default (5). */
  timeout: number | null;
  /** True when a global shared secret is configured. */
  global_key_set: boolean;
  servers: AaaServer[];
}

export interface AaaDoc {
  capability: FeatureCapability;
  /** Login order, e.g. ["tacacs+", "local"]. */
  login_order: AaaMethod[];
  /** Try the next method after a reject (not just on server unreachable). */
  failthrough: boolean;
  tacacs: AaaProtocolConfig;
  radius: AaaProtocolConfig;
}

export async function fetchAaa(): Promise<AaaDoc> {
  return apiFetch<AaaDoc>("/security/aaa");
}

/** Always keep "local" somewhere in the order or a dead TACACS+ server can
 *  lock everyone out — the agent enforces this too. */
export async function updateAaaAuthentication(
  login_order: AaaMethod[],
  failthrough: boolean,
): Promise<void> {
  await apiFetch("/security/aaa/authentication", {
    method: "PUT",
    body: JSON.stringify({ login_order, failthrough }),
  });
}

export interface AaaProtocolInput {
  auth_type: AaaAuthType;
  timeout: number | null;
  /** Global shared secret; null = leave unchanged, "" = clear. */
  key: string | null;
}

export async function updateAaaProtocol(
  protocol: AaaProtocol,
  input: AaaProtocolInput,
): Promise<void> {
  await apiFetch(`/security/aaa/${protocol}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export interface AaaServerInput {
  priority: number | null;
  port: number | null;
  timeout: number | null;
  /** Per-server secret; null = leave unchanged, "" = clear override. */
  key: string | null;
}

export async function createAaaServer(
  protocol: AaaProtocol,
  address: string,
  input: AaaServerInput,
): Promise<void> {
  await apiFetch(`/security/aaa/${protocol}/servers`, {
    method: "POST",
    body: JSON.stringify({ address, ...input }),
  });
}

export async function updateAaaServer(
  protocol: AaaProtocol,
  address: string,
  input: AaaServerInput,
): Promise<void> {
  await apiFetch(
    `/security/aaa/${protocol}/servers/${encodeURIComponent(address)}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export async function deleteAaaServer(
  protocol: AaaProtocol,
  address: string,
): Promise<void> {
  await apiFetch(
    `/security/aaa/${protocol}/servers/${encodeURIComponent(address)}`,
    { method: "DELETE" },
  );
}
