// Data layer for L3 interfaces and VRFs on QuartzSONiC switches, fetched
// live through the device proxy against the agent's management API
// (quartz-sonic src/mgmtapi.rs). The agent assembles these documents from
// CONFIG_DB (INTERFACE / VLAN_INTERFACE / PORTCHANNEL_INTERFACE /
// LOOPBACK_INTERFACE two-level keys for IP assignment, VRF,
// MGMT_VRF_CONFIG) and STATE_DB oper status. Keep these shapes in step with
// quartz-sonic — the agent is the source of truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

// ── L3 interfaces ───────────────────────────────────────────────────────────

export type L3InterfaceKind = "port" | "port-channel" | "vlan" | "loopback";

export interface L3Interface {
  /** SONiC name: "Ethernet0", "PortChannel0001", "Vlan10", "Loopback0". */
  name: string;
  kind: L3InterfaceKind;
  /** Bound VRF; null = default VRF. */
  vrf: string | null;
  /** IPv4/IPv6 CIDR assignments, e.g. "10.0.0.1/31", "fc00::1/126". */
  ip_addresses: string[];
  admin_status: "up" | "down";
  oper_status: "up" | "down" | "unknown";
  description: string | null;
}

export interface L3InterfacesDoc {
  capability: FeatureCapability;
  interfaces: L3Interface[];
}

export async function fetchL3Interfaces(): Promise<L3InterfacesDoc> {
  return apiFetch<L3InterfacesDoc>("/routing/l3-interfaces");
}

/** `ip_addresses` is the full desired set — the agent diffs it against the
 *  interface's IP-keyed CONFIG_DB rows. Changing `vrf` requires the agent to
 *  re-create the IP rows under the new binding (SONiC rejects a VRF move
 *  while addresses exist, so the agent sequences remove → rebind → re-add). */
export interface L3InterfaceInput {
  vrf: string | null;
  ip_addresses: string[];
}

export async function updateL3Interface(name: string, input: L3InterfaceInput): Promise<void> {
  await apiFetch(`/routing/l3-interfaces/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Create a loopback interface (the only L3 interface kind created here —
 *  ports/port-channels/VLANs become L3 by assigning addresses). */
export async function createLoopback(name: string, input: L3InterfaceInput): Promise<void> {
  await apiFetch("/routing/l3-interfaces", {
    method: "POST",
    body: JSON.stringify({ name, ...input }),
  });
}

/** Delete a loopback; for other kinds clear addresses via update instead. */
export async function deleteLoopback(name: string): Promise<void> {
  await apiFetch(`/routing/l3-interfaces/${encodeURIComponent(name)}`, { method: "DELETE" });
}

// ── VRFs ────────────────────────────────────────────────────────────────────

export interface Vrf {
  /** SONiC requires data VRF names to start with "Vrf". */
  name: string;
  /** Fall back to the default VRF's routes on lookup miss. */
  fallback: boolean;
  /** L3VNI for EVPN; null when unset. */
  vni: number | null;
  /** Interfaces currently bound to this VRF. */
  interfaces: string[];
}

export interface VrfsDoc {
  capability: FeatureCapability;
  vrfs: Vrf[];
  mgmt_vrf_enabled: boolean;
}

export async function fetchVrfs(): Promise<VrfsDoc> {
  return apiFetch<VrfsDoc>("/routing/vrfs");
}

export interface VrfInput {
  fallback: boolean;
  vni?: number | null;
}

export async function createVrf(name: string, input: VrfInput): Promise<void> {
  await apiFetch("/routing/vrfs", {
    method: "POST",
    body: JSON.stringify({ name, ...input }),
  });
}

export async function updateVrf(name: string, input: VrfInput): Promise<void> {
  await apiFetch(`/routing/vrfs/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Rejected while interfaces are still bound to the VRF. */
export async function deleteVrf(name: string): Promise<void> {
  await apiFetch(`/routing/vrfs/${encodeURIComponent(name)}`, { method: "DELETE" });
}

/** Toggle the management VRF (MGMT_VRF_CONFIG). Restarts management
 *  services on the switch — the agent applies it via the config CLI. */
export async function setMgmtVrf(enabled: boolean): Promise<void> {
  await apiFetch("/routing/vrfs/mgmt", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}
