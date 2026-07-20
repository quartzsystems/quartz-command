"use client";

import { useState } from "react";
import { ArrowRightLeft, FolderInput, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import { AddDeviceModal } from "@/components/AddDeviceModal";
import { AllocateDeviceModal } from "@/components/inventory/AllocateDeviceModal";
import { allocateDevice, revokeDevice, type Device } from "@/lib/api";
import {
  allocatedToColumn,
  ConfirmAction,
  deviceColumns,
  InventoryHeader,
  InventoryStatus,
  useInventoryData,
} from "@/components/inventory/common";

/// Inventory → QuartzFire → Allocated / Unallocated.
///
/// Organization level: Unallocated is the top-level pool where devices are
/// added (the "Add device" token flow lives here) and then allocated out;
/// Allocated shows every device that sits in a sub-organization, with actions
/// to move it to another sub-org or deallocate it back to the pool.
///
/// Sub-organization level: Allocated is this sub-org's fleet (deallocate /
/// move away); Unallocated shows only unallocated devices that enrolled via
/// one of *this* sub-organization's tokens — never the parent's pool — with a
/// one-click "allocate here", and its "Add device" issues a token that
/// enrolls devices straight into this sub-organization.
export function DevicesView({ mode }: { mode: "allocated" | "unallocated" }) {
  const { orgGuid, subGuid, org, sub, subs, scopeName, devices, tokens, status, errorMsg, load } =
    useInventoryData();
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [allocating, setAllocating] = useState<Device | null>(null);

  const ready = status === "ready" && devices;

  // Sub-level Unallocated shows only devices that came in via this sub-org's
  // own tokens (e.g. enrolled then deallocated by the parent) — the parent's
  // pool is not this sub-organization's business.
  const subTokenIds = new Set(
    (tokens ?? []).filter((t) => t.sub_org_id === subGuid).map((t) => t.token_id),
  );
  const rows = ready
    ? mode === "allocated"
      ? subGuid
        ? devices.filter((d) => d.sub_org_id === subGuid)
        : devices.filter((d) => d.sub_org_id != null)
      : subGuid
        ? devices.filter(
            (d) =>
              d.sub_org_id == null &&
              d.enrolled_via_token != null &&
              subTokenIds.has(d.enrolled_via_token),
          )
        : devices.filter((d) => d.sub_org_id == null)
    : [];

  const columns =
    mode === "allocated" && !subGuid
      ? [...deviceColumns.slice(0, 2), allocatedToColumn, ...deviceColumns.slice(2)]
      : deviceColumns;

  const doRevoke = async (d: Device) => {
    try {
      await revokeDevice(orgGuid, d.device_id);
      setToast(`Revoked device ${d.device_id}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to revoke device ${d.device_id}.`);
    }
  };

  /// One-click "allocate to this sub-org" on the sub-level Unallocated view.
  const allocateHere = async (d: Device) => {
    if (!subGuid) return;
    try {
      await allocateDevice(orgGuid, d.device_id, subGuid);
      setToast(`Allocated ${d.device_id} to ${sub?.name ?? "this sub-organization"}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to allocate ${d.device_id}.`);
    }
  };

  const blurb =
    mode === "allocated"
      ? subGuid
        ? `QuartzFire devices allocated to ${sub?.name ?? "this sub-organization"}.`
        : "QuartzFire devices allocated to a sub-organization. Move them between sub-organizations or deallocate them back to the top-level pool."
      : subGuid
        ? `Unallocated devices enrolled with ${sub?.name ?? "this sub-organization"}'s tokens. Add a device to enroll it straight into ${sub?.name ?? "this sub-organization"}.`
        : "Devices in the top-level pool. Add new devices here, then allocate them to a sub-organization.";

  const emptyMessage =
    mode === "allocated"
      ? subGuid
        ? "No devices allocated to this sub-organization yet."
        : "No devices are allocated to a sub-organization yet."
      : subGuid
        ? "No devices waiting here. “Add device” enrolls a new QuartzFire into this sub-organization."
        : "No unallocated devices. “Add device” enrolls a new QuartzFire.";

  return (
    <div className="p-6 flex flex-col gap-6">
      <InventoryHeader
        title={mode === "allocated" ? "Allocated" : "Unallocated"}
        scopeName={scopeName}
      />

      {status !== "ready" && (
        <InventoryStatus status={status} errorMsg={errorMsg} onRetry={() => load()} />
      )}

      {ready && (
        <section className="flex flex-col gap-3">
          <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
            {blurb}
          </p>
          <DataTable
            rows={rows}
            columns={columns}
            rowId={(r) => r.device_id}
            storageKey={`${subGuid ? "sub" : "org"}-devices-${mode}`}
            searchPlaceholder="Search devices…"
            emptyMessage={emptyMessage}
            onRefresh={() => load("refresh")}
            toolbar={
              mode === "unallocated" ? (
                <Button kind="primary" size="sm" icon={Plus} onClick={() => setAdding(true)}>
                  Add device
                </Button>
              ) : undefined
            }
            actions={(row) => (
              <div className="inline-flex items-center gap-1 justify-end">
                {row.state !== "revoked" &&
                  (mode === "unallocated" && subGuid ? (
                    <button
                      type="button"
                      title={`Allocate ${row.device_id} to ${sub?.name ?? "this sub-organization"}`}
                      aria-label={`Allocate ${row.device_id} here`}
                      onClick={() => allocateHere(row)}
                      className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                    >
                      <FolderInput size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      title={
                        mode === "allocated"
                          ? `Move or deallocate ${row.device_id}`
                          : `Allocate ${row.device_id}`
                      }
                      aria-label={`Allocate ${row.device_id}`}
                      onClick={() => setAllocating(row)}
                      className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                    >
                      <ArrowRightLeft size={14} />
                    </button>
                  ))}
                {row.state !== "revoked" && (
                  <ConfirmAction
                    label={`Revoke device ${row.device_id}`}
                    onConfirm={() => doRevoke(row)}
                  />
                )}
              </div>
            )}
          />
        </section>
      )}

      {adding && (
        <AddDeviceModal
          orgGuid={orgGuid}
          orgName={org?.name}
          subOrgId={subGuid}
          subOrgName={sub?.name}
          onClose={() => {
            setAdding(false);
            load("refresh");
          }}
          onSaved={(msg) => {
            // Keep the modal open — it is showing the one-time token string.
            setToast(msg);
          }}
        />
      )}

      {allocating && (
        <AllocateDeviceModal
          orgGuid={orgGuid}
          device={allocating}
          subs={subs ?? []}
          onClose={() => setAllocating(null)}
          onDone={(msg) => {
            setAllocating(null);
            setToast(msg);
            load("refresh");
          }}
        />
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
