"use client";

import { useParams } from "next/navigation";
import { CloudShell } from "@/components/CloudShell";

/// Every page under /cloud/{organization_guid} renders inside the cloud
/// console shell (top header + Organization Manager sidebar). Auth is already
/// enforced by the (console) layout above this one.
export default function OrgConsoleLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ organization_guid: string }>();
  return <CloudShell orgGuid={params.organization_guid}>{children}</CloudShell>;
}
