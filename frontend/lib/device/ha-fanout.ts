// Shared read transport for the sub-organization High Availability pages.
// MCLAG/VRRP documents are read from every QuartzSONiC switch in the sub-org
// through the existing read-only monitor fan-out (one console round-trip);
// the fan-out answers for every adopted device, so results are filtered to
// the switches the caller cares about. Writes never fan out — the HA pages
// write to each member of a pair explicitly via deviceApiFetch.

import type { Device } from "@/lib/api";
import { fanoutApi } from "@/lib/device/fanout";

/** One switch's slot in an HA aggregate: the sidebar device joined with its
 *  fanned-out feature document (null when offline or errored). */
export interface HaDeviceDoc<T> {
  device: Device;
  connected: boolean;
  doc: T | null;
  error?: string;
}

export async function fetchHaDocs<T>(
  orgGuid: string,
  subGuid: string,
  path: string,
  switches: Device[],
): Promise<HaDeviceDoc<T>[]> {
  const byId = new Map(switches.map((d) => [d.device_id, d]));
  const items = await fanoutApi<T>(orgGuid, subGuid, path);
  const out: HaDeviceDoc<T>[] = [];
  for (const item of items) {
    const device = byId.get(item.deviceId);
    if (!device) continue; // not a QuartzSONiC switch (firewalls answer 404)
    out.push({ device, connected: item.connected, doc: item.data, error: item.error });
  }
  // Switches the fan-out skipped entirely still get a row, shown as offline.
  for (const device of switches) {
    if (!out.some((o) => o.device.device_id === device.device_id)) {
      out.push({ device, connected: false, doc: null, error: "offline" });
    }
  }
  return out;
}

/** The sub-org's adopted QuartzSONiC switches — the only devices HA features
 *  apply to. */
export function sonicSwitches(devices: Device[] | null, subGuid: string): Device[] {
  return (devices ?? []).filter(
    (d) => d.sub_org_id === subGuid && d.product === "quartzsonic" && d.state === "adopted",
  );
}

export function switchLabel(d: Device): string {
  return (d.hostname ?? d.device_id).toUpperCase();
}
