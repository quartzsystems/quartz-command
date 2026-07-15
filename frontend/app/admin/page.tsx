"use client";

import { useRouter } from "next/navigation";
import { RealmGuard } from "@/components/RealmGuard";
import * as adminApi from "@/lib/adminApi";

/// Admin dashboard shell. Guarded inline (rather than via an app/admin layout)
/// so the guard does NOT wrap the sibling /admin/login page. Real admin content
/// is a follow-up.
export default function AdminPage() {
  const router = useRouter();

  const handleLogout = async () => {
    await adminApi.logout();
    router.replace("/admin/login");
  };

  return (
    <RealmGuard
      client={adminApi}
      loginPath="/admin/login"
      offlineLabel="Cannot reach the Quartz Command backend. It may be restarting."
    >
      <div className="min-h-screen p-6 flex flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-mark.png" alt="Quartz Systems" className="w-8 h-8" />
            <h1 className="text-[18px] font-bold text-[var(--qz-fg-1)] m-0">Command Admin</h1>
            <span className="badge badge-crit">admin</span>
          </div>
          <button
            onClick={handleLogout}
            className="text-[12px] cursor-pointer bg-transparent border-0"
            style={{ color: "var(--qz-fg-4)" }}
          >
            Sign out
          </button>
        </header>

        <div className="surface p-8 flex flex-col gap-2">
          <h2 className="text-[16px] font-semibold text-[var(--qz-fg-1)] m-0">
            Administration console
          </h2>
          <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
            This is the admin dashboard shell. Platform-wide management (users,
            organizations, admins) will live here.
          </p>
        </div>
      </div>
    </RealmGuard>
  );
}
