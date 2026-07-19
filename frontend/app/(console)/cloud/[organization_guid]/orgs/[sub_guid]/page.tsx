"use client";

import { Building2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useCloudOrg } from "@/components/CloudShell";
import { getSubOrganization, type SubOrganization } from "@/lib/api";

/// One sub-organization's page. Fetched through the parent-scoped endpoint,
/// so it only renders for sub-orgs nested under an org the user belongs to.
/// Real sub-org content is a follow-up.
export default function SubOrgPage() {
  const { orgGuid } = useCloudOrg();
  const params = useParams<{ sub_guid: string }>();
  const subGuid = params.sub_guid;

  const [sub, setSub] = useState<SubOrganization | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSub(null);
    setError("");
    getSubOrganization(orgGuid, subGuid)
      .then((s) => !cancelled && setSub(s))
      .catch((err) => !cancelled && setError(err?.message ?? "Failed to load sub-organization."));
    return () => {
      cancelled = true;
    };
  }, [orgGuid, subGuid]);

  if (error) {
    return (
      <div className="p-6">
        <div className="surface p-6">
          <p className="text-[13px] m-0" style={{ color: "var(--qz-danger)" }}>
            {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg grid place-items-center flex-shrink-0"
          style={{ background: "var(--qz-accent-soft)", color: "var(--qz-accent)" }}
        >
          <Building2 size={18} />
        </div>
        <div className="flex flex-col">
          <h1
            className="text-[18px] font-bold text-[var(--qz-fg-1)] m-0"
            style={{ letterSpacing: "-0.02em" }}
          >
            {sub ? sub.name : "Loading…"}
          </h1>
          {sub && (
            <span
              className="text-[11px]"
              style={{ color: "var(--qz-fg-4)", fontFamily: "var(--qz-font-mono)" }}
            >
              {sub.slug}
            </span>
          )}
        </div>
      </header>

      <div className="surface p-8 flex flex-col gap-2">
        <span className="badge badge-muted" style={{ alignSelf: "flex-start" }}>
          sub-organization
        </span>
        <h2 className="text-[16px] font-semibold text-[var(--qz-fg-1)] m-0 mt-2">
          {sub?.name ?? "Sub-organization"}
        </h2>
        <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
          Content scoped to this sub-organization will live here.
          {sub && (
            <>
              {" "}
              Created {new Date(sub.created_at).toLocaleDateString()}.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
