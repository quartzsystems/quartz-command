"use client";

import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import { OpenvpnStatusPanel } from "@/components/monitor/status/OpenvpnStatusPanel";

export default function Page() {
  return (
    <MonitorPageShell title="OpenVPN" subtitle="Live OpenVPN tunnels for this firewall">
      <OpenvpnStatusPanel />
    </MonitorPageShell>
  );
}
