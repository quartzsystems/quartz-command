"use client";

import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import { WireguardStatusPanel } from "@/components/monitor/status/WireguardStatusPanel";

export default function Page() {
  return (
    <MonitorPageShell title="WireGuard" subtitle="Live WireGuard peers for this firewall">
      <WireguardStatusPanel />
    </MonitorPageShell>
  );
}
