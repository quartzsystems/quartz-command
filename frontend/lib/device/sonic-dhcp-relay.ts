// Data layer for DHCP relay on QuartzSONiC switches, fetched live through
// the device proxy against the agent's management API (quartz-sonic
// src/mgmtapi.rs). Backed by the per-VLAN `dhcp_servers` list (CONFIG_DB
// VLAN table) consumed by the dhcp_relay container — the same field the
// VLAN editor writes as `dhcp_helpers`; this page is the relay-centric
// overview of it. Keep these shapes in step with quartz-sonic — the agent
// is the source of truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

export interface DhcpRelayVlan {
  vlan_id: number;
  description: string | null;
  /** SVI addresses (VLAN_INTERFACE), CIDR strings. Relay only functions on
   *  VLANs with an SVI — the UI flags helper lists on SVI-less VLANs. */
  ip_addresses: string[];
  /** DHCP server addresses relayed to (the VLAN's dhcp_servers list). */
  servers: string[];
}

export interface DhcpRelayDoc {
  capability: FeatureCapability;
  /** Every configured VLAN, whether or not it relays. */
  vlans: DhcpRelayVlan[];
}

export async function fetchDhcpRelay(): Promise<DhcpRelayDoc> {
  return apiFetch<DhcpRelayDoc>("/routing/dhcp-relay");
}

/** `servers` is the full desired set for the VLAN — the agent diffs it
 *  against the VLAN's dhcp_servers list. */
export async function updateDhcpRelay(vlanId: number, servers: string[]): Promise<void> {
  await apiFetch(`/routing/dhcp-relay/${vlanId}`, {
    method: "PUT",
    body: JSON.stringify({ servers }),
  });
}
