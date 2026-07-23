"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  AppWindow,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Combine,
  CopyPlus,
  Filter,
  Globe,
  HeartPulse,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  LucideIcon,
  Network,
  Route,
  ScrollText,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Spline,
  Table2,
  Waypoints,
} from "lucide-react";
import { useCloudOrg } from "@/components/CloudShell";
import { setDeviceScope } from "@/lib/device/api";

interface NavChild {
  id: string;
  label: string;
  /** Path under the monitor base; "" is the overview (the base itself). */
  segment: string;
  icon: LucideIcon;
  /** Match the base exactly rather than by prefix (used by the overview). */
  exact?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Group prefix under the monitor base (also the default-open test). */
  segment: string;
  /** Children of a collapsible group; empty renders the group as a direct link. */
  children: NavChild[];
  /** For a childless direct-link group: match the base exactly, not by prefix. */
  exact?: boolean;
}

/// A product divider between nav groups (rendered as an uppercase section
/// label, matching the Inventory nav's QuartzFire / QuartzSONiC split).
interface NavHeading {
  heading: string;
}

type NavEntry = NavGroup | NavHeading;

const OVERVIEW_GROUP: NavGroup = {
  id: "overview",
  label: "Overview",
  icon: ClipboardList,
  segment: "",
  exact: true,
  children: [],
};

/// Monitor sub-navigation, grouped into Dashboard / Logs / Routing / VPN. The
/// same nav serves both the sub-organization Monitor (aggregate across the
/// sub-org's firewalls) and a single device's Monitor (that one firewall) —
/// the base path is derived from the route so every link stays in scope.
/// Routing and VPN mirror the QuartzFire local UI's live Status panels.
const FIRE_GROUPS: NavGroup[] = [
  {
    id: "dashboards",
    label: "Dashboards",
    icon: LayoutDashboard,
    segment: "/traffic-flow",
    children: [
      { id: "traffic-flow",    label: "Traffic Flow",    segment: "/traffic-flow",    icon: Share2 },
      { id: "quartzwatch",     label: "QuartzWatch",     segment: "/quartzwatch",     icon: LayoutGrid },
      { id: "geolocation-map", label: "Geolocation Map", segment: "/geolocation-map", icon: Globe },
    ],
  },
  {
    id: "logs",
    label: "Logs",
    icon: ScrollText,
    segment: "/logs",
    children: [
      { id: "traffic-monitor",   label: "Traffic Monitor",     segment: "/logs",                     icon: Activity, exact: true },
      { id: "ips-log",           label: "Intrusion Prevention", segment: "/logs/ips",                 icon: ShieldAlert },
      { id: "appcontrol-log",    label: "Application Control",  segment: "/logs/application-control", icon: AppWindow },
      { id: "geolocation-log",   label: "Geolocation",         segment: "/logs/geolocation",         icon: Globe },
      { id: "content-log",       label: "Content Filtering",   segment: "/logs/content-filtering",   icon: Filter },
    ],
  },
  {
    id: "routing",
    label: "Routing",
    icon: Route,
    segment: "/routing",
    children: [
      { id: "ospf", label: "OSPF",  segment: "/routing/ospf", icon: Waypoints },
      { id: "bgp",  label: "BGP",   segment: "/routing/bgp",  icon: Share2 },
      { id: "isis", label: "IS-IS", segment: "/routing/isis", icon: Spline },
      { id: "mpls", label: "MPLS",  segment: "/routing/mpls", icon: Waypoints },
    ],
  },
  {
    id: "vpn",
    label: "VPN",
    icon: ShieldCheck,
    segment: "/vpn",
    children: [
      { id: "wireguard", label: "WireGuard", segment: "/vpn/wireguard", icon: Spline },
      { id: "openvpn",   label: "OpenVPN",   segment: "/vpn/openvpn",   icon: Globe },
      { id: "ipsec",     label: "IPsec",     segment: "/vpn/ipsec",     icon: Lock },
      { id: "l2tp",      label: "L2TP",      segment: "/vpn/l2tp",      icon: Waypoints },
    ],
  },
];

/// QuartzSONiC switches have none of the firewall telemetry above; their
/// Monitor is the Overview plus switch-side live state, read-only — the
/// matching configuration lives under Configure (Switching / Routing).
const SONIC_GROUPS: NavGroup[] = [
  {
    id: "switching",
    label: "Switching",
    icon: Network,
    segment: "/switching",
    children: [
      { id: "mac-table", label: "MAC Table", segment: "/switching/mac-table", icon: Table2 },
    ],
  },
  {
    id: "routing",
    label: "Routing",
    icon: Route,
    segment: "/routing",
    children: [
      { id: "bfd",        label: "BFD",          segment: "/routing/bfd",        icon: HeartPulse },
      { id: "vxlan-evpn", label: "VXLAN / EVPN", segment: "/routing/vxlan-evpn", icon: Layers },
    ],
  },
];

/// Sub-organization-only group: MCLAG/VRRP span a pair of switches, so their
/// live state aggregates at the sub-org scope (the pages fan out across the
/// sub-org's switches) — configuration lives in the sub-org Configure
/// section's High Availability group.
const SUB_ORG_HA_GROUP: NavGroup = {
  id: "high-availability",
  label: "High Availability",
  icon: CopyPlus,
  segment: "/high-availability",
  children: [
    { id: "mclag", label: "MCLAG", segment: "/high-availability/mclag", icon: Combine },
    { id: "vrrp",  label: "VRRP",  segment: "/high-availability/vrrp",  icon: Network },
  ],
};

