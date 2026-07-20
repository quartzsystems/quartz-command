"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, Plus, RotateCw, Trash2, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { useCloudOrg } from "@/components/CloudShell";
import { AddSubOrgUserModal } from "@/components/AddSubOrgUserModal";
import { ConfirmAction } from "@/components/inventory/common";
import {
  deleteSubOrganization,
  listSubOrgMembers,
  removeSubOrgMember,
  type SubOrgMember,
} from "@/lib/api";

const memberColumns: Column<SubOrgMember>[] = [
  { key: "email", header: "Email", value: (r) => r.email, sortable: true },
  { key: "full_name", header: "Name", value: (r) => r.full_name, sortable: true, width: 180 },
  {
    key: "role",
    header: "Role",
    value: (r) => r.role,
    render: (r) => <span className="badge badge-info">{r.role}</span>,
    sortable: true,
    width: 100,
  },
  {
    key: "active",
    header: "Status",
    value: (r) => (r.is_active ? "active" : "disabled"),
    render: (r) => (
      <span className={r.is_active ? "badge badge-ok" : "badge badge-muted"}>
        {r.is_active ? "active" : "disabled"}
      </span>
    ),
    sortable: true,
    width: 100,
  },
  {
    key: "joined",
    header: "Joined",
    value: (r) => r.joined_at,
    render: (r) => new Date(r.joined_at).toLocaleDateString(),
    sortable: true,
    width: 120,
  },
];

/// Sub-organization Administration: manage the users who belong to this
/// sub-organization, and delete the sub-organization itself. Both mutations
/// require owner/admin in the parent organization (enforced server-side).
export default function SubOrgAdministrationPage() {
  const { org, subs, refreshSubs } = useCloudOrg();
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  const router = useRouter();
  const orgGuid = params.organization_guid;
  const subGuid = params.sub_guid;
  const sub = subs?.find((s) => s.id === subGuid);

  const [members, setMembers] = useState<SubOrgMember[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(
    async (mode: "load" | "refresh" = "load") => {
      if (mode === "load") setStatus("loading");
      try {
        setMembers(await listSubOrgMembers(orgGuid, subGuid));
        setStatus("ready");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Failed to load members.");
        setStatus("error");
      }
    },
    [orgGuid, subGuid],
  );

  useEffect(() => {
    load();
  }, [load]);

  const doRemove = async (m: SubOrgMember) => {
    try {
      await removeSubOrgMember(orgGuid, subGuid, m.user_id);
      setToast(`Removed ${m.email}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to remove ${m.email}.`);
    }
  };

  const doDelete = async () => {
    setDeleteError("");
    setDeleting(true);
    try {
      await deleteSubOrganization(orgGuid, subGuid);
      refreshSubs();
      router.replace(`/cloud/${orgGuid}`);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Could not delete the sub-organization.");
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[20px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.02em" }}>
          Administration
        </h1>
        <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
          {sub ? `${sub.name} · ${org?.name ?? ""}` : org?.name ?? "Loading…"}
        </p>
      </header>

      {status === "loading" && (
        <div className="text-[13px] text-[var(--qz-fg-4)]">Loading members…</div>
      )}
      {status === "error" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[13px] text-[var(--qz-danger)]">
            <AlertTriangle size={15} />
            {errorMsg}
          </div>
          <div>
            <Button kind="secondary" icon={RotateCw} onClick={() => load()}>Retry</Button>
          </div>
        </div>
      )}

      {status === "ready" && members && (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-[15px] font-semibold text-[var(--qz-fg-1)] m-0">Users</h2>
            <DataTable
              rows={members}
              columns={memberColumns}
              rowId={(r) => r.user_id}
              storageKey="sub-org-members"
              searchPlaceholder="Search users…"
              emptyMessage="No users yet. “Add user” grants someone access to this sub-organization."
              onRefresh={() => load("refresh")}
              toolbar={
                <Button kind="primary" size="sm" icon={Plus} onClick={() => setAdding(true)}>
                  Add user
                </Button>
              }
              actions={(row) => (
                <ConfirmAction
                  label={`Remove ${row.email}`}
                  icon={UserMinus}
                  onConfirm={() => doRemove(row)}
                />
              )}
            />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-[15px] font-semibold text-[var(--qz-fg-1)] m-0">Danger zone</h2>
            <div
              className="surface p-5 flex items-center gap-4 flex-wrap"
              style={{ borderColor: "color-mix(in oklab, var(--qz-danger) 40%, transparent)" }}
            >
              <div className="flex-1 min-w-[260px] flex flex-col gap-1">
                <span className="text-[13.5px] font-semibold text-[var(--qz-fg-1)]">
                  Delete this sub-organization
                </span>
                <span className="text-[12.5px]" style={{ color: "var(--qz-fg-3)" }}>
                  Its users lose access and its devices return to {org?.name ?? "the parent organization"}
                  ’s unallocated pool. This cannot be undone.
                </span>
              </div>
              <Button kind="danger" icon={Trash2} onClick={() => setConfirmingDelete(true)}>
                Delete sub-organization
              </Button>
            </div>
          </section>
        </>
      )}

      {adding && (
        <AddSubOrgUserModal
          orgGuid={orgGuid}
          subGuid={subGuid}
          subName={sub?.name}
          onClose={() => setAdding(false)}
          onSaved={(msg) => {
            setAdding(false);
            setToast(msg);
            load("refresh");
          }}
        />
      )}

      {confirmingDelete && (
        <ModalShell onClose={() => !deleting && setConfirmingDelete(false)} maxWidth={480}>
          <ModalHeader
            title="Delete Sub-Organization"
            subtitle={sub ? `${sub.name} will be permanently deleted` : undefined}
            onClose={() => !deleting && setConfirmingDelete(false)}
          />
          <div className="flex flex-col gap-4">
            <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-2)" }}>
              All of its user memberships are removed and its devices go back to the
              parent organization’s unallocated pool. The devices themselves keep
              working — only the allocation is cleared.
            </p>
            {deleteError && (
              <p className="text-[12px] m-0" style={{ color: "var(--qz-danger)" }}>
                {deleteError}
              </p>
            )}
            <div className="flex gap-2 justify-end mt-1">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmingDelete(false)}
                className="px-4 py-[9px] rounded-md text-[13px] font-medium cursor-pointer"
                style={{ background: "transparent", border: "1px solid var(--qz-border)", color: "var(--qz-fg-2)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={doDelete}
                className="px-4 py-[9px] rounded-md text-[13px] font-semibold cursor-pointer border-0"
                style={{ background: "var(--qz-danger)", color: "white", opacity: deleting ? 0.7 : 1 }}
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
