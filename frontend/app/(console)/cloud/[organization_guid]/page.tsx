"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useCloudOrg } from "@/components/CloudShell";

/// The org Overview — the Dashboard landing page of the cloud console. Sums up
/// the organization and lists its sub-organizations; the shell (sidebar +)
/// owns creation, exposed here for the empty state.
export default function OverviewPage() {
  const { orgGuid, org, subs, openCreateSub } = useCloudOrg();
  const router = useRouter();

  return (
    <div className="p-6 flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1
            className="text-[20px] font-bold text-[var(--qz-fg-1)] m-0"
            style={{ letterSpacing: "-0.02em" }}
          >
            Overview
          </h1>
          <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
            {org ? org.name : "Loading…"}
            {org && (
              <span
                className="ml-2 text-[11px]"
                style={{ fontFamily: "var(--qz-font-mono)", color: "var(--qz-fg-4)" }}
              >
                {org.slug}
              </span>
            )}
          </p>
        </div>
        <Button icon={Plus} onClick={openCreateSub}>
          New sub-organization
        </Button>
      </header>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="kpi-card">
          <div className="kpi-label">Sub-organizations</div>
          <div className="kpi-value">{subs === null ? "…" : subs.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Your role</div>
          <div className="kpi-value" style={{ fontSize: 22, textTransform: "capitalize" }}>
            {org ? org.role : "…"}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Created</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>
            {org ? new Date(org.created_at).toLocaleDateString() : "…"}
          </div>
        </div>
      </div>

      <section className="surface overflow-hidden">
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--qz-border)" }}
        >
          <h2 className="text-[14px] font-semibold text-[var(--qz-fg-1)] m-0">
            Sub-organizations
          </h2>
        </div>

        {subs !== null && subs.length === 0 ? (
          <div className="p-8 flex flex-col items-center gap-3">
            <p className="text-[13px] m-0 text-center" style={{ color: "var(--qz-fg-3)" }}>
              No sub-organizations yet. Create one to segment this organization.
            </p>
            <Button icon={Plus} kind="secondary" onClick={openCreateSub}>
              Create sub-organization
            </Button>
          </div>
        ) : (
          <table className="qz-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(subs ?? []).map((sub) => (
                <tr key={sub.id} onClick={() => router.push(`/cloud/${orgGuid}/orgs/${sub.id}`)}>
                  <td className="mono">{sub.name}</td>
                  <td style={{ fontFamily: "var(--qz-font-mono)", color: "var(--qz-fg-3)" }}>
                    {sub.slug}
                  </td>
                  <td>{new Date(sub.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {subs === null && (
                <tr>
                  <td colSpan={3} style={{ color: "var(--qz-fg-4)" }}>
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
