// Data layer for static routes on QuartzSONiC switches, fetched live
// through the device proxy against the agent's management API (quartz-sonic
// src/mgmtapi.rs). The agent maps these documents onto the STATIC_ROUTE
// CONFIG_DB table (key "vrf|prefix", parallel comma-separated nexthop /
// ifname / distance / blackhole fields) which bgpcfgd renders into FRR
// staticd config. Keep these shapes in step with quartz-sonic — the agent is
// the source of truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

/** One way to reach the prefix. Exactly one of gateway / interface /
 *  blackhole must be set (gateway + interface together is also valid —
 *  "via this IP out this port"). */
export interface StaticNextHop {
  /** Next-hop IP, e.g. "10.0.0.1" or "fc00::1". */
  gateway: string | null;
  /** Egress interface, e.g. "Ethernet0", "Vlan10", "PortChannel0001". */
  interface: string | null;
  /** Resolve the gateway in this VRF instead (route leaking); null = same
   *  VRF as the route. */
  nexthop_vrf: string | null;
  /** Discard traffic to the prefix. */
  blackhole: boolean;
  /** Administrative distance 1-255; null = FRR default (1). */
  distance: number | null;
}

/** All next hops for one prefix in one VRF (one STATIC_ROUTE row). */
export interface StaticRoute {
  /** Owning VRF; null = default VRF. */
  vrf: string | null;
  /** Destination CIDR, e.g. "0.0.0.0/0", "10.20.0.0/16", "fc00::/64". */
  prefix: string;
  next_hops: StaticNextHop[];
}

export interface StaticRoutesDoc {
  capability: FeatureCapability;
  routes: StaticRoute[];
}

export async function fetchStaticRoutes(): Promise<StaticRoutesDoc> {
  return apiFetch<StaticRoutesDoc>("/routing/static-routes");
}

/** Upsert the full next-hop set for (vrf, prefix) — the agent replaces the
 *  STATIC_ROUTE row wholesale. The prefix travels in the body (not the URL)
 *  because it contains a slash. */
export async function putStaticRoute(route: StaticRoute): Promise<void> {
  await apiFetch("/routing/static-routes", {
    method: "PUT",
    body: JSON.stringify(route),
  });
}

/** Delete the (vrf, prefix) row. POST-with-body for the same slash-in-prefix
 *  reason as putStaticRoute. */
export async function deleteStaticRoute(vrf: string | null, prefix: string): Promise<void> {
  await apiFetch("/routing/static-routes/delete", {
    method: "POST",
    body: JSON.stringify({ vrf, prefix }),
  });
}

export function emptyNextHop(): StaticNextHop {
  return { gateway: null, interface: null, nexthop_vrf: null, blackhole: false, distance: null };
}

/** Stable row identity for tables/updates. */
export function staticRouteKey(r: { vrf: string | null; prefix: string }): string {
  return `${r.vrf ?? "default"}|${r.prefix}`;
}
