import { InventoryFrame } from "@/components/inventory/InventoryNav";

export default function SubOrgInventoryLayout({ children }: { children: React.ReactNode }) {
  return <InventoryFrame>{children}</InventoryFrame>;
}
