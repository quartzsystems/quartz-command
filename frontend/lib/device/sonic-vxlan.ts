// Data layer for VXLAN / EVPN on QuartzSONiC switches, fetched live through
// the device proxy against the agent's management API (quartz-sonic
// src/mgmtapi.rs). Config side: the switch's single VTEP (CONFIG_DB
// VXLAN_TUNNEL), the EVPN NVO binding (EVPN_NVO), and the VLAN↔VNI map
// (VXLAN_TUNNEL_MAP). Status side: remote VTEPs and tunnel oper state from
// STATE_DB / APP_DB as EVPN learns them. Keep these shapes in step with
// quartz-sonic — the agent is the source of truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

export interface VxlanVtep {
  /** VXLAN_TUNNEL key, e.g. "vtep1". SONiC supports one VTEP per switch. */
  name: string;
  /** Tunnel source, normally a loopback address. */
  source_ip: string;
}

export interface VlanVniMap {
  vlan_id: number;
  vni: number;
}

export interface VxlanDoc {
  capability: FeatureCapability;
  /** null = no VTEP configured. */
  vtep: VxlanVtep | null;
  /** True when an EVPN_NVO row binds the VTEP to BGP EVPN. */
  evpn_nvo: boolean;
  vlan_vni_maps: VlanVniMap[];
}

export async function fetchVxlan(): Promise<VxlanDoc> {
  return apiFetch<VxlanDoc>("/routing/vxlan");
}

/** Upsert the switch's VTEP (and its EVPN NVO binding) in one write. */
export async function updateVtep(input: {
  name: string;
  source_ip: string;
  evpn_nvo: boolean;
}): Promise<void> {
  await apiFetch("/routing/vxlan/vtep", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Remove the VTEP entirely — rejected while VLAN↔VNI maps still exist. */
export async function deleteVtep(): Promise<void> {
  await apiFetch("/routing/vxlan/vtep", { method: "DELETE" });
}

/** Full desired VLAN↔VNI set — the agent diffs against VXLAN_TUNNEL_MAP. */
export async function updateVlanVniMaps(maps: VlanVniMap[]): Promise<void> {
  await apiFetch("/routing/vxlan/maps", {
    method: "PUT",
    body: JSON.stringify({ maps }),
  });
}

// ── Live overlay state (Monitor) ────────────────────────────────────────────

export interface RemoteVtep {
  /** Remote tunnel endpoint address. */
  ip: string;
  oper_status: "up" | "down" | "unknown";
  /** How the VTEP was learned. */
  source: "evpn" | "static" | "unknown";
  /** VNIs carried toward this VTEP, when the image reports them. */
  vnis: number[];
}

export interface VxlanStatusDoc {
  capability: FeatureCapability;
  /** The local VTEP as configured; null when VXLAN is unconfigured. */
  vtep: VxlanVtep | null;
  remote_vteps: RemoteVtep[];
  /** VLAN↔VNI maps with their kernel/ASIC programming state. */
  mappings: {
    vlan_id: number;
    vni: number;
    oper_status: "up" | "down" | "unknown";
  }[];
}

export async function fetchVxlanStatus(): Promise<VxlanStatusDoc> {
  return apiFetch<VxlanStatusDoc>("/routing/vxlan/status");
}
