import { DeviceMonitorFrame } from "@/components/monitor/MonitorNav";

export default function DeviceMonitorLayout({ children }: { children: React.ReactNode }) {
  return <DeviceMonitorFrame>{children}</DeviceMonitorFrame>;
}
