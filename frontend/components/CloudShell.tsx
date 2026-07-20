"use client";

import {
  Activity,
  Boxes,
  Building2,
  ChevronRight,
  Flame,
  Gauge,
  LayoutDashboard,
  LogOut,
  LucideIcon,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Toast } from "@/components/dashboard/Toast";
import { SubOrgFormModal } from "@/components/SubOrgFormModal";
import * as api from "@/lib/api";
import type { AuthUserInfo, Device, MemberOrganization, SubOrganization } from "@/lib/api";

/// Org-scoped data the shell fetches once and every console page can consume.
interface CloudOrgContextValue {
  orgGuid: string;
  org: MemberOrganization | null;
  subs: SubOrganization[] | null;
  refreshSubs: () => void;
  /** Org-wide device list backing the sidebar's per-sub-org dropdowns. */
  devices: Device[] | null;
  /** Re-fetch the sidebar device list (call after allocation changes). */
  refreshDevices: () => void;
  /** Open the "create sub-organization" modal (same one as the sidebar +). */
  openCreateSub: () => void;
}

const CloudOrgContext = createContext<CloudOrgContextValue | null>(null);

export function useCloudOrg(): CloudOrgContextValue {
  const ctx = useContext(CloudOrgContext);
  if (!ctx) throw new Error("useCloudOrg must be used inside CloudShell");
  return ctx;
}

/// Top-header sections of the cloud console. Dashboard is the org overview
/// (plus its sub-organization pages); the rest are their own routes.
interface HeaderItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Path under /cloud/{guid}; "" is the overview. */
  segment: string;
}

const HEADER_ITEMS: HeaderItem[] = [
  { id: "dashboard",      label: "Dashboard",      icon: Gauge,             segment: "" },
  { id: "monitor",        label: "Monitor",        icon: Activity,          segment: "/monitor" },
  { id: "configure",      label: "Configure",      icon: SlidersHorizontal, segment: "/configure" },
  { id: "inventory",      label: "Inventory",      icon: Boxes,             segment: "/inventory" },
  { id: "administration", label: "Administration", icon: ShieldCheck,       segment: "/administration" },
];

/// Avatar initials: first letters of the full name's words when configured
/// ("Cody Wellman" → "CW"), otherwise the first two letters of the email.
function userInitials(user: AuthUserInfo): string {
  const words = (user.full_name ?? "").split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return (words[0] ?? user.email).slice(0, 2).toUpperCase();
}

