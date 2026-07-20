import { DeviceConfigFrame } from "@/components/device/DeviceConfigNav";

export default function DeviceConfigureLayout({ children }: { children: React.ReactNode }) {
  return <DeviceConfigFrame>{children}</DeviceConfigFrame>;
}
