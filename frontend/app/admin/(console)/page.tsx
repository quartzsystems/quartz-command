"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fetchOverview, type AdminOverview } from "@/lib/adminApi";

/// One KPI tile (QuartzFire's kpi-card): mono uppercase label over a large
/// numeral. Counts, not a chart — text tokens only.
function Kpi({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="kpi-card flex-1 min-w-[180px]">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value === null ? "—" : value.toLocaleString()}</div>
    </div>
  );
}

/// Admin dashboard: platform-wide counts at a glance.
export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setOverview(await fetchOverview());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load the overview.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Dashboard
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Platform-wide view across all organizations and accounts
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "error" ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[13px] text-[var(--qz-danger)]">
              <AlertTriangle size={15} />
              {errorMsg}
            </div>
            <div>
              <Button kind="secondary" icon={RotateCw} onClick={load}>Retry</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex gap-4 flex-wrap">
              <Kpi label="Organizations" value={overview?.organizations ?? null} />
              <Kpi label="Users" value={overview?.users ?? null} />
              <Kpi label="Admins" value={overview?.admins ?? null} />
            </div>

            <div className="surface p-5 flex items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-semibold text-[var(--qz-fg-1)]">Organizations</span>
                <span className="text-[12.5px]" style={{ color: "var(--qz-fg-3)" }}>
                  Create organizations and manage the users inside them.
                </span>
              </div>
              <Link href="/admin/organizations" className="no-underline">
                <Button kind="secondary" size="sm" iconRight={ArrowRight}>Manage</Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
