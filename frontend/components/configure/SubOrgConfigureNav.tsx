"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Combine,
  CopyPlus,
  LucideIcon,
  Network,
} from "lucide-react";

interface NavChild {
  id: string;
  label: string;
  /** Path under the sub-org's /configure base. */
  segment: string;
  icon: LucideIcon;
}

interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Group prefix under /configure (also the default-open test). */
  segment: string;
  /** Children of a collapsible group; empty renders the group as a direct link. */
  children: NavChild[];
  /** For a childless direct-link group: match the base exactly, not by prefix. */
  exact?: boolean;
}

/// Sub-organization Configure navigation. Unlike the device Configure nav,
/// everything here spans multiple devices: High Availability features
/// (MCLAG, VRRP) are defined across a *pair* of switches, so they can only
/// be configured at this scope — a single device's Configure section has no
/// second switch to pair with.
const GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    icon: ClipboardList,
    segment: "",
    exact: true,
    children: [],
  },
  {
    id: "high-availability",
    label: "High Availability",
    icon: CopyPlus,
    segment: "/high-availability",
    children: [
      { id: "mclag", label: "MCLAG", segment: "/high-availability/mclag", icon: Combine },
      { id: "vrrp",  label: "VRRP",  segment: "/high-availability/vrrp",  icon: Network },
    ],
  },
];

export function SubOrgConfigureNav() {
  const pathname = (usePathname() ?? "/").replace(/\/+$/, "") || "/";
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  const base = `/cloud/${params.organization_guid}/orgs/${params.sub_guid}/configure`;

  // Open if explicitly toggled, else default-open on the active subtree.
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});
  const isOpen = (g: NavGroup) => openMenus[g.id] ?? pathname.startsWith(base + g.segment);

  const linkClass = (active: boolean) =>
    [
      "flex items-center gap-[10px] px-[10px] py-[8px] rounded-md text-[13.5px] font-medium border transition-all duration-[120ms] no-underline w-full text-left cursor-pointer",
      active
        ? "bg-[var(--qz-accent-soft)] text-[var(--qz-accent)] border-[color-mix(in_oklab,var(--qz-accent)_30%,transparent)]"
        : "text-[var(--qz-fg-3)] border-transparent hover:text-[var(--qz-fg-1)] hover:bg-[color-mix(in_oklab,white_4%,transparent)]",
    ].join(" ");

  return (
    <div className="flex-shrink-0 w-[240px]" style={{ borderRight: "1px solid var(--qz-border)" }}>
      <nav className="sticky top-0 px-3 pt-6 flex flex-col gap-[2px]">
        {GROUPS.map((group) => {
          const Icon = group.icon;

          if (group.children.length === 0) {
            const href = base + group.segment;
            const active = group.exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={group.id} href={href} className={linkClass(active)}>
                <Icon size={16} />
                <span className="flex-1">{group.label}</span>
              </Link>
            );
          }

          const open = isOpen(group);
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => setOpenMenus((p) => ({ ...p, [group.id]: !open }))}
                className={linkClass(false)}
              >
                <Icon size={16} />
                <span className="flex-1">{group.label}</span>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {open && (
                <div className="flex flex-col gap-[2px] mt-[2px] ml-[26px]">
                  {group.children.map((child) => {
                    const href = base + child.segment;
                    const active = pathname.startsWith(href);
                    const ChildIcon = child.icon;
                    return (
                      <Link
                        key={child.id}
                        href={href}
                        className={[
                          "flex items-center gap-[9px] px-[10px] py-[7px] rounded-md text-[13px] font-medium border transition-all duration-[120ms] no-underline",
                          active
                            ? "bg-[var(--qz-accent-soft)] text-[var(--qz-accent)] border-[color-mix(in_oklab,var(--qz-accent)_30%,transparent)]"
                            : "text-[var(--qz-fg-3)] border-transparent hover:text-[var(--qz-fg-1)] hover:bg-[color-mix(in_oklab,white_4%,transparent)]",
                        ].join(" ")}
                      >
                        <ChildIcon size={15} />
                        <span>{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

/// Two-column frame for the sub-organization Configure section: sub-nav on
/// the left, the active fleet-level view on the right.
export function SubOrgConfigureFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-stretch">
      <SubOrgConfigureNav />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
