import { InventoryFrame } from "@/components/inventory/InventoryNav";

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return <InventoryFrame>{children}</InventoryFrame>;
}
