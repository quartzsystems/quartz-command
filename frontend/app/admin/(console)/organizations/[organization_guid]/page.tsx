"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Toast } from "@/components/dashboard/Toast";
import {
  getOrganization,
  removeMember,
  updateOrganization,
  type OrganizationDetail,
  type OrganizationMember,
} from "@/lib/adminApi";
import { MemberFormModal } from "./MemberFormModal";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const columns: Column<OrganizationMember>[] = [
  { key: "email", header: "Email", value: (r) => r.email, mono: true, sortable: true },
  {
    key: "full_name",
    header: "Full Name",
    value: (r) => r.full_name ?? "",
    render: (r) => (r.full_name ? r.full_name : <span className="text-[var(--qz-fg-4)]">—</span>),
  },
  {
    key: "role",
    header: "Role",
    value: (r) => r.role,
    render: (r) => <span className="badge badge-muted">{r.role}</span>,
    sortable: true,
    width: 110,
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
    key: "joined",
    header: "Joined",
    value: (r) => r.joined_at,
    render: (r) => new Date(r.joined_at).toLocaleDateString(),
    sortable: true,
    width: 110,
  },
];

/// One organization: settings (name; the slug follows it) and the users
/// inside it, managed through the standard table + modal patterns.
export default function AdminOrganizationPage() {
  const { organization_guid } = useParams<{ organization_guid: string }>();

  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  // null = closed; { member: undefined } = add; { member } = edit.
  const [modal, setModal] = useState<{ member?: OrganizationMember } | null>(null);

  // Settings form
  const [name, setName] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      const d = await getOrganization(organization_guid);
      setDetail(d);
      setName(d.organization.name);
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load the organization.");
      setStatus("error");
    }
  }, [organization_guid]);

  useEffect(() => {
    load();
  }, [load]);

  const saveSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSettingsError("");
    setSavingSettings(true);
    try {
      const org = await updateOrganization(organization_guid, name.trim());
      setToast(`Saved — slug is now ${org.slug}.`);
      await load("refresh");
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setSavingSettings(false);
    }
  };

  const remove = async (member: OrganizationMember) => {
    try {
      await removeMember(organization_guid, member.user_id);
      setToast(`Removed ${member.email}.`);
      await load("refresh");
    } catch (err) {
      setToast(err instanceof Error ? err.message : `Failed to remove ${member.email}.`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <Link
          href="/admin/organizations"
          className="inline-flex items-center gap-[6px] text-[12px] no-underline mb-2 text-[var(--qz-fg-4)] hover:text-[var(--qz-fg-1)] transition-colors"
        >
          <ArrowLeft size={13} /> Organizations
        </Link>
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          {detail?.organization.name ?? "Organization"}
        </h1>
        {detail && (
          <p
            className="text-[12px] mt-1 m-0"
            style={{ color: "var(--qz-fg-4)", fontFamily: "var(--qz-font-mono)" }}
          >
            {detail.organization.slug} · {detail.organization.id}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading organization…</div>
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
        {status === "ready" && detail && (
          <div className="flex flex-col gap-6">
            {/* Settings */}
            <form onSubmit={saveSettings} className="surface p-5 flex flex-col gap-4">
              <span className="text-[14px] font-semibold text-[var(--qz-fg-1)]">Settings</span>
              <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputCls}
                    style={inputSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  />
                  <p className="text-[11px] text-[var(--qz-fg-4)] m-0 mt-[5px]">
                    The URL slug is regenerated automatically when the name changes.
                  </p>
                </div>
              </div>
              {settingsError && (
                <p className="text-[12px] m-0" style={{ color: "var(--qz-danger)" }}>
                  {settingsError}
                </p>
              )}
              <div>
                <Button type="submit" kind="primary" disabled={savingSettings}>
                  {savingSettings ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>

            {/* Members */}
            <div className="flex flex-col gap-3">
              <span className="text-[14px] font-semibold text-[var(--qz-fg-1)]">Members</span>
              <DataTable
                rows={detail.members}
                columns={columns}
                rowId={(r) => r.user_id}
                storageKey="admin-org-members"
                searchPlaceholder="Search members…"
                emptyMessage="No members yet. Add the first one to get started."
                onRefresh={() => load("refresh")}
                toolbar={
                  <Button kind="primary" size="sm" icon={Plus} onClick={() => setModal({})}>
                    Add member
                  </Button>
                }
                actions={(row) => (
                  <RowActions
                    label={`member ${row.email}`}
                    onEdit={() => setModal({ member: row })}
                    onDelete={() => remove(row)}
                  />
                )}
              />
            </div>
          </div>
        )}
      </div>

      {modal && detail && (
        <MemberFormModal
          organizationGuid={organization_guid}
          organizationName={detail.organization.name}
          initial={modal.member}
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
