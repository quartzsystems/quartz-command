"use client";

import { useParams } from "next/navigation";
import { useCloudOrg } from "@/components/CloudShell";

/// The routed device's product line, for pages whose URL segment is shared
/// between products (e.g. /configure/routing/bgp serves both the QuartzFire
/// and QuartzSONiC editors). Returns null until the org device list has
/// loaded so callers can render nothing instead of flashing the wrong
/// product's page — the same rule DeviceConfigNav uses.
export function useDeviceProduct(): string | null {
  const params = useParams<{ device_id: string }>();
  const { devices } = useCloudOrg();
  if (devices === null) return null;
  return devices.find((d) => d.device_id === params.device_id)?.product ?? "";
}
