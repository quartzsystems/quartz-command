"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ClipboardList, LucideIcon, Package, PackageCheck } from "lucide-react";

/// Secondary navigation for the Inventory section — Summary on top, then the
/// per-product device views (QuartzFire and QuartzSONiC, each with
/// Allocated / Unallocated). Rendered by the inventory layouts at both the
/// organization and sub-organization level; the base path is derived from the
/// route.
export function InventoryNav() {
  const pathname = (usePathname() ?? "/").replace(/\/+$/, "") || "/";
  const params = useParams<{ organization_guid: string; sub_guid?: string }>();
  const base = params.sub_guid
    ? `/cloud/${params.organization_guid}/orgs/${params.sub_guid}/inventory`
    : `/cloud/${params.organization_guid}/inventory`;

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

  const section = (label: string) => (
    <span
      className="text-[11px] font-semibold uppercase px-[2px] mt-4 mb-1"
      style={{
        color: "var(--qz-fg-3)",
        fontFamily: "var(--qz-font-mono)",
        letterSpacing: "0.08em",
      }}
    >
      {label}
    </span>
  );

  return (
    <div
      className="flex-shrink-0 w-[240px]"
      style={{ borderRight: "1px solid var(--qz-border)" }}
    >
      <nav className="sticky top-0 px-3 pt-6 flex flex-col gap-[2px]">
        {item(base, "Summary", ClipboardList, true)}

        {section("QuartzFire")}
        {item(`${base}/allocated`, "Allocated", PackageCheck)}
        {item(`${base}/unallocated`, "Unallocated", Package)}

        {section("QuartzSONiC")}
        {item(`${base}/sonic/allocated`, "Allocated", PackageCheck)}
        {item(`${base}/sonic/unallocated`, "Unallocated", Package)}
      </nav>
    </div>
  );
}

/// The two-column inventory frame: sub-nav on the left, the active view on the
/// right. Used by both inventory layout.tsx files.
export function InventoryFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-stretch">
      <InventoryNav />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
