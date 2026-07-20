"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState } from "react";
import { CommitGuard } from "@/components/dashboard/CommitGuard";
import { SaveIndicator } from "@/components/dashboard/SaveIndicator";
import { Toast } from "@/components/dashboard/Toast";
import { setDeviceScope } from "@/lib/device/api";
import { DashboardProvider, useDashboard } from "@/lib/device/DashboardContext";
import {
  ArrowLeftRight,
  BookMarked,
  Boxes,
  Cable,
  ChevronDown,
  ChevronRight,
  Combine,
  ListOrdered,
  LucideIcon,
  Network,
  Repeat,
  Share2,
  Shield,
  Shuffle,
  Spline,
  Tags,
  Waypoints,
} from "lucide-react";

interface NavChild {
  id: string;
  label: string;
  /** Path under the device's /configure base. */
  segment: string;
  icon: LucideIcon;
}

interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Group prefix under /configure (also the default-open test). */
  segment: string;
  children: NavChild[];
}

/// Mirrors the QuartzFire local web UI's sidebar for the sections managed
/// from the cloud: Interfaces and NAT in full, Firewall minus Traffic Monitor
/// (live traffic stays on the device's own UI). Keep in step with
/// quartz-fire quartzfire-webui/frontend/components/dashboard/Sidebar.tsx.
const GROUPS: NavGroup[] = [
  {
    id: "interfaces",
    label: "Interfaces",
    icon: Network,
    segment: "/interfaces",
    children: [
      { id: "ethernet", label: "Ethernet", segment: "/interfaces/ethernet", icon: Cable },
      { id: "vlan",     label: "VLAN",     segment: "/interfaces/vlan",     icon: Tags },
      { id: "bonding",  label: "Bonding",  segment: "/interfaces/bonding",  icon: Combine },
      { id: "bridge",   label: "Bridge",   segment: "/interfaces/bridge",   icon: Waypoints },
      { id: "vxlan",    label: "VXLAN",    segment: "/interfaces/vxlan",    icon: Spline },
      { id: "loopback", label: "Loopback", segment: "/interfaces/loopback", icon: Repeat },
    ],
  },
  {
    id: "nat",
    label: "NAT",
    icon: ArrowLeftRight,
    segment: "/nat",
    children: [
      { id: "nat44", label: "NAT44", segment: "/nat/nat44", icon: Shuffle },
    ],
  },
  {
    id: "firewall",
    label: "Firewall",
    icon: Shield,
    segment: "/firewall",
    children: [
      { id: "rules",    label: "Rules",    segment: "/firewall/rules",    icon: ListOrdered },
      { id: "zones",    label: "Zones",    segment: "/firewall/zones",    icon: Share2 },
      { id: "policies", label: "Policies", segment: "/firewall/policies", icon: Boxes },
      { id: "aliases",  label: "Aliases",  segment: "/firewall/aliases",  icon: BookMarked },
    ],
  },
];

/// Secondary navigation for a device's Configure section — the same groups,
/// icons, and expand/collapse behaviour as the QuartzFire local UI sidebar.
export function DeviceConfigNav() {
  const pathname = (usePathname() ?? "/").replace(/\/+$/, "") || "/";
  const params = useParams<{ organization_guid: string; sub_guid: string; device_id: string }>();
  const base = `/cloud/${params.organization_guid}/orgs/${params.sub_guid}/devices/${params.device_id}/configure`;

  // Expandable groups: open if explicitly toggled, else default-open on the
  // active subtree (same rule as the QuartzFire sidebar).
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});
  const isOpen = (g: NavGroup) => openMenus[g.id] ?? pathname.startsWith(base + g.segment);

  const itemClass = (active: boolean) =>
    [
      "flex items-center gap-[10px] px-[10px] py-[8px] rounded-md text-[13.5px] font-medium border transition-all duration-[120ms] no-underline w-full text-left cursor-pointer",
      active
        ? "bg-[var(--qz-accent-soft)] text-[var(--qz-accent)] border-[color-mix(in_oklab,var(--qz-accent)_30%,transparent)]"
        : "text-[var(--qz-fg-3)] border-transparent hover:text-[var(--qz-fg-1)] hover:bg-[color-mix(in_oklab,white_4%,transparent)]",
    ].join(" ");

  return (
    <div
      className="flex-shrink-0 w-[240px]"
      style={{ borderRight: "1px solid var(--qz-border)" }}
    >
      <nav className="sticky top-0 px-3 pt-6 flex flex-col gap-[2px]">
        {GROUPS.map((group) => {
          const Icon = group.icon;
          const open = isOpen(group);
          // Parent never shows the green "active" state — only children light up.
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => setOpenMenus((p) => ({ ...p, [group.id]: !open }))}
                className={itemClass(false)}
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

function FrameInner({ children }: { children: React.ReactNode }) {
  const { toast, setToast } = useDashboard();
  return (
    <div className="flex min-h-full items-stretch">
      <DeviceConfigNav />
      <div className="flex-1 min-w-0">{children}</div>
      <SaveIndicator />
      <CommitGuard />
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

/// Two-column frame for the device Configure section: QuartzFire-style
/// sub-nav on the left, the active section on the right, plus the same
/// commit-confirm / boot-save / toast chrome the local UI's shell mounts.
/// Also points the device API transport at the routed device — during render,
/// so it is always set before any page effect fetches.
export function DeviceConfigFrame({ children }: { children: React.ReactNode }) {
  const params = useParams<{ organization_guid: string; device_id: string }>();
  setDeviceScope(params.organization_guid, params.device_id);
  return (
    <DashboardProvider>
      <FrameInner>{children}</FrameInner>
    </DashboardProvider>
  );
}
