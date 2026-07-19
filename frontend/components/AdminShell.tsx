"use client";

import { Gauge, Building2, LogOut, LucideIcon, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RealmGuard } from "@/components/RealmGuard";
import * as adminApi from "@/lib/adminApi";
import type { AuthUserInfo } from "@/lib/adminApi";

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
}

const ITEMS: NavItem[] = [
  { id: "overview",      label: "Dashboard",     icon: Gauge,     href: "/admin" },
  { id: "organizations", label: "Organizations", icon: Building2, href: "/admin/organizations" },
  { id: "settings",      label: "Settings",      icon: Settings,  href: "/admin/settings" },
];

/// Avatar initials: first letters of the full name's words when configured
/// ("Cody Wellman" → "CW"), otherwise the first two letters of the email.
function adminInitials(admin: AuthUserInfo): string {
  const words = (admin.full_name ?? "").split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return (words[0] ?? admin.email).slice(0, 2).toUpperCase();
}

/// The admin console sidebar — the QuartzFire dashboard sidebar with the admin
/// realm's brand, nav, and account footer.
function Sidebar() {
  const pathname = (usePathname() ?? "/").replace(/\/+$/, "") || "/";
  const router = useRouter();
  const [admin, setAdmin] = useState<AuthUserInfo | null>(null);

  // localStorage is unavailable during SSR/prerender — read it after mount.
  useEffect(() => {
    setAdmin(adminApi.getCurrentUser());
  }, []);

  const isActive = (href: string) =>
    href === "/admin" ? pathname === href : pathname.startsWith(href);

  const logout = async () => {
    await adminApi.logout();
    router.replace("/admin/login");
  };

  const itemClass = (active: boolean) =>
    [
      "flex items-center gap-[10px] px-[10px] py-[8px] rounded-md text-[13.5px] font-medium border transition-all duration-[120ms] no-underline w-full text-left cursor-pointer",
      active
        ? "bg-[var(--qz-accent-soft)] text-[var(--qz-accent)] border-[color-mix(in_oklab,var(--qz-accent)_30%,transparent)]"
        : "text-[var(--qz-fg-3)] border-transparent hover:text-[var(--qz-fg-1)] hover:bg-[color-mix(in_oklab,white_4%,transparent)]",
    ].join(" ");

  return (
    <aside
      className="flex flex-col h-full"
      style={{
        borderRight: "1px solid var(--qz-border)",
        background: "var(--qz-ink-0)",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-[10px] px-4 h-14 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--qz-border)" }}
      >
        <img src="/logo-mark.png" alt="Quartz Systems" className="w-7 h-7 flex-shrink-0" />
        <span
          className="font-bold text-[var(--qz-fg-1)] text-[15px]"
          style={{ letterSpacing: "-0.01em" }}
        >
          Quartz Command
        </span>
      </div>

      {/* Nav */}
      <div className="flex-1 min-h-0 overflow-auto px-3 flex flex-col gap-[2px] pt-3">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.id} href={item.href} className={itemClass(isActive(item.href))}>
              <Icon size={16} />
              <span>{item.label}</span>
            </Link>
          );
        })}
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
          {admin ? adminInitials(admin) : "…"}
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <span className="text-[var(--qz-fg-1)] font-semibold text-[13px] truncate leading-tight">
            {admin ? admin.full_name || admin.email : ""}
          </span>
          {admin?.full_name && (
            <span className="text-[var(--qz-fg-4)] text-[11px] truncate leading-tight">
              {admin.email}
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
  );
}

/// The admin console chrome: the QuartzFire dashboard shell (240px sidebar +
/// scrollable main pane) behind the admin-realm auth gate.
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <RealmGuard
      client={adminApi}
      loginPath="/admin/login"
      offlineLabel="Cannot reach the Quartz Command backend. It may be restarting."
    >
      <div
        className="h-screen overflow-hidden"
        style={{ display: "grid", gridTemplateColumns: "240px 1fr", gridTemplateRows: "minmax(0, 1fr)" }}
      >
        <Sidebar />
        <main className="overflow-auto" style={{ background: "var(--qz-bg)" }}>
          {children}
        </main>
      </div>
    </RealmGuard>
  );
}