export function MonitorNav() {
  const pathname = (usePathname() ?? "/").replace(/\/+$/, "") || "/";
  const params = useParams<{ organization_guid: string; sub_guid?: string; device_id?: string }>();
  const base = params.device_id
    ? `/cloud/${params.organization_guid}/orgs/${params.sub_guid}/devices/${params.device_id}/monitor`
    : `/cloud/${params.organization_guid}/orgs/${params.sub_guid}/monitor`;

  // The dashboards / logs / routing / VPN groups are firewall telemetry — a
  // QuartzSONiC switch gets its own switch-side group set instead. At the
  // sub-org scope (no device routed) the aggregate views span both products,
  // so a QUARTZFIRE / QUARTZSONIC heading splits the nav per product (the
  // switch pairs' High Availability state is the SONiC side today).
  const { devices } = useCloudOrg();
  const device = params.device_id
    ? (devices ?? []).find((d) => d.device_id === params.device_id)
    : undefined;
  const entries: NavEntry[] =
    device?.product === "quartzsonic"
      ? [OVERVIEW_GROUP, ...SONIC_GROUPS]
      : params.device_id
        ? [OVERVIEW_GROUP, ...FIRE_GROUPS]
        : [
            OVERVIEW_GROUP,
            { heading: "QuartzFire" },
            ...FIRE_GROUPS,
            { heading: "QuartzSONiC" },
            SUB_ORG_HA_GROUP,
          ];

  // Open if explicitly toggled, else default-open when one of the group's
  // children is the active route (children needn't share a path prefix).
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});
  const childActive = (g: NavGroup) =>
    g.children.some((c) => {
      const href = base + c.segment;
      return c.exact ? pathname === href : pathname.startsWith(href);
    });
  const isOpen = (g: NavGroup) => openMenus[g.id] ?? childActive(g);

  const groupClass =
    "flex items-center gap-[10px] px-[10px] py-[8px] rounded-md text-[13.5px] font-medium border border-transparent text-[var(--qz-fg-3)] transition-all duration-[120ms] no-underline w-full text-left cursor-pointer hover:text-[var(--qz-fg-1)] hover:bg-[color-mix(in_oklab,white_4%,transparent)]";

  return (
    <div className="flex-shrink-0 w-[240px]" style={{ borderRight: "1px solid var(--qz-border)" }}>
      <nav className="sticky top-0 px-3 pt-6 flex flex-col gap-[2px]">
        {entries.map((entry) => {
          if ("heading" in entry) {
            return (
              <span
                key={entry.heading}
                className="text-[11px] font-semibold uppercase px-[2px] mt-4 mb-1"
                style={{
                  color: "var(--qz-fg-3)",
                  fontFamily: "var(--qz-font-mono)",
                  letterSpacing: "0.08em",
                }}
              >
                {entry.heading}
              </span>
            );
          }

          const group = entry;
          const Icon = group.icon;

          // A childless group is a direct top-level link (the Overview page).
          // Build the class fresh here (not from groupClass) so the active
          // branch fully owns text/border color — reusing groupClass would bake
          // in `text-fg-3`/`border-transparent` that then conflict with the
          // active accent utilities and win unpredictably, leaving Overview
          // looking unlike every other selected nav item.
          if (group.children.length === 0) {
            const href = base + group.segment;
            const active = group.exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={group.id}
                href={href}
                className={[
                  "flex items-center gap-[10px] px-[10px] py-[8px] rounded-md text-[13.5px] font-medium border transition-all duration-[120ms] no-underline w-full text-left cursor-pointer",
                  active
                    ? "bg-[var(--qz-accent-soft)] text-[var(--qz-accent)] border-[color-mix(in_oklab,var(--qz-accent)_30%,transparent)]"
                    : "text-[var(--qz-fg-3)] border-transparent hover:text-[var(--qz-fg-1)] hover:bg-[color-mix(in_oklab,white_4%,transparent)]",
                ].join(" ")}
              >
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
                className={groupClass}
              >
                <Icon size={16} />
                <span className="flex-1">{group.label}</span>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {open && (
                <div className="flex flex-col gap-[2px] mt-[2px] ml-[26px]">
                  {group.children.map((child) => {
                    const href = base + child.segment;
                    const active = child.exact ? pathname === href : pathname.startsWith(href);
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

/// Two-column Monitor frame for the sub-organization scope: sub-nav on the
/// left, the active aggregate view on the right.
export function MonitorFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-stretch">
      <MonitorNav />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

/// Device-scope Monitor frame: like MonitorFrame, but points the device API
/// transport at the routed firewall (during render, before any page effect
/// fetches) so the ported live-status panels proxy to the right device.
/// Monitor is read-only, so no commit/toast chrome is mounted.
export function DeviceMonitorFrame({ children }: { children: React.ReactNode }) {
  const params = useParams<{ organization_guid: string; device_id: string }>();
  setDeviceScope(params.organization_guid, params.device_id);
  return (
    <div className="flex min-h-full items-stretch">
      <MonitorNav />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
