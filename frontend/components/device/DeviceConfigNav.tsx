"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState } from "react";
import { CommitGuard } from "@/components/dashboard/CommitGuard";
import { SaveIndicator } from "@/components/dashboard/SaveIndicator";
import { Toast } from "@/components/dashboard/Toast";
import { setDeviceScope } from "@/lib/device/api";
import { DashboardProvider, useDashboard } from "@/lib/device/DashboardContext";
import { useCloudOrg } from "@/components/CloudShell";
import {
  Activity,
  AppWindow,
  ArrowLeftRight,
  BookMarked,
  Boxes,
  Cable,
  Cast,
  ChevronDown,
  ChevronRight,
  CloudLightning,
  Combine,
  Copy,
  Earth,
  EthernetPort,
  Filter,
  Forward,
  Gauge,
  GitBranch,
  Globe,
  HeartPulse,
  Layers,
  KeyRound,
  ListOrdered,
  Lock,
  LucideIcon,
  Milestone,
  Network,
  RadioTower,
  Repeat,
  Route,
  Router,
  Server,
  Settings,
  Share2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Spline,
  Table2,
  Tags,
  Users,
  Waypoints,
  Wrench,
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
/// from the cloud. Configuration only: routing protocols, VPNs, and services
/// keep their config panes but drop the live Status / Alerts tabs (those move
/// to the cloud Monitor section), and System omits Management and Audit Log.
/// Keep in step with quartz-fire
/// quartzfire-webui/frontend/components/dashboard/Sidebar.tsx.
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
  {
    id: "routing",
    label: "Routing",
    icon: Route,
    segment: "/routing",
    children: [
      { id: "static", label: "Static", segment: "/routing/static", icon: Milestone },
      { id: "ospf",   label: "OSPF",   segment: "/routing/ospf",   icon: Waypoints },
      { id: "isis",   label: "IS-IS",  segment: "/routing/isis",   icon: Spline },
      { id: "bgp",    label: "BGP",    segment: "/routing/bgp",    icon: Share2 },
      { id: "mpls",   label: "MPLS",   segment: "/routing/mpls",   icon: Waypoints },
      { id: "policy", label: "Policy", segment: "/routing/policy", icon: Filter },
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
  {
    id: "services",
    label: "Services",
    icon: Server,
    segment: "/services",
    children: [
      { id: "dhcp-server",          label: "DHCP Server",          segment: "/services/dhcp-server",          icon: Router },
      { id: "dhcp-relay",           label: "DHCP Relay",           segment: "/services/dhcp-relay",           icon: Forward },
      { id: "dns-forwarding",       label: "DNS Forwarding",       segment: "/services/dns-forwarding",       icon: Globe },
      { id: "intrusion-prevention", label: "Intrusion Prevention", segment: "/services/intrusion-prevention", icon: ShieldAlert },
      { id: "application-control",  label: "Application Control",  segment: "/services/application-control",  icon: AppWindow },
      { id: "geolocation",          label: "Geolocation",          segment: "/services/geolocation",          icon: Earth },
      { id: "ssl-inspection",       label: "SSL Inspection",       segment: "/services/ssl-inspection",       icon: Lock },
      { id: "content-filtering",    label: "Content Filtering",    segment: "/services/content-filtering",    icon: Filter },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Settings,
    segment: "/system",
    children: [
      { id: "general",     label: "General",     segment: "/system/general",     icon: SlidersHorizontal },
      { id: "users",       label: "Users",       segment: "/system/users",       icon: Users },
      { id: "ssh",         label: "SSH",         segment: "/system/ssh",         icon: KeyRound },
      { id: "maintenance", label: "Maintenance", segment: "/system/maintenance", icon: Wrench },
    ],
  },
];

/// QuartzSONiC switches manage L2 switching from the cloud; no local web UI
/// to mirror, so this nav is the switch's primary configuration surface.
const SONIC_GROUPS: NavGroup[] = [
  {
    id: "switching",
    label: "Switching",
    icon: Network,
    segment: "/switching",
    children: [
      { id: "ports",           label: "Ports",           segment: "/switching/ports",           icon: EthernetPort },
      { id: "port-channels",   label: "Port Channels",   segment: "/switching/port-channels",   icon: Combine },
      { id: "vlans",           label: "VLANs",           segment: "/switching/vlans",           icon: Tags },
      { id: "spanning-tree",   label: "Spanning Tree",   segment: "/switching/spanning-tree",   icon: GitBranch },
      { id: "loop-protection", label: "Loop Protection", segment: "/switching/loop-protection", icon: ShieldAlert },
      { id: "storm-control",   label: "Storm Control",   segment: "/switching/storm-control",   icon: CloudLightning },
      { id: "mac-table",       label: "MAC Table",       segment: "/switching/mac-table",       icon: Table2 },
      { id: "port-mirroring",  label: "Port Mirroring",  segment: "/switching/port-mirroring",  icon: Copy },
      { id: "lldp",            label: "LLDP",            segment: "/switching/lldp",            icon: RadioTower },
      { id: "igmp-snooping",   label: "IGMP Snooping",   segment: "/switching/igmp-snooping",   icon: Cast },
      { id: "sflow",           label: "sFlow",           segment: "/switching/sflow",           icon: Activity },
    ],
  },
  {
    id: "routing",
    label: "Routing",
    icon: Route,
    segment: "/routing",
    children: [
      { id: "l3-interfaces", label: "L3 Interfaces", segment: "/routing/l3-interfaces", icon: Cable },
      { id: "vrfs",          label: "VRFs",          segment: "/routing/vrfs",          icon: Boxes },
      { id: "static",        label: "Static Routes", segment: "/routing/static",        icon: Milestone },
      { id: "dhcp-relay",    label: "DHCP Relay",    segment: "/routing/dhcp-relay",    icon: Forward },
      { id: "bgp",           label: "BGP",           segment: "/routing/bgp",           icon: Share2 },
      { id: "ospf",          label: "OSPF",          segment: "/routing/ospf",          icon: Waypoints },
      { id: "isis",          label: "IS-IS",         segment: "/routing/isis",          icon: Spline },
      { id: "bfd",           label: "BFD",           segment: "/routing/bfd",           icon: HeartPulse },
      { id: "vxlan-evpn",    label: "VXLAN / EVPN",  segment: "/routing/vxlan-evpn",    icon: Layers },
      { id: "policy",        label: "Policy",        segment: "/routing/policy",        icon: Filter },
    ],
  },
  {
    id: "qos",
    label: "QoS",
    icon: Gauge,
    segment: "/qos",
    children: [
      { id: "dscp-maps", label: "DSCP Maps",  segment: "/qos/dscp-maps", icon: Table2 },
      { id: "ports",     label: "Port Trust", segment: "/qos/ports",     icon: SlidersHorizontal },
    ],
  },
  {
    id: "security",
    label: "Security",
    icon: Shield,
    segment: "/security",
    children: [
      { id: "acls", label: "ACLs", segment: "/security/acls", icon: ListOrdered },
      { id: "aaa",  label: "AAA",  segment: "/security/aaa",  icon: KeyRound },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Settings,
    segment: "/system",
    children: [
      { id: "general",     label: "General",     segment: "/system/general",     icon: SlidersHorizontal },
      { id: "management",  label: "Management",  segment: "/system/management",  icon: EthernetPort },
      { id: "users",       label: "Users",       segment: "/system/users",       icon: Users },
      { id: "snmp",        label: "SNMP",        segment: "/system/snmp",        icon: Cast },
      { id: "maintenance", label: "Maintenance", segment: "/system/maintenance", icon: Wrench },
    ],
  },
];

/// Secondary navigation for a device's Configure section — the same groups,
/// icons, and expand/collapse behaviour as the QuartzFire local UI sidebar.
/// The groups depend on the routed device's product line: QuartzFire
/// firewalls get the full firewall tree, QuartzSONiC switches the Switching
/// tree. Until the org device list has loaded the nav renders empty rather
/// than flashing the wrong product's sections.
export function DeviceConfigNav() {
  const pathname = (usePathname() ?? "/").replace(/\/+$/, "") || "/";
  const params = useParams<{ organization_guid: string; sub_guid: string; device_id: string }>();
  const base = `/cloud/${params.organization_guid}/orgs/${params.sub_guid}/devices/${params.device_id}/configure`;

  const { devices } = useCloudOrg();
  const device = devices?.find((d) => d.device_id === params.device_id);
  const groups = devices === null ? [] : device?.product === "quartzsonic" ? SONIC_GROUPS : GROUPS;

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
        {groups.map((group) => {
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