/// The cloud console chrome — the QuartzFire dashboard shell for the user
/// realm. One seamless top row (brand flowing into the section header, no
/// divider between them), an Organization Manager sidebar underneath, and the
/// scrollable main pane. Auth is already enforced by the (console) layout.
export function CloudShell({
  orgGuid,
  children,
}: {
  orgGuid: string;
  children: React.ReactNode;
}) {
  const pathname = (usePathname() ?? "/").replace(/\/+$/, "") || "/";
  const router = useRouter();
  const base = `/cloud/${orgGuid}`;

  // When a sub-organization is selected in the sidebar, the top tabs scope to
  // it: they navigate within /cloud/{org}/orgs/{sub} instead of the parent.
  // Selecting a device inside a sub-org narrows them one level further, to
  // /cloud/{org}/orgs/{sub}/devices/{device}.
  const routeParams = useParams<{ sub_guid?: string; device_id?: string }>();
  const subGuid = routeParams.sub_guid;
  const deviceId = routeParams.device_id;
  const tabBase = subGuid
    ? deviceId
      ? `${base}/orgs/${subGuid}/devices/${deviceId}`
      : `${base}/orgs/${subGuid}`
    : base;

  const [user, setUser] = useState<AuthUserInfo | null>(null);
  const [org, setOrg] = useState<MemberOrganization | null>(null);
  const [subs, setSubs] = useState<SubOrganization[] | null>(null);
  const [orgError, setOrgError] = useState("");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState("");

  // localStorage is unavailable during SSR/prerender — read it after mount.
  useEffect(() => {
    setUser(api.getCurrentUser());
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getOrganization(orgGuid)
      .then((o) => !cancelled && setOrg(o))
      .catch((err) => {
        if (cancelled) return;
        setOrgError(
          err instanceof api.ApiError && err.status === 403
            ? "You don't have access to this organization."
            : err?.message ?? "Failed to load organization."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [orgGuid]);

  const refreshSubs = useCallback(() => {
    api
      .listSubOrganizations(orgGuid)
      .then(setSubs)
      .catch(() => setSubs((prev) => prev ?? []));
  }, [orgGuid]);

  useEffect(() => {
    setSubs(null);
    refreshSubs();
  }, [refreshSubs]);

  // Devices back the sidebar's per-sub-org dropdowns (allocated firewalls by
  // hostname). Inventory views call refreshDevices after allocation changes.
  const [devices, setDevices] = useState<Device[] | null>(null);
  const refreshDevices = useCallback(() => {
    api
      .listDevices(orgGuid)
      .then(setDevices)
      .catch(() => setDevices((prev) => prev ?? []));
  }, [orgGuid]);

  useEffect(() => {
    setDevices(null);
    refreshDevices();
  }, [refreshDevices]);

  // Which sub-org dropdowns are open. Navigating to a device keeps its
  // sub-org expanded so the active item is never hidden.
  const [openSubs, setOpenSubs] = useState<Set<string>>(new Set());
  useEffect(() => {
    const m = pathname.match(/\/orgs\/([^/]+)\/devices\//);
    if (m) {
      setOpenSubs((prev) => {
        if (prev.has(m[1])) return prev;
        const next = new Set(prev);
        next.add(m[1]);
        return next;
      });
    }
  }, [pathname]);

  const toggleSub = (id: string) =>
    setOpenSubs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const logout = async () => {
    await api.logout();
    router.replace("/login");
  };

  const filteredSubs = (subs ?? []).filter((s) => {
    const q = query.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q);
  });

  const headerActive = (item: HeaderItem) =>
    item.segment === ""
      ? !HEADER_ITEMS.some((h) => h.segment !== "" && pathname.startsWith(tabBase + h.segment))
      : pathname.startsWith(tabBase + item.segment);

  const sideItemClass = (active: boolean) =>
    [
      "flex items-center gap-[10px] px-[10px] py-[8px] rounded-md text-[13.5px] font-medium border transition-all duration-[120ms] no-underline w-full text-left cursor-pointer",
      active
        ? "bg-[var(--qz-accent-soft)] text-[var(--qz-accent)] border-[color-mix(in_oklab,var(--qz-accent)_30%,transparent)]"
        : "text-[var(--qz-fg-3)] border-transparent hover:text-[var(--qz-fg-1)] hover:bg-[color-mix(in_oklab,white_4%,transparent)]",
    ].join(" ");

  if (orgError) {
    return (
      <div className="h-screen grid place-items-center" style={{ background: "var(--qz-bg)" }}>
        <div className="surface p-8 max-w-[420px] flex flex-col gap-3">
          <p className="text-[13px] m-0" style={{ color: "var(--qz-danger)" }}>
            {orgError}
          </p>
          <Link
            href="/cloud"
            className="text-[13px] font-semibold no-underline"
            style={{ color: "var(--qz-accent)" }}
          >
            ← Back to your organizations
          </Link>
        </div>
      </div>
    );
  }

  return (
    <CloudOrgContext.Provider
      value={{
        orgGuid,
        org,
        subs,
        refreshSubs,
        devices,
        refreshDevices,
        openCreateSub: () => setCreating(true),
      }}
    >
      <div
        className="h-screen overflow-hidden"
        style={{
          display: "grid",
          gridTemplateColumns: "240px 1fr",
          gridTemplateRows: "56px minmax(0, 1fr)",
        }}
      >
        {/* Top row: brand + section header as one seamless bar (no divider
            between the logo block and the header nav). */}
        <header
          className="flex items-center"
          style={{
            gridColumn: "1 / -1",
            borderBottom: "1px solid var(--qz-border)",
            background: "var(--qz-ink-0)",
          }}
        >
          <Link
            href="/cloud"
            className="flex items-center gap-[10px] px-4 h-full flex-shrink-0 no-underline w-[240px]"
          >
            <img src="/logo-mark.png" alt="Quartz Systems" className="w-7 h-7 flex-shrink-0" />
            <span
              className="font-bold text-[var(--qz-fg-1)] text-[15px]"
              style={{ letterSpacing: "-0.01em" }}
            >
              Quartz Command
            </span>
          </Link>

          <nav className="flex items-stretch h-full flex-1 min-w-0">
            {HEADER_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = headerActive(item);
              return (
                <Link
                  key={item.id}
                  href={tabBase + item.segment}
                  className={[
                    "flex items-center gap-[7px] px-[14px] text-[13px] font-medium no-underline transition-colors duration-[120ms]",
                    active
                      ? "text-[var(--qz-fg-1)]"
                      : "text-[var(--qz-fg-3)] hover:text-[var(--qz-fg-1)]",
                  ].join(" ")}
                  style={{
                    borderBottom: active
                      ? "2px solid var(--qz-accent)"
                      : "2px solid transparent",
                    // Keep the label vertically centred despite the indicator.
                    borderTop: "2px solid transparent",
                  }}
                >
                  <Icon size={15} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {org && (
            <span
              className="px-4 text-[12px] truncate max-w-[220px] flex-shrink-0"
              style={{ color: "var(--qz-fg-4)" }}
              title={org.name}
            >
              {org.name}
            </span>
          )}
        </header>

        {/* Sidebar: Organization Manager */}
        <aside
          className="flex flex-col h-full min-h-0"
          style={{
            borderRight: "1px solid var(--qz-border)",
            background: "var(--qz-ink-0)",
          }}
        >
          <div className="px-3 pt-4 flex flex-col gap-3 flex-shrink-0">
            <div className="flex items-center justify-between px-[2px]">
              <span
                className="text-[11px] font-semibold uppercase"
                style={{
                  color: "var(--qz-fg-3)",
                  fontFamily: "var(--qz-font-mono)",
                  letterSpacing: "0.08em",
                }}
              >
                Organization Manager
              </span>
              <button
                type="button"
                title="Create sub-organization"
                aria-label="Create sub-organization"
                onClick={() => setCreating(true)}
                className="w-6 h-6 rounded-md grid place-items-center bg-transparent text-[var(--qz-fg-3)] border border-transparent hover:bg-[var(--qz-surface)] hover:text-[var(--qz-fg-1)] hover:border-[var(--qz-border)] transition-all duration-[120ms] cursor-pointer"
              >
                <Plus size={15} />
              </button>
            </div>

            <div className="relative">
              <Search
                size={14}
                className="absolute left-[10px] top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: "var(--qz-fg-4)" }}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search organizations"
                className="w-full rounded-md pl-8 pr-3 py-[7px] text-[12.5px] text-[var(--qz-fg-1)] outline-none"
                style={{ background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--qz-accent)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--qz-border)")}
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto px-3 flex flex-col gap-[2px] pt-3">
            <Link href={base} className={sideItemClass(pathname === base)}>
              <LayoutDashboard size={16} />
              <span>Overview</span>
            </Link>

            {filteredSubs.map((sub) => {
              const href = `${base}/orgs/${sub.id}`;
              const deviceBase = `${href}/devices/`;
              const subDevices = (devices ?? [])
                .filter((d) => d.sub_org_id === sub.id && d.state !== "revoked")
                .sort((a, b) => (a.hostname ?? a.device_id).localeCompare(b.hostname ?? b.device_id));
              const open = openSubs.has(sub.id);
              // The sub row yields its highlight to the device row when a
              // device inside it is the active scope.
              const subActive = pathname.startsWith(href) && !pathname.startsWith(deviceBase);
              return (
                <div key={sub.id} className="flex flex-col gap-[2px]">
                  <Link href={href} className={sideItemClass(subActive)}>
                    <Building2 size={15} className="flex-shrink-0" />
                    <span className="truncate">{sub.name}</span>
                    {subDevices.length > 0 && (
                      <button
                        type="button"
                        title={open ? "Collapse devices" : "Expand devices"}
                        aria-label={open ? "Collapse devices" : "Expand devices"}
                        aria-expanded={open}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleSub(sub.id);
                        }}
                        className="ml-auto grid place-items-center w-5 h-5 rounded flex-shrink-0 bg-transparent border-0 cursor-pointer text-[var(--qz-fg-4)] hover:text-[var(--qz-fg-1)]"
                      >
                        <ChevronRight
                          size={14}
                          className="transition-transform duration-[120ms]"
                          style={{ transform: open ? "rotate(90deg)" : undefined }}
                        />
                      </button>
                    )}
                  </Link>
                  {open &&
                    subDevices.map((d) => {
                      const deviceHref = `${deviceBase}${d.device_id}`;
                      return (
                        <Link
                          key={d.device_id}
                          href={deviceHref}
                          title={d.hostname ?? d.device_id}
                          className={[
                            "flex items-center gap-[8px] pl-[30px] pr-[10px] py-[6px] rounded-md text-[12.5px] font-medium border transition-all duration-[120ms] no-underline w-full text-left cursor-pointer",
                            pathname.startsWith(deviceHref)
                              ? "bg-[var(--qz-accent-soft)] text-[var(--qz-accent)] border-[color-mix(in_oklab,var(--qz-accent)_30%,transparent)]"
                              : "text-[var(--qz-fg-3)] border-transparent hover:text-[var(--qz-fg-1)] hover:bg-[color-mix(in_oklab,white_4%,transparent)]",
                          ].join(" ")}
                        >
                          <Flame size={13} className="flex-shrink-0" />
                          <span className="truncate">{d.hostname ?? d.device_id}</span>
                        </Link>
                      );
                    })}
                </div>
              );
            })}

            {subs !== null && subs.length === 0 && (
              <p className="text-[11.5px] m-0 px-[10px] pt-2" style={{ color: "var(--qz-fg-4)" }}>
                No sub-organizations yet.
              </p>
            )}
            {subs !== null && subs.length > 0 && filteredSubs.length === 0 && (
              <p className="text-[11.5px] m-0 px-[10px] pt-2" style={{ color: "var(--qz-fg-4)" }}>
                No matches.
              </p>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex-shrink-0 px-4 py-3 flex items-center gap-[10px]"
            style={{ borderTop: "1px solid var(--qz-border)" }}
          >
            <div
              className="w-7 h-7 rounded-full grid place-items-center text-[var(--qz-fg-on-accent)] font-bold text-xs flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, var(--qz-green-700), var(--qz-green-500))",
              }}
            >
              {user ? userInitials(user) : "…"}
            </div>
            <div className="flex-1 min-w-0 flex flex-col">
              <span className="text-[var(--qz-fg-1)] font-semibold text-[13px] truncate leading-tight">
                {user ? user.full_name || user.email : ""}
              </span>
              {user?.full_name && (
                <span className="text-[var(--qz-fg-4)] text-[11px] truncate leading-tight">
                  {user.email}
                </span>
              )}
            </div>
            <button
              type="button"
              title="Log out"
              onClick={logout}
              className="flex-shrink-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-fg-1)] transition-colors cursor-pointer bg-transparent border-0 p-0"
            >
              <LogOut size={15} />
            </button>
          </div>
        </aside>

        <main className="overflow-auto" style={{ background: "var(--qz-bg)" }}>
          {children}
        </main>
      </div>

      {creating && (
        <SubOrgFormModal
          orgGuid={orgGuid}
          orgName={org?.name}
          onClose={() => setCreating(false)}
          onSaved={(message, sub) => {
            setCreating(false);
            setToast(message);
            refreshSubs();
            router.push(`${base}/orgs/${sub.id}`);
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </CloudOrgContext.Provider>
  );
}
