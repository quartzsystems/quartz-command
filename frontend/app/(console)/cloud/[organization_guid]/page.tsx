"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getOrganization, ApiError, type MemberOrganization } from "@/lib/api";

/// Per-organization dashboard shell at /cloud/{organization_guid}. Fetches the
/// org through the membership-enforced endpoint (403 → not a member), so this
/// page can only render for an org the user actually belongs to. Real dashboard
/// content is a follow-up.
export default function OrgDashboardPage() {
  const params = useParams<{ organization_guid: string }>();
  const guid = params.organization_guid;
  const router = useRouter();
  const [org, setOrg] = useState<MemberOrganization | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getOrganization(guid)
      .then((o) => !cancelled && setOrg(o))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          setError("You don't have access to this organization.");
        } else {
          setError(err?.message ?? "Failed to load organization.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [guid]);

  return (
    <div className="min-h-screen p-6 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo-mark.png" alt="Quartz Systems" className="w-8 h-8" />
          <div className="flex flex-col">
            <h1 className="text-[18px] font-bold text-[var(--qz-fg-1)] m-0">
              {org ? org.name : "Organization"}
            </h1>
            <span
              className="text-[11px]"
              style={{ color: "var(--qz-fg-4)", fontFamily: "var(--qz-font-mono)" }}
            >
              {guid}
            </span>
          </div>
        </div>
        <Link
          href="/cloud"
          className="text-[12px] no-underline"
          style={{ color: "var(--qz-fg-4)" }}
        >
          ← All organizations
        </Link>
      </header>

      {error && (
        <div className="surface p-6">
          <p className="text-[13px] m-0" style={{ color: "var(--qz-danger)" }}>
            {error}
          </p>
          <button
            onClick={() => router.replace("/cloud")}
            className="mt-3 rounded-md px-3 py-2 text-[12px] font-semibold cursor-pointer border-0"
            style={{ background: "var(--qz-accent)", color: "var(--qz-fg-on-accent)" }}
          >
            Back to organizations
          </button>
        </div>
      )}

      {!error && (
        <div className="surface p-8 flex flex-col gap-2">
          <span className="badge badge-info" style={{ alignSelf: "flex-start" }}>
            {org ? org.role : "…"}
          </span>
          <h2 className="text-[16px] font-semibold text-[var(--qz-fg-1)] m-0 mt-2">
            Cloud dashboard
          </h2>
          <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
            This is the dashboard shell for{" "}
            <strong style={{ color: "var(--qz-fg-1)" }}>{org?.name ?? "this organization"}</strong>.
            Organization-scoped content will live here.
          </p>
        </div>
      )}
    </div>
  );
}
