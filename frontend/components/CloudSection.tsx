"use client";

import { useParams } from "next/navigation";
import { useCloudOrg } from "@/components/CloudShell";

/// Placeholder body for the top-header sections (Monitor, Configure,
/// Inventory, Administration) until each grows real content. Rendered both at
/// the organization level and scoped under a sub-organization.
export function CloudSection({ title, blurb }: { title: string; blurb: string }) {
  const { org, subs } = useCloudOrg();
  const params = useParams<{ sub_guid?: string }>();
  const sub = params.sub_guid ? subs?.find((s) => s.id === params.sub_guid) : undefined;
  const scopeName = sub ? `${sub.name} · ${org?.name ?? ""}` : org?.name;

  return (
    <div className="p-6 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1
          className="text-[20px] font-bold text-[var(--qz-fg-1)] m-0"
          style={{ letterSpacing: "-0.02em" }}
        >
          {title}
        </h1>
        <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
          {scopeName ?? "Loading…"}
        </p>
      </header>

      <div className="surface p-8 flex flex-col gap-2">
        <span className="badge badge-info" style={{ alignSelf: "flex-start" }}>
          coming soon
        </span>
        <h2 className="text-[16px] font-semibold text-[var(--qz-fg-1)] m-0 mt-2">{title}</h2>
        <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
          {blurb}
        </p>
      </div>
    </div>
  );
}
