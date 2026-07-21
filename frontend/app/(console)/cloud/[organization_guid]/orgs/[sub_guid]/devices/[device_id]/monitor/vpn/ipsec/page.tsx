"use client";

import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import { IpsecStatusPanel } from "@/components/monitor/status/IpsecStatusPanel";

export default function Page() {
  return (
    <MonitorPageShell title="IPsec" subtitle="Live IPsec security associations for this firewall">
      <IpsecStatusPanel />
    </MonitorPageShell>
  );
}
