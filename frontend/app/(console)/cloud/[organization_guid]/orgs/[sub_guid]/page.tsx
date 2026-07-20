"use client";

import { useParams } from "next/navigation";
import { useCloudOrg } from "@/components/CloudShell";
import { OverviewDashboard } from "@/components/OverviewDashboard";

/// One sub-organization's Dashboard — the same Overview as the org level, but
/// scoped to this sub-org's allocated fleet. Access is enforced by the parent
/// membership check the shell already ran; here we just guard against a sub id
/// that isn't nested under this organization.
export default function SubOrgPage() {
  const { subs } = useCloudOrg();
  const params = useParams<{ sub_guid: string }>();
  const subGuid = params.sub_guid;

  if (subs !== null && !subs.some((s) => s.id === subGuid)) {
    return (
      <div className="p-6">
        <div className="surface p-6">
          <p className="text-[13px] m-0" style={{ color: "var(--qz-danger)" }}>
            Sub-organization not found.
          </p>
        </div>
      </div>
    );
  }

  return <OverviewDashboard subGuid={subGuid} />;
}
