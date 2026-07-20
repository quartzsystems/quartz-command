import { MonitorFrame } from "@/components/monitor/MonitorNav";

export default function SubOrgMonitorLayout({ children }: { children: React.ReactNode }) {
  return <MonitorFrame>{children}</MonitorFrame>;
}
