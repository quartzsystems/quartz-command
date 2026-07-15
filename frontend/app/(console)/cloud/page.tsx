"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { listOrganizations, logout, type MemberOrganization } from "@/lib/api";

/// The org picker. Lists the organizations the signed-in user belongs to; a
/// single org redirects straight into it. The eventual per-org dashboard lives
/// at /cloud/{organization_guid}.
export default function CloudPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<MemberOrganization[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listOrganizations()
      .then((list) => {
        if (cancelled) return;
        if (list.length === 1) {
          router.replace(`/cloud/${list[0].id}`);
        } else {
          setOrgs(list);
        }
      })
      .catch((err) => !cancelled && setError(err?.message ?? "Failed to load organizations."));
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-[520px] flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-mark.png" alt="Quartz Systems" className="w-8 h-8" />
            <h1
              className="text-[20px] font-bold text-[var(--qz-fg-1)] m-0"
              style={{ letterSpacing: "-0.02em" }}
            >
              Your organizations
            </h1>
          </div>
          <button
            onClick={handleLogout}
            className="text-[12px] cursor-pointer bg-transparent border-0"
            style={{ color: "var(--qz-fg-4)" }}
          >
            Sign out
          </button>
        </div>

        {error && (
          <p className="text-[13px] m-0" style={{ color: "var(--qz-danger)" }}>
            {error}
          </p>
        )}

        {orgs === null && !error && (
          <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-4)" }}>
            Loading…
          </p>
        )}

        {orgs?.length === 0 && (
          <div className="surface p-6">
            <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
              You are not a member of any organization yet.
            </p>
          </div>
        )}

        {orgs && orgs.length > 0 && (
          <div className="flex flex-col gap-2">
            {orgs.map((org) => (
              <Link
                key={org.id}
                href={`/cloud/${org.id}`}
                className="surface p-4 flex items-center justify-between no-underline transition-colors"
                style={{ color: "var(--qz-fg-1)" }}
              >
                <div className="flex flex-col gap-1">
                  <span className="text-[14px] font-semibold">{org.name}</span>
                  <span
                    className="text-[11px]"
                    style={{ color: "var(--qz-fg-4)", fontFamily: "var(--qz-font-mono)" }}
                  >
                    {org.slug}
                  </span>
                </div>
                <span className="badge badge-muted">{org.role}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
