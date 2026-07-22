"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureReadOnlyNotice, FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import {
  SonicUser,
  SystemUsersDoc,
  deleteSystemUser,
  fetchSystemUsers,
} from "@/lib/device/sonic-system";
import { SonicUserFormModal } from "./SonicUserFormModal";

const columns: Column<SonicUser>[] = [
  { key: "name", header: "Username", value: (r) => r.name, mono: true, sortable: true, width: 180 },
  {
    key: "role",
    header: "Role",
    value: (r) => r.role,
    render: (r) =>
      r.role === "admin" ? (
        <span className="badge badge-info">Admin</span>
      ) : (
        <span className="badge badge-muted">Operator</span>
      ),
    sortable: true,
    width: 120,
  },
  {
    key: "builtin",
    header: "Origin",
    value: (r) => (r.builtin ? "built-in" : "local"),
    render: (r) =>
      r.builtin ? <span className="badge badge-muted">Built-in</span> : "Local",
    sortable: true,
    width: 110,
  },
];

export function SonicUsersPage() {
  const [doc, setDoc] = useState<SystemUsersDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [modal, setModal] = useState<{ user?: SonicUser } | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchSystemUsers());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load users.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (row: SonicUser) => {
    if (row.builtin) {
      setToast(`${row.name} is a built-in account and can't be deleted.`);
      return;
    }
    try {
      await deleteSystemUser(row.name);
      setToast(`Deleted ${row.name}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete ${row.name}.`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Users
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Local login accounts on the switch — remote AAA lives under Security
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading users…</div>
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
        {status === "ready" && doc && !doc.capability.supported && (
          <FeatureUnavailable feature="User management" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />
            <DataTable
              rows={doc.users}
              columns={columns}
              rowId={(r) => r.name}
              storageKey="system-sonic-users"
              searchPlaceholder="Search users…"
              emptyMessage="No users configured."
              onRefresh={() => load("refresh")}
              onRowDoubleClick={(r) => setModal({ user: r })}
              toolbar={
                !doc.capability.read_only ? (
                  <Button kind="primary" size="sm" icon={Plus} onClick={() => setModal({})}>
                    Add user
                  </Button>
                ) : undefined
              }
              actions={(row) => (
                <RowActions
                  label={row.name}
                  onEdit={() => setModal({ user: row })}
                  onDelete={() => remove(row)}
                />
              )}
            />
          </div>
        )}
      </div>

      {modal && doc && (
        <SonicUserFormModal
          initial={modal.user}
          existingNames={doc.users.map((u) => u.name)}
          onClose={() => setModal(null)}
          onSaved={(msg) => {
            setModal(null);
            setToast(msg);
            load("refresh");
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
