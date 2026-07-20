import { MonitorFrame } from "@/components/monitor/MonitorNav";

export default function DeviceMonitorLayout({ children }: { children: React.ReactNode }) {
  return <MonitorFrame>{children}</MonitorFrame>;
}
