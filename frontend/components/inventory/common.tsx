"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, Ban, Check, RotateCw, X, LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column } from "@/components/dashboard/DataTable";
import { useCloudOrg } from "@/components/CloudShell";
import { formatVersion } from "@/components/fleet/firmware";
import {
  listDevices,
  listEnrollmentTokens,
  type Device,
  type DeviceFolder,
  type EnrollmentToken,
  type MemberOrganization,
  type SubOrganization,
} from "@/lib/api";

/// Org-wide devices + enrollment tokens for the Inventory section, plus the
/// current scope (organization, or a sub-organization when the route carries a
/// sub_guid). Every inventory view loads through this one hook; sub-org views
/// filter the org-wide lists client-side.
export function useInventoryData(): {
  orgGuid: string;
  subGuid: string | undefined;
  org: MemberOrganization | null;
  sub: SubOrganization | undefined;
  subs: SubOrganization[] | null;
  scopeName: string | undefined;
  devices: Device[] | null;
  tokens: EnrollmentToken[] | null;
  /** Folders of the current sub-org (empty at the org level). */
  folders: DeviceFolder[];
  status: "loading" | "ready" | "error";
  errorMsg: string;
  load: (mode?: "load" | "refresh") => Promise<void>;
} {
  const params = useParams<{ organization_guid: string; sub_guid?: string }>();
  const orgGuid = params.organization_guid;
  const subGuid = params.sub_guid;
  const { org, subs, refreshDevices, folders: allFolders, refreshFolders } = useCloudOrg();
  const sub = subGuid ? subs?.find((s) => s.id === subGuid) : undefined;
  const scopeName = sub ? `${sub.name} · ${org?.name ?? ""}` : org?.name;

  const [devices, setDevices] = useState<Device[] | null>(null);
  const [tokens, setTokens] = useState<EnrollmentToken[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(
    async (mode: "load" | "refresh" = "load") => {
      if (mode === "load") setStatus("loading");
      try {
        const [devs, toks] = await Promise.all([listDevices(orgGuid), listEnrollmentTokens(orgGuid)]);
        setDevices(devs);
        setTokens(toks);
        setStatus("ready");
        // Refresh loads follow a mutation (allocate / revoke / enroll / folder),
        // so keep the sidebar's per-sub-org device + folder trees in step too.
        if (mode === "refresh") {
          refreshDevices();
          refreshFolders();
        }
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Failed to load inventory.");
        setStatus("error");
      }
    },
    [orgGuid, refreshDevices, refreshFolders],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Folders scoped to the current sub-org (folders are a sub-org concept).
  const folders = subGuid ? (allFolders ?? []).filter((f) => f.sub_org_id === subGuid) : [];

  return {
    orgGuid,
    subGuid,
    org,
    sub,
    subs,
    scopeName,
    devices,
    tokens,
    folders,
    status,
    errorMsg,
    load,
  };
}

/// Page header shared by the inventory views (view title + current scope).
export function InventoryHeader({ title, scopeName }: { title: string; scopeName?: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-[20px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.02em" }}>
        {title}
      </h1>
      <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
        {scopeName ?? "Loading…"}
      </p>
    </header>
  );
}

/// Loading / error states shared by the inventory views.
export function InventoryStatus({
  status,
  errorMsg,
  onRetry,
}: {
  status: "loading" | "error";
  errorMsg: string;
  onRetry: () => void;
}) {
  if (status === "loading") {
    return <div className="text-[13px] text-[var(--qz-fg-4)]">Loading inventory…</div>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[13px] text-[var(--qz-danger)]">
        <AlertTriangle size={15} />
        {errorMsg}
      </div>
      <div>
        <Button kind="secondary" icon={RotateCw} onClick={onRetry}>Retry</Button>
      </div>
    </div>
  );
}

/// Two-step inline confirm button (same interaction as RowActions' delete,
/// without the edit half). Used for revoking devices/tokens and removing
/// members — the icon and hover colour say which.
export function ConfirmAction({
  label,
  icon: Icon = Ban,
  onConfirm,
}: {
  label: string;
  icon?: LucideIcon;
  onConfirm: () => Promise<unknown>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  if (confirming) {
    return (
      <div className="inline-flex items-center gap-1 justify-end">
        <button
          type="button"
          title={`Confirm ${label}`}
          aria-label={`Confirm ${label}`}
          disabled={working}
          onClick={async () => {
            setWorking(true);
            try {
              await onConfirm();
            } finally {
              setWorking(false);
              setConfirming(false);
            }
          }}
          className="grid place-items-center w-7 h-7 rounded-md border-0 cursor-pointer disabled:opacity-60"
          style={{ background: "var(--qz-danger)", color: "white" }}
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          title="Cancel"
          aria-label="Cancel"
          onClick={() => setConfirming(false)}
          className="grid place-items-center w-7 h-7 rounded-md cursor-pointer text-[var(--qz-fg-3)] hover:text-[var(--qz-fg-1)]"
          style={{ background: "transparent", border: "1px solid var(--qz-border)" }}
        >
          <X size={14} />
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => setConfirming(true)}
      className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
    >
      <Icon size={14} />
    </button>
  );
}

// ── Device columns / badges ─────────────────────────────────────────────────

export const DEVICE_BADGE: Record<Device["state"], string> = {
  adopted: "badge badge-ok",
  pending: "badge badge-warn",
  revoked: "badge badge-crit",
};

export const deviceColumns: Column<Device>[] = [
  { key: "device_id", header: "Device ID", value: (r) => r.device_id, mono: true, sortable: true, width: 220 },
  {
    key: "state",
    header: "State",
    value: (r) => r.state,
    render: (r) => <span className={DEVICE_BADGE[r.state]}>{r.state}</span>,
    sortable: true,
    width: 100,
  },
  {
    key: "hostname",
    header: "Hostname",
    value: (r) => r.hostname,
    render: (r) => <span className="uppercase">{r.hostname}</span>,
    sortable: true,
  },
  {
    key: "version",
    header: "Version",
    value: (r) => r.qf_version,
    render: (r) => formatVersion(r.qf_version),
    mono: true,
    width: 150,
  },
  {
    key: "last_seen",
    header: "Last seen",
    value: (r) => r.last_seen_at,
    render: (r) =>
      r.last_seen_at
        ? `${new Date(r.last_seen_at).toLocaleString()}${r.last_seen_ip ? ` · ${r.last_seen_ip}` : ""}`
        : "—",
    sortable: true,
    width: 200,
  },
  {
    key: "cert",
    header: "Cert expires",
    value: (r) => r.cert_not_after,
    render: (r) => (r.cert_not_after ? new Date(r.cert_not_after).toLocaleDateString() : "—"),
    sortable: true,
    width: 120,
  },
];

/// "Allocated to" column, shown in the org-level Allocated view where devices
/// from every sub-organization are mixed together.
export const allocatedToColumn: Column<Device> = {
  key: "allocated_to",
  header: "Allocated to",
  value: (r) => r.sub_org_name,
  sortable: true,
  width: 160,
};

// ── Token columns / badges ──────────────────────────────────────────────────

export type TokenStatus = "active" | "expired" | "exhausted" | "revoked";

export function tokenStatus(t: EnrollmentToken): TokenStatus {
  if (t.revoked_at) return "revoked";
  if (new Date(t.expires_at).getTime() <= Date.now()) return "expired";
  if (t.max_uses != null && t.use_count >= t.max_uses) return "exhausted";
  return "active";
}

export const TOKEN_BADGE: Record<TokenStatus, string> = {
  active: "badge badge-ok",
  expired: "badge badge-muted",
  exhausted: "badge badge-muted",
  revoked: "badge badge-crit",
};

export function buildTokenColumns(opts: { showScope: boolean }): Column<EnrollmentToken>[] {
  const cols: Column<EnrollmentToken>[] = [
    { key: "token_id", header: "Token", value: (r) => r.token_id, mono: true, sortable: true, width: 160 },
    { key: "label", header: "Label", value: (r) => r.label },
    {
      key: "status",
      header: "Status",
      value: (r) => tokenStatus(r),
      render: (r) => <span className={TOKEN_BADGE[tokenStatus(r)]}>{tokenStatus(r)}</span>,
      sortable: true,
      width: 100,
    },
    {
      key: "uses",
      header: "Uses",
      value: (r) => r.use_count,
      render: (r) => `${r.use_count} / ${r.max_uses ?? "∞"}`,
      sortable: true,
      width: 80,
    },
    { key: "created_by", header: "Created by", value: (r) => r.created_by_email, width: 180 },
    {
      key: "expires",
      header: "Expires",
      value: (r) => r.expires_at,
      render: (r) => new Date(r.expires_at).toLocaleString(),
      sortable: true,
      width: 160,
    },
  ];
  if (opts.showScope) {
    // Where enrolled devices land: a sub-organization, or the top-level pool.
    cols.splice(2, 0, {
      key: "enrolls_into",
      header: "Enrolls into",
      value: (r) => r.sub_org_name ?? "Unallocated",
      sortable: true,
      width: 140,
    });
  }
  return cols;
}
