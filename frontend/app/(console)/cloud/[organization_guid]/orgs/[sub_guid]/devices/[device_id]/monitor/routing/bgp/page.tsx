"use client";

import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import { BgpStatusPanel } from "@/components/monitor/status/BgpStatusPanel";

export default function Page() {
  return (
    <MonitorPageShell title="BGP" subtitle="Live BGP sessions for this firewall">
      <BgpStatusPanel />
    </MonitorPageShell>
  );
}
