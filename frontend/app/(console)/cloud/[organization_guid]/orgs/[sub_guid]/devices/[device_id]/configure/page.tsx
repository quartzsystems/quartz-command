"use client";

import { useParams } from "next/navigation";
import { useCloudOrg } from "@/components/CloudShell";
import { CloudSection } from "@/components/CloudSection";

export default function DeviceConfigurePage() {
  const { devices } = useCloudOrg();
  const params = useParams<{ device_id: string }>();
  const device = devices?.find((d) => d.device_id === params.device_id);
  const blurb =
    device?.product === "quartzsonic"
      ? "Pick a section on the left — Switching manages this QuartzSONiC switch's ports, port channels, and VLANs."
      : "Pick a section on the left — Interfaces, NAT, and Firewall mirror this QuartzFire's local UI.";
  return <CloudSection title="Configure" blurb={blurb} />;
}
