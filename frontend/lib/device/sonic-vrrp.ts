// Data layer for VRRP on QuartzSONiC switches. Like MCLAG, VRRP lives in the
// sub-organization's High Availability section — a virtual router is defined
// across a pair of switches — so reads fan out across the sub-org
// (GET /api/ha/vrrp on every switch) and writes go to each member of the
// pair explicitly via deviceApiFetch. Backed by the VRRP CONFIG_DB table on
// Enterprise SONiC images (community builds without vrrpd report
// supported:false). Keep these shapes in step with quartz-sonic — the agent
// is the source of truth for the contract.

import { deviceApiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

/** One VRRP group on one switch. Identity = (interface, vrid). */
export interface VrrpGroup {
  /** L3 interface carrying the group — normally a VLAN SVI, e.g. "Vlan10". */
  interface: string;
  vrid: number;
  /** Virtual addresses owned by the group. */
  virtual_ips: string[];
  /** 1–254; the higher-priority switch is the intended master. */
  priority: number;
  preempt: boolean;
  /** Advertisement interval in ms; null = protocol default (1000). */
  adv_interval_ms: number | null;
  /** VRRP protocol version; null = image default. */
  version: 2 | 3 | null;
  /** Live role; null when the daemon reports nothing. */
  state: "master" | "backup" | "init" | null;
}

export interface VrrpDoc {
  capability: FeatureCapability;
  groups: VrrpGroup[];
}

export async function fetchVrrp(orgGuid: string, deviceId: string): Promise<VrrpDoc> {
  return deviceApiFetch<VrrpDoc>(orgGuid, deviceId, "/ha/vrrp");
}

/** Upsert payload — a group minus its live state. */
export type VrrpGroupInput = Omit<VrrpGroup, "state">;

export async function updateVrrpGroup(
  orgGuid: string,
  deviceId: string,
  group: VrrpGroupInput,
): Promise<void> {
  await deviceApiFetch(
    orgGuid,
    deviceId,
    `/ha/vrrp/${encodeURIComponent(group.interface)}/${group.vrid}`,
    { method: "PUT", body: JSON.stringify(group) },
  );
}

export async function deleteVrrpGroup(
  orgGuid: string,
  deviceId: string,
  iface: string,
  vrid: number,
): Promise<void> {
  await deviceApiFetch(orgGuid, deviceId, `/ha/vrrp/${encodeURIComponent(iface)}/${vrid}`, {
    method: "DELETE",
  });
}
