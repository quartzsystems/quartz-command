"use client";

import { useState } from "react";
import { ArrowRightLeft, FolderInput, FolderTree, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import { AddDeviceModal } from "@/components/AddDeviceModal";
import { AllocateDeviceModal } from "@/components/inventory/AllocateDeviceModal";
import { FolderFormModal } from "@/components/FolderFormModal";
import { MoveDeviceFolderModal } from "@/components/inventory/MoveDeviceFolderModal";
import {
  allocateDevice,
  deleteFolder,
  revokeDevice,
  type Device,
  type DeviceFolder,
  type Product,
} from "@/lib/api";
import {
  allocatedToColumn,
  ConfirmAction,
  deviceColumns,
  InventoryHeader,
  InventoryStatus,
  PRODUCT_LABEL,
  useInventoryData,
} from "@/components/inventory/common";

/// Inventory → QuartzFire / QuartzSONiC → Allocated / Unallocated. One view
/// per product line — `product` scopes the org-wide device list and the "Add
/// device" token flow to that product.
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
export function DevicesView({
  mode,
  product,
}: {
  mode: "allocated" | "unallocated";
  product: Product;
}) {
  const { orgGuid, subGuid, org, sub, subs, scopeName, devices, tokens, folders, status, errorMsg, load } =
    useInventoryData();
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [allocating, setAllocating] = useState<Device | null>(null);
  const [foldering, setFoldering] = useState<Device | null>(null);
  // The folder modal: `null` closed, `{}` create, `{ folder }` rename.
  const [folderForm, setFolderForm] = useState<{ folder?: DeviceFolder } | null>(null);

  // Folders only apply to a sub-organization's allocated fleet.
  const showFolders = mode === "allocated" && !!subGuid;

  const ready = status === "ready" && devices;
  const productLabel = PRODUCT_LABEL[product];
  const productDevices = ready ? devices.filter((d) => d.product === product) : [];

  // Sub-level Unallocated shows only devices that came in via this sub-org's
  // own tokens (e.g. enrolled then deallocated by the parent) — the parent's
  // pool is not this sub-organization's business.
  const subTokenIds = new Set(
    (tokens ?? []).filter((t) => t.sub_org_id === subGuid).map((t) => t.token_id),
  );
  const rows =
    mode === "allocated"
      ? subGuid
        ? productDevices.filter((d) => d.sub_org_id === subGuid)
        : productDevices.filter((d) => d.sub_org_id != null)
      : subGuid
        ? productDevices.filter(
            (d) =>
              d.sub_org_id == null &&
              d.enrolled_via_token != null &&
              subTokenIds.has(d.enrolled_via_token),
          )
        : productDevices.filter((d) => d.sub_org_id == null);

  const folderColumn: Column<Device> = {
    key: "folder",
    header: "Folder",
    value: (r) => r.folder_name ?? "Ungrouped",
    render: (r) =>
      r.folder_name ? (
        r.folder_name
      ) : (
        <span style={{ color: "var(--qz-fg-4)" }}>Ungrouped</span>
      ),
    sortable: true,
    width: 160,
  };

  const columns =
    mode === "allocated" && !subGuid
      ? [...deviceColumns.slice(0, 2), allocatedToColumn, ...deviceColumns.slice(2)]
      : showFolders
        ? [...deviceColumns.slice(0, 2), folderColumn, ...deviceColumns.slice(2)]
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

  const doDeleteFolder = async (f: DeviceFolder) => {
    if (!subGuid) return;
    try {
      await deleteFolder(orgGuid, subGuid, f.id);
      setToast(`Deleted folder ${f.name}. Its devices are now ungrouped.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete folder ${f.name}.`);
    }
  };

  const blurb =
    mode === "allocated"
      ? subGuid
        ? `${productLabel} devices allocated to ${sub?.name ?? "this sub-organization"}.`
        : `${productLabel} devices allocated to a sub-organization. Move them between sub-organizations or deallocate them back to the top-level pool.`
      : subGuid
        ? `Unallocated ${productLabel} devices enrolled with ${sub?.name ?? "this sub-organization"}'s tokens. Add a device to enroll it straight into ${sub?.name ?? "this sub-organization"}.`
        : `${productLabel} devices in the top-level pool. Add new devices here, then allocate them to a sub-organization.`;

  const emptyMessage =
    mode === "allocated"
      ? subGuid
        ? `No ${productLabel} devices allocated to this sub-organization yet.`
        : `No ${productLabel} devices are allocated to a sub-organization yet.`
      : subGuid
        ? `No devices waiting here. “Add device” enrolls a new ${productLabel} into this sub-organization.`
        : `No unallocated ${productLabel} devices. “Add device” enrolls a new ${productLabel}.`;

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

          {showFolders && (
            <div
              className="surface p-3 flex flex-col gap-2"
              style={{ borderRadius: "10px" }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[11px] font-semibold uppercase"
                  style={{
                    color: "var(--qz-fg-3)",
                    fontFamily: "var(--qz-font-mono)",
                    letterSpacing: "0.08em",
                  }}
                >
                  Folders
                </span>
                <Button
                  kind="secondary"
                  size="sm"
                  icon={Plus}
                  onClick={() => setFolderForm({})}
                >
                  New folder
                </Button>
              </div>
              {folders.length === 0 ? (
                <p className="text-[12px] m-0" style={{ color: "var(--qz-fg-4)" }}>
                  No folders yet. Create one to group these devices by location or branch.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {folders.map((f) => {
                    const count = rows.filter((d) => d.folder_id === f.id).length;
                    return (
                      <div
                        key={f.id}
                        className="inline-flex items-center gap-2 pl-3 pr-1 py-1 rounded-md"
                        style={{ background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" }}
                      >
                        <FolderTree size={13} className="flex-shrink-0 text-[var(--qz-fg-4)]" />
                        <span className="text-[12.5px] text-[var(--qz-fg-1)]">{f.name}</span>
                        <span className="text-[11px] tabular-nums" style={{ color: "var(--qz-fg-4)" }}>
                          {count}
                        </span>
                        <button
                          type="button"
                          title={`Rename ${f.name}`}
                          aria-label={`Rename folder ${f.name}`}
                          onClick={() => setFolderForm({ folder: f })}
                          className="grid place-items-center w-6 h-6 rounded bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] transition-colors cursor-pointer"
                        >
                          <Pencil size={12} />
                        </button>
                        <ConfirmAction
                          label={`Delete folder ${f.name}`}
                          onConfirm={() => doDeleteFolder(f)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <DataTable
            rows={rows}
            columns={columns}
            rowId={(r) => r.device_id}
            storageKey={`${subGuid ? "sub" : "org"}-devices-${product === "quartzsonic" ? "sonic-" : ""}${mode}`}
            searchPlaceholder="Search devices…"
            emptyMessage={emptyMessage}
            onRefresh={() => load("refresh")}
            actionsWidth={160}
            toolbar={
              mode === "unallocated" ? (
                <Button kind="primary" size="sm" icon={Plus} onClick={() => setAdding(true)}>
                  Add device
                </Button>
              ) : undefined
            }
            actions={(row) => (
              <div className="inline-flex items-center gap-1 justify-end">
                {row.state !== "revoked" && showFolders && (
                  <button
                    type="button"
                    title={`Move ${row.device_id} to a folder`}
                    aria-label={`Move ${row.device_id} to a folder`}
                    onClick={() => setFoldering(row)}
                    className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                  >
                    <FolderTree size={14} />
                  </button>
                )}
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
          product={product}
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

      {foldering && subGuid && (
        <MoveDeviceFolderModal
          orgGuid={orgGuid}
          device={foldering}
          folders={folders}
          onClose={() => setFoldering(null)}
          onDone={(msg) => {
            setFoldering(null);
            setToast(msg);
            load("refresh");
          }}
        />
      )}

      {folderForm && subGuid && (
        <FolderFormModal
          orgGuid={orgGuid}
          subGuid={subGuid}
          subName={sub?.name}
          folder={folderForm.folder}
          onClose={() => setFolderForm(null)}
          onSaved={(msg) => {
            setFolderForm(null);
            setToast(msg);
            load("refresh");
          }}
        />
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
