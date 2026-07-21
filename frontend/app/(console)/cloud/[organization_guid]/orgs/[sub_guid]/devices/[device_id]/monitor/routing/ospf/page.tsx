"use client";

import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import { OspfStatusPanel } from "@/components/monitor/status/OspfStatusPanel";

export default function Page() {
  return (
    <MonitorPageShell title="OSPF" subtitle="Live OSPFv2 adjacencies for this firewall">
      <OspfStatusPanel />
    </MonitorPageShell>
  );
}
