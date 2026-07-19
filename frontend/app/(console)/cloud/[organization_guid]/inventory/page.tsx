"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, Ban, Check, Plus, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import { useCloudOrg } from "@/components/CloudShell";
import { AddDeviceModal } from "@/components/AddDeviceModal";
import {
  listDevices,
  listEnrollmentTokens,
  revokeDevice,
  revokeEnrollmentToken,
  type Device,
  type EnrollmentToken,
} from "@/lib/api";

/// Two-step inline revoke button (same interaction as RowActions' delete,
/// without the edit half — devices and tokens are revoked, never edited).
function RevokeAction({ label, onRevoke }: { label: string; onRevoke: () => Promise<unknown> }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  if (confirming) {
    return (
      <div className="inline-flex items-center gap-1 justify-end">
        <button
          type="button"
          title="Confirm revoke"
          aria-label="Confirm revoke"
          disabled={working}
          onClick={async () => {
            setWorking(true);
            try {
              await onRevoke();
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
      title={`Revoke ${label}`}
      aria-label={`Revoke ${label}`}
      onClick={() => setConfirming(true)}
      className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
    >
      <Ban size={14} />
    </button>
  );
}

type TokenStatus = "active" | "expired" | "exhausted" | "revoked";

function tokenStatus(t: EnrollmentToken): TokenStatus {
  if (t.revoked_at) return "revoked";
  if (new Date(t.expires_at).getTime() <= Date.now()) return "expired";
  if (t.max_uses != null && t.use_count >= t.max_uses) return "exhausted";
  return "active";
}

const TOKEN_BADGE: Record<TokenStatus, string> = {
  active: "badge badge-ok",
  expired: "badge badge-muted",
  exhausted: "badge badge-muted",
  revoked: "badge badge-crit",
};

const DEVICE_BADGE: Record<Device["state"], string> = {
  adopted: "badge badge-ok",
  pending: "badge badge-warn",
  revoked: "badge badge-crit",
};

const deviceColumns: Column<Device>[] = [
  { key: "device_id", header: "Device ID", value: (r) => r.device_id, mono: true, sortable: true, width: 220 },
  {
    key: "state",
    header: "State",
    value: (r) => r.state,
    render: (r) => <span className={DEVICE_BADGE[r.state]}>{r.state}</span>,
    sortable: true,
    width: 100,
  },
  { key: "hostname", header: "Hostname", value: (r) => r.hostname, sortable: true },
  { key: "version", header: "Version", value: (r) => r.qf_version, mono: true, width: 100 },
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

const tokenColumns: Column<EnrollmentToken>[] = [
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

/// Inventory: the organization's QuartzFire devices plus the enrollment
/// tokens that adopt them ("Add device" flow).
export default function InventoryPage() {
  const { org } = useCloudOrg();
  const params = useParams<{ organization_guid: string }>();
  const orgGuid = params.organization_guid;

  const [devices, setDevices] = useState<Device[] | null>(null);
  const [tokens, setTokens] = useState<EnrollmentToken[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    async (mode: "load" | "refresh" = "load") => {
      if (mode === "load") setStatus("loading");
      try {
        const [devs, toks] = await Promise.all([listDevices(orgGuid), listEnrollmentTokens(orgGuid)]);
        setDevices(devs);
        setTokens(toks);
        setStatus("ready");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Failed to load inventory.");
        setStatus("error");
      }
    },
    [orgGuid],
  );

  useEffect(() => {
    load();
  }, [load]);

  const doRevokeDevice = async (d: Device) => {
    try {
      await revokeDevice(orgGuid, d.device_id);
      setToast(`Revoked device ${d.device_id}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to revoke device ${d.device_id}.`);
    }
  };

  const doRevokeToken = async (t: EnrollmentToken) => {
    try {
      await revokeEnrollmentToken(orgGuid, t.token_id);
      setToast(`Revoked token ${t.token_id}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to revoke token ${t.token_id}.`);
    }
  };

  return (
    <div className="p-6 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[20px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.02em" }}>
          Inventory
        </h1>
        <p className="text-[13px] m-0" style={{ color: "var(--qz-fg-3)" }}>
          {org?.name ?? "Loading…"}
        </p>
      </header>

      {status === "loading" && (
        <div className="text-[13px] text-[var(--qz-fg-4)]">Loading inventory…</div>
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

      {status === "ready" && devices && tokens && (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-[15px] font-semibold text-[var(--qz-fg-1)] m-0">Devices</h2>
            <DataTable
              rows={devices}
              columns={deviceColumns}
              rowId={(r) => r.device_id}
              storageKey="org-devices"
              searchPlaceholder="Search devices…"
              emptyMessage="No devices yet. Add one to enroll your first QuartzFire."
              onRefresh={() => load("refresh")}
              toolbar={
                <Button kind="primary" size="sm" icon={Plus} onClick={() => setAdding(true)}>
                  Add device
                </Button>
              }
              actions={(row) =>
                row.state !== "revoked" ? (
                  <RevokeAction label={`device ${row.device_id}`} onRevoke={() => doRevokeDevice(row)} />
                ) : null
              }
            />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-[15px] font-semibold text-[var(--qz-fg-1)] m-0">Enrollment tokens</h2>
            <DataTable
              rows={tokens}
              columns={tokenColumns}
              rowId={(r) => r.token_id}
              storageKey="org-enroll-tokens"
              searchPlaceholder="Search tokens…"
              emptyMessage="No enrollment tokens. “Add device” creates one."
              onRefresh={() => load("refresh")}
              actions={(row) =>
                tokenStatus(row) === "active" ? (
                  <RevokeAction label={`token ${row.token_id}`} onRevoke={() => doRevokeToken(row)} />
                ) : null
              }
            />
          </section>
        </>
      )}

      {adding && (
        <AddDeviceModal
          orgGuid={orgGuid}
          orgName={org?.name}
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

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
