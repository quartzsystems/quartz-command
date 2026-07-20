"use client";

import { useState } from "react";
import { DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import { revokeEnrollmentToken, type EnrollmentToken } from "@/lib/api";
import {
  buildTokenColumns,
  ConfirmAction,
  InventoryHeader,
  InventoryStatus,
  tokenStatus,
  useInventoryData,
} from "@/components/inventory/common";

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface p-4 flex flex-col gap-1 flex-1 min-w-[140px]">
      <span className="text-[12px]" style={{ color: "var(--qz-fg-3)" }}>
        {label}
      </span>
      <span
        className="text-[26px] font-bold text-[var(--qz-fg-1)] leading-none"
        style={{ letterSpacing: "-0.02em" }}
      >
        {value}
      </span>
    </div>
  );
}

/// Inventory → Summary: headline counts plus the enrollment-token list. At the
/// organization level it covers the whole fleet; under a sub-organization it
/// scopes to devices allocated there and tokens that enroll into it.
export function SummaryView() {
  const { orgGuid, subGuid, scopeName, devices, tokens, status, errorMsg, load } =
    useInventoryData();
  const [toast, setToast] = useState<string | null>(null);

  const doRevokeToken = async (t: EnrollmentToken) => {
    try {
      await revokeEnrollmentToken(orgGuid, t.token_id);
      setToast(`Revoked token ${t.token_id}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to revoke token ${t.token_id}.`);
    }
  };

  const ready = status === "ready" && devices && tokens;

  const scopedDevices = ready
    ? subGuid
      ? devices.filter((d) => d.sub_org_id === subGuid)
      : devices
    : [];
  const scopedTokens = ready
    ? subGuid
      ? tokens.filter((t) => t.sub_org_id === subGuid)
      : tokens
    : [];
  const unallocated = ready ? devices.filter((d) => !d.sub_org_id).length : 0;
  const activeTokens = scopedTokens.filter((t) => tokenStatus(t) === "active").length;

  return (
    <div className="p-6 flex flex-col gap-6">
      <InventoryHeader title="Summary" scopeName={scopeName} />

      {status !== "ready" && (
        <InventoryStatus status={status} errorMsg={errorMsg} onRetry={() => load()} />
      )}

      {ready && (
        <>
          <div className="flex gap-3 flex-wrap">
            <StatTile label="Devices" value={scopedDevices.length} />
            {subGuid ? (
              <StatTile label="Available in pool" value={unallocated} />
            ) : (
              <>
                <StatTile label="Allocated" value={scopedDevices.length - unallocated} />
                <StatTile label="Unallocated" value={unallocated} />
              </>
            )}
            <StatTile label="Active tokens" value={activeTokens} />
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="text-[15px] font-semibold text-[var(--qz-fg-1)] m-0">
              Enrollment tokens
            </h2>
            <DataTable
              rows={scopedTokens}
              columns={buildTokenColumns({ showScope: !subGuid })}
              rowId={(r) => r.token_id}
              storageKey={subGuid ? "sub-enroll-tokens" : "org-enroll-tokens"}
              searchPlaceholder="Search tokens…"
              emptyMessage="No enrollment tokens. “Add device” on the Unallocated view creates one."
              onRefresh={() => load("refresh")}
              actions={(row) =>
                tokenStatus(row) === "active" ? (
                  <ConfirmAction
                    label={`Revoke token ${row.token_id}`}
                    onConfirm={() => doRevokeToken(row)}
                  />
                ) : null
              }
            />
          </section>
        </>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
