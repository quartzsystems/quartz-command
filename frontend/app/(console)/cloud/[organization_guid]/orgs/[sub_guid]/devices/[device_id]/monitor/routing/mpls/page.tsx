"use client";

import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import { MplsStatusPanel } from "@/components/monitor/status/MplsStatusPanel";

export default function Page() {
  return (
    <MonitorPageShell title="MPLS" subtitle="Live LDP sessions and label bindings for this firewall">
      <MplsStatusPanel />
    </MonitorPageShell>
  );
}
