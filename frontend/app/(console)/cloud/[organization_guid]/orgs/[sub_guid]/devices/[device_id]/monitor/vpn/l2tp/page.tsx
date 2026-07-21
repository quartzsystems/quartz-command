"use client";

import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import { L2tpStatusPanel } from "@/components/monitor/status/L2tpStatusPanel";

export default function Page() {
  return (
    <MonitorPageShell title="L2TP" subtitle="Live L2TP remote-access sessions for this firewall">
      <L2tpStatusPanel />
    </MonitorPageShell>
  );
}
