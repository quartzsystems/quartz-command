import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/AdminShell";

export const metadata: Metadata = {
  title: "Quartz Command Admin",
  description: "Quartz Command administration console",
};

/// Wraps every admin console page in the sidebar shell + admin auth gate. The
/// sibling /admin/login route sits outside this group so it stays unguarded.
export default function AdminConsoleLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
