// Data layer for spanning tree and loop protection on QuartzSONiC switches,
// fetched live through the device proxy against the agent's management API
// (quartz-sonic src/mgmtapi.rs). The agent assembles these documents from
// CONFIG_DB (STP / STP_VLAN / STP_PORT / STP_VLAN_PORT and the STP_MST*
// tables on MSTP-capable images) and APPL_DB (STP_VLAN_TABLE /
// STP_VLAN_PORT_TABLE / STP_PORT_TABLE operational state written by stpd).
// Keep these shapes in step with quartz-sonic — the agent is the source of
// truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

// ── Spanning tree ───────────────────────────────────────────────────────────

export type StpMode = "pvst" | "mst" | "disabled";

export type StpPortState =
  | "forwarding"
  | "blocking"
  | "learning"
  | "listening"
  | "disabled";

export interface StpGlobal {
  mode: StpMode;
  /** Seconds a root-guard violation holds the port (5–600). */
  rootguard_timeout: number;
  /** Bridge timers; VLAN-level values override these. */
  forward_delay: number;
  hello_time: number;
  max_age: number;
  /** Bridge priority, 0–61440 in steps of 4096. */
  priority: number;
  /** MST region settings; null unless the image supports MSTP. */
  region_name: string | null;
  revision: number | null;
  max_hops: number | null;
}

export interface StpVlan {
  vlan_id: number;
  enabled: boolean;
  /** Per-VLAN overrides; null means "use the global value". */
  priority: number | null;
  forward_delay: number | null;
  hello_time: number | null;
  max_age: number | null;
  // Operational state from APPL_DB STP_VLAN_TABLE; null while the
  // instance hasn't converged or STP is disabled.
  bridge_id: string | null;
  root_bridge_id: string | null;
  /** True when this switch is the root bridge for the VLAN. */
  is_root: boolean | null;
  root_port: string | null;
  root_path_cost: number | null;
  topology_change_count: number | null;
  /** Seconds since the last topology change. */
  last_topology_change_secs: number | null;
}

export interface StpPort {
  /** Port or port-channel name. */
  name: string;
  enabled: boolean;
  /** 0–240 in steps of 16; null means default (128). */
  priority: number | null;
  /** 1–200000000; null means auto from link speed. */
  path_cost: number | null;
  portfast: boolean;
  uplink_fast: boolean;
  /** MST-only knobs; null on PVST-only images. */
  edge_port: boolean | null;
  link_type: "auto" | "point-to-point" | "shared" | null;
  bpdu_guard: boolean;
  /** Whether a BPDU-guard violation admin-shuts the port. */
  bpdu_guard_do_disable: boolean;
  root_guard: boolean;
  // Operational state from APPL_DB.
  /** Worst state across the port's VLAN instances. */
  state: StpPortState | null;
  bpdu_guard_shutdown: boolean | null;
  bpdu_sent: number | null;
  bpdu_received: number | null;
}

export interface StpDoc {
  capability: FeatureCapability;
  /** Modes the image can run, e.g. ["pvst"] on community 202505. */
  modes_supported: StpMode[];
  global: StpGlobal | null;
  vlans: StpVlan[];
  ports: StpPort[];
}

export async function fetchStp(): Promise<StpDoc> {
  return apiFetch<StpDoc>("/switching/spanning-tree");
}

export interface StpGlobalInput {
  mode: StpMode;
  rootguard_timeout?: number;
  forward_delay?: number;
  hello_time?: number;
  max_age?: number;
  priority?: number;
  region_name?: string | null;
  revision?: number | null;
  max_hops?: number | null;
}

export async function updateStpGlobal(input: StpGlobalInput): Promise<void> {
  await apiFetch("/switching/spanning-tree/global", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Null override fields fall back to the global bridge values. */
export interface StpVlanInput {
  enabled: boolean;
  priority?: number | null;
  forward_delay?: number | null;
  hello_time?: number | null;
  max_age?: number | null;
}

export async function updateStpVlan(vlanId: number, input: StpVlanInput): Promise<void> {
  await apiFetch(`/switching/spanning-tree/vlans/${vlanId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export interface StpPortInput {
  enabled: boolean;
  priority?: number | null;
  path_cost?: number | null;
  portfast?: boolean;
  uplink_fast?: boolean;
  edge_port?: boolean | null;
  link_type?: "auto" | "point-to-point" | "shared" | null;
  bpdu_guard?: boolean;
  bpdu_guard_do_disable?: boolean;
  root_guard?: boolean;
}

export async function updateStpPort(name: string, input: StpPortInput): Promise<void> {
  await apiFetch(`/switching/spanning-tree/ports/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

// ── Loop protection ─────────────────────────────────────────────────────────
// Community SONiC has no standalone loopback-detection daemon; loop
// protection is STP's per-port BPDU guard + root guard, plus recovery of
// ports that BPDU guard admin-shut (APPL_DB STP_PORT_TABLE
// bpdu_guard_shutdown → the agent re-enables the port in CONFIG_DB PORT).

export interface LoopProtectionPort {
  name: string;
  stp_enabled: boolean;
  bpdu_guard: boolean;
  bpdu_guard_do_disable: boolean;
  root_guard: boolean;
  // Operational state.
  /** True when BPDU guard has admin-shut the port; recover to clear. */
  bpdu_guard_shutdown: boolean | null;
  /** True while root guard is actively blocking the port. */
  root_guard_active: boolean | null;
}

export interface LoopProtectionDoc {
  capability: FeatureCapability;
  ports: LoopProtectionPort[];
}

export async function fetchLoopProtection(): Promise<LoopProtectionDoc> {
  return apiFetch<LoopProtectionDoc>("/switching/loop-protection");
}

export interface LoopProtectionPortInput {
  bpdu_guard: boolean;
  bpdu_guard_do_disable: boolean;
  root_guard: boolean;
}

export async function updateLoopProtectionPort(
  name: string,
  input: LoopProtectionPortInput,
): Promise<void> {
  await apiFetch(`/switching/loop-protection/ports/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Re-enable a port that BPDU guard admin-shut. */
export async function recoverLoopProtectionPort(name: string): Promise<void> {
  await apiFetch(`/switching/loop-protection/ports/${encodeURIComponent(name)}/recover`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
