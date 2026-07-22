"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Toast } from "@/components/dashboard/Toast";
import { deleteOrganization, listOrganizations, type AdminOrganization } from "@/lib/adminApi";
import { OrgFormModal } from "./OrgFormModal";

const columns: Column<AdminOrganization>[] = [
  { key: "name", header: "Name", value: (r) => r.name, sortable: true },
  { key: "slug", header: "Slug", value: (r) => r.slug, mono: true, sortable: true, width: 180 },
  {
    key: "members",
    header: "Members",
    value: (r) => r.member_count,
    render: (r) => (
      <span className="badge badge-muted">
        {r.member_count} {r.member_count === 1 ? "member" : "members"}
      </span>
    ),
    sortable: true,
    width: 120,
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

/// Every tenant organization: create, delete, and step into one to manage its
/// users. Same table + modal patterns as QuartzFire's config pages.
export default function AdminOrganizationsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<AdminOrganization[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setOrgs(await listOrganizations());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load organizations.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (org: AdminOrganization) => {
    try {
      await deleteOrganization(org.id);
      setToast(`Deleted organization ${org.name}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete organization ${org.name}.`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Organizations
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Tenant organizations — open one to configure it and manage its users
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading organizations…</div>
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
        {status === "ready" && orgs && (
          <DataTable
            rows={orgs}
            columns={columns}
            rowId={(r) => r.id}
            storageKey="admin-organizations"
            searchPlaceholder="Search organizations…"
            emptyMessage="No organizations yet. Create the first one to get started."
            onRefresh={() => load("refresh")}
            onRowDoubleClick={(r) => router.push(`/admin/organizations/${r.id}`)}
            toolbar={
              <Button kind="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                Create organization
              </Button>
            }
            actions={(row) => (
              <RowActions
                label={`organization ${row.name}`}
                onEdit={() => router.push(`/admin/organizations/${row.id}`)}
                onDelete={() => remove(row)}
              />
            )}
          />
        )}
      </div>

      {creating && (
        <OrgFormModal
          onClose={() => setCreating(false)}
          onSaved={(msg) => {
            setCreating(false);
            setToast(msg);
            load("refresh");
          }}
        />
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
