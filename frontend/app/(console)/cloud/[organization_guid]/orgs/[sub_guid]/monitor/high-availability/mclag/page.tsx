"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, Info, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { MonitorPageShell } from "@/components/monitor/MonitorPage";
import { useCloudOrg } from "@/components/CloudShell";
import type { Device } from "@/lib/api";
import { HaDeviceDoc, fetchHaDocs, sonicSwitches, switchLabel } from "@/lib/device/ha-fanout";
import { MclagDoc } from "@/lib/device/sonic-mclag";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

/** One switch's MCLAG posture, flattened for the aggregate table. */
interface MclagStatusRow {
  device: Device;
  connected: boolean;
  domainId: number | null;
  peerIp: string | null;
  sessionStatus: "up" | "down" | null;
  role: "active" | "standby" | null;
  peerLinkStatus: "up" | "down" | null;
  membersUp: number;
  membersTotal: number;
  error?: string;
}

function buildRows(docs: HaDeviceDoc<MclagDoc>[]): MclagStatusRow[] {
  return docs.map((d) => {
    const domain = d.doc?.domain ?? null;
    const state = d.doc?.state ?? null;
    const members = state?.members ?? [];
    return {
      device: d.device,
      connected: d.connected,
      domainId: domain?.domain_id ?? null,
      peerIp: domain?.peer_ip ?? null,
      sessionStatus: state?.session_status ?? null,
      role: state?.role ?? null,
      peerLinkStatus: state?.peer_link_status ?? null,
      membersUp: members.filter((m) => m.local_status === "up" && m.remote_status === "up").length,
      membersTotal: domain?.members.length ?? 0,
      error: d.error,
    };
  });
}

const columns: Column<MclagStatusRow>[] = [
  {
    key: "switch",
    header: "Switch",
    value: (r) => switchLabel(r.device),
    mono: true,
    sortable: true,
    width: 170,
  },
  {
    key: "reachable",
    header: "Cloud Link",
    value: (r) => (r.connected ? "online" : "offline"),
    render: (r) =>
      r.connected ? (
        <span className="badge badge-ok">Online</span>
      ) : (
        <span className="badge badge-muted">Offline</span>
      ),
    sortable: true,
    width: 105,
  },
  {
    key: "domain",
    header: "Domain",
    value: (r) => r.domainId ?? -1,
    render: (r) => (r.domainId != null ? String(r.domainId) : dash),
    mono: true,
    sortable: true,
    width: 90,
  },
  {
    key: "peer",
    header: "Peer Address",
    value: (r) => r.peerIp ?? "",
    render: (r) => (r.peerIp ? r.peerIp : dash),
    mono: true,
    width: 140,
  },
  {
    key: "session",
    header: "Session",
    value: (r) => r.sessionStatus ?? "",
    render: (r) =>
      r.sessionStatus === "up" ? (
        <span className="badge badge-ok">Up</span>
      ) : r.sessionStatus === "down" ? (
        <span className="badge badge-crit">Down</span>
      ) : r.domainId != null ? (
        <span className="badge badge-muted">Unknown</span>
      ) : (
        dash
      ),
    sortable: true,
    width: 100,
  },
  {
    key: "role",
    header: "Role",
    value: (r) => r.role ?? "",
    render: (r) =>
      r.role === "active" ? (
        <span className="badge badge-info">Active</span>
      ) : r.role === "standby" ? (
        <span className="badge badge-muted">Standby</span>
      ) : (
        dash
      ),
    sortable: true,
    width: 100,
  },
  {
    key: "peer-link",
    header: "Peer Link",
    value: (r) => r.peerLinkStatus ?? "",
    render: (r) =>
      r.peerLinkStatus === "up" ? (
        <span className="badge badge-ok">Up</span>
      ) : r.peerLinkStatus === "down" ? (
        <span className="badge badge-crit">Down</span>
      ) : (
        dash
      ),
    width: 100,
  },
  {
    key: "members",
    header: "Members In Sync",
    value: (r) => (r.membersTotal ? r.membersUp / r.membersTotal : -1),
    render: (r) =>
      r.membersTotal ? (
        <span
          className={
            r.membersUp === r.membersTotal ? "text-[var(--qz-success)]" : "text-[var(--qz-warn)]"
          }
          style={{ fontFamily: "var(--qz-font-mono)" }}
        >
          {r.membersUp} / {r.membersTotal}
        </span>
      ) : (
        dash
      ),
    sortable: true,
    width: 130,
  },
];

/// Read-only MCLAG posture across the sub-organization's switches — one row
/// per switch so a broken half of a pair is immediately visible. Pairs are
/// created and edited under Configure → High Availability → MCLAG.
export default function MclagMonitorPage() {
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  const { devices } = useCloudOrg();
  const switches = useMemo(
    () => sonicSwitches(devices, params.sub_guid),
    [devices, params.sub_guid],
  );

  const [docs, setDocs] = useState<HaDeviceDoc<MclagDoc>[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(
    async (mode: "load" | "refresh" = "load") => {
      if (devices === null) return;
      if (mode === "load") setStatus("loading");
      try {
        setDocs(await fetchHaDocs<MclagDoc>(params.organization_guid, params.sub_guid, "/ha/mclag", switches));
        setStatus("ready");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Failed to load MCLAG state.");
        setStatus("error");
      }
    },
    [devices, params.organization_guid, params.sub_guid, switches],
  );

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => (docs ? buildRows(docs) : []), [docs]);

  return (
    <MonitorPageShell
      title="MCLAG"
      subtitle="Live MCLAG session, role, and member sync state across this sub-organization's switches"
    >
      {(status === "loading" || devices === null) && (
        <div className="text-[13px] text-[var(--qz-fg-4)]">Loading MCLAG state…</div>
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
      {status === "ready" && devices !== null && switches.length === 0 && (
        <div
          className="flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px] text-[var(--qz-fg-2)] max-w-[640px]"
          style={{ background: "var(--qz-info-soft)", border: "1px solid var(--qz-border)" }}
        >
          <Info size={14} className="flex-shrink-0 text-[var(--qz-info)]" />
          This sub-organization has no adopted QuartzSONiC switches.
        </div>
      )}
      {status === "ready" && switches.length > 0 && (
        <DataTable
          rows={rows}
          columns={columns}
          rowId={(r) => r.device.device_id}
          storageKey="monitor-ha-mclag"
          searchPlaceholder="Search switches…"
          emptyMessage="No switches reported."
          onRefresh={() => load("refresh")}
        />
      )}
    </MonitorPageShell>
  );
}
