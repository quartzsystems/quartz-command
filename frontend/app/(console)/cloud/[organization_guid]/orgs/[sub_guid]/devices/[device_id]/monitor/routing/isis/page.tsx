"use client";

import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import { IsisStatusPanel } from "@/components/monitor/status/IsisStatusPanel";

export default function Page() {
  return (
    <MonitorPageShell title="IS-IS" subtitle="Live IS-IS adjacencies for this firewall">
      <IsisStatusPanel />
    </MonitorPageShell>
  );
}
