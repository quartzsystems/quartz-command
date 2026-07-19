"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Pencil, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Tabs } from "@/components/ui/Tabs";
import { Toast } from "@/components/dashboard/Toast";
import { deleteAdmin, getCurrentUser, listAdmins, type AdminAccount } from "@/lib/adminApi";
import { AdminFormModal } from "./AdminFormModal";

const columns: Column<AdminAccount>[] = [
  { key: "email", header: "Email", value: (r) => r.email, mono: true, sortable: true },
  {
    key: "full_name",
    header: "Full Name",
    value: (r) => r.full_name ?? "",
    render: (r) => (r.full_name ? r.full_name : <span className="text-[var(--qz-fg-4)]">—</span>),
  },
  {
    key: "status",
    header: "Status",
    value: (r) => (r.is_active ? "active" : "inactive"),
    render: (r) =>
      r.is_active ? (
        <span className="badge badge-ok">Active</span>
      ) : (
        <span className="badge badge-crit">Inactive</span>
      ),
    width: 100,
  },
  {
    key: "created",
    header: "Created",
    value: (r) => r.created_at,
    render: (r) => new Date(r.created_at).toLocaleDateString(),
    sortable: true,
    width: 120,
  },
];

/// Admin console settings. Currently one tab: Users — the administrator
/// accounts for this console (the separate `admins` realm, not tenant users).
export default function AdminSettingsPage() {
  const [tab, setTab] = useState("users");
  const [admins, setAdmins] = useState<AdminAccount[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  // null = closed; { admin: undefined } = create; { admin } = edit.
  const [modal, setModal] = useState<{ admin?: AdminAccount } | null>(null);

  const currentId = getCurrentUser()?.id ?? null;

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setAdmins(await listAdmins());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load admin accounts.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (admin: AdminAccount) => {
    try {
      await deleteAdmin(admin.id);
      setToast(`Deleted admin ${admin.email}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete admin ${admin.email}.`);
    }
  };

  const activeCount = admins?.filter((a) => a.is_active).length ?? 0;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Settings
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Configuration of the admin console itself
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        <Tabs
          items={[{ value: "users", label: "Users", count: admins?.length }]}
          value={tab}
          onChange={setTab}
          className="mb-5"
        />

        {tab === "users" && (
          <>
            {status === "loading" && (
              <div className="text-[13px] text-[var(--qz-fg-4)]">Loading admin accounts…</div>
            )}
            {status === "error" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-[13px] text-[var(--qz-danger)]">
                  <AlertTriangle size={15} />
                  {errorMsg}
                </div>
                <div>
                  <Button kind="secondary" icon={RotateCw} onClick={load}>Retry</Button>
                </div>
              </div>
            )}
            {status === "ready" && admins && (
              <DataTable
                rows={admins}
                columns={columns}
                rowId={(r) => r.id}
                storageKey="admin-settings-users"
                searchPlaceholder="Search admins…"
                emptyMessage="No admin accounts."
                onRefresh={() => load("refresh")}
                toolbar={
                  <Button kind="primary" size="sm" icon={Plus} onClick={() => setModal({})}>
                    Create admin
                  </Button>
                }
                actions={(row) => {
                  // Deleting yourself would strand the session, and the last
                  // active admin would lock the console — guard both up front
                  // (the backend refuses them too).
                  const lastActive = row.is_active && activeCount === 1;
                  if (row.id === currentId || lastActive) {
                    return (
                      <div className="inline-flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title={`Edit admin ${row.email}`}
                          aria-label="Edit"
                          onClick={() => setModal({ admin: row })}
                          className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                        >
                          <Pencil size={14} />
                        </button>
                        <span
                          className="text-[11px] text-[var(--qz-fg-4)] px-1"
                          title={
                            row.id === currentId
                              ? "You can't delete the account you're signed in as."
                              : "The last active admin can't be deleted."
                          }
                        >
                          {row.id === currentId ? "you" : "last"}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <RowActions
                      label={`admin ${row.email}`}
                      onEdit={() => setModal({ admin: row })}
                      onDelete={() => remove(row)}
                    />
                  );
                }}
              />
            )}
          </>
        )}
      </div>

      {modal && (
        <AdminFormModal
          initial={modal.admin}
          isSelf={modal.admin?.id === currentId}
          onClose={() => setModal(null)}
          onSaved={(msg) => {
            setModal(null);
            setToast(msg);
            load("refresh");
          }}
        />
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
