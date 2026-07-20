"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ClipboardList, LucideIcon } from "lucide-react";

/// Secondary navigation for the Monitor section under a sub-organization (or a
/// single device within one). Summary is the only item for now; the base path
/// is derived from the route so the same nav serves both scopes. The
/// organization-level Monitor has no sub-nav.
export function MonitorNav() {
  const pathname = (usePathname() ?? "/").replace(/\/+$/, "") || "/";
  const params = useParams<{ organization_guid: string; sub_guid?: string; device_id?: string }>();
  const base = params.device_id
    ? `/cloud/${params.organization_guid}/orgs/${params.sub_guid}/devices/${params.device_id}/monitor`
    : `/cloud/${params.organization_guid}/orgs/${params.sub_guid}/monitor`;

  const itemClass = (active: boolean) =>
    [
      "flex items-center gap-[10px] px-[10px] py-[8px] rounded-md text-[13.5px] font-medium border transition-all duration-[120ms] no-underline w-full text-left cursor-pointer",
      active
        ? "bg-[var(--qz-accent-soft)] text-[var(--qz-accent)] border-[color-mix(in_oklab,var(--qz-accent)_30%,transparent)]"
        : "text-[var(--qz-fg-3)] border-transparent hover:text-[var(--qz-fg-1)] hover:bg-[color-mix(in_oklab,white_4%,transparent)]",
    ].join(" ");

  const item = (href: string, label: string, Icon: LucideIcon, exact = false) => (
    <Link href={href} className={itemClass(exact ? pathname === href : pathname.startsWith(href))}>
      <Icon size={15} className="flex-shrink-0" />
      <span>{label}</span>
    </Link>
  );

  return (
    <div className="flex-shrink-0 w-[240px]" style={{ borderRight: "1px solid var(--qz-border)" }}>
      <nav className="sticky top-0 px-3 pt-6 flex flex-col gap-[2px]">
        {item(base, "Summary", ClipboardList, true)}
      </nav>
    </div>
  );
}

/// Two-column Monitor frame: sub-nav on the left, the active view on the right.
/// Used by the sub-organization and device Monitor layouts.
export function MonitorFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-stretch">
      <MonitorNav />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
