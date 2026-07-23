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
import { VrrpDoc, VrrpGroup } from "@/lib/device/sonic-vrrp";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

/** One (switch, group) pair — a per-switch view so a missing or misbehaving
 *  side stands out. */
interface VrrpStatusRow {
  device: Device;
  group: VrrpGroup;
}

function buildRows(docs: HaDeviceDoc<VrrpDoc>[]): VrrpStatusRow[] {
  const rows: VrrpStatusRow[] = [];
  for (const d of docs) {
    for (const group of d.doc?.groups ?? []) {
      rows.push({ device: d.device, group });
    }
  }
  return rows.sort(
    (x, y) =>
      x.group.interface.localeCompare(y.group.interface) ||
      x.group.vrid - y.group.vrid ||
      y.group.priority - x.group.priority,
  );
}

const columns: Column<VrrpStatusRow>[] = [
  {
    key: "iface",
    header: "Interface",
    value: (r) => r.group.interface,
    mono: true,
    sortable: true,
    width: 115,
  },
  { key: "vrid", header: "VRID", value: (r) => r.group.vrid, mono: true, sortable: true, width: 75 },
  {
    key: "switch",
    header: "Switch",
    value: (r) => switchLabel(r.device),
    mono: true,
    sortable: true,
    width: 170,
  },
  {
    key: "state",
    header: "State",
    value: (r) => r.group.state ?? "",
    render: (r) =>
      r.group.state === "master" ? (
        <span className="badge badge-ok">Master</span>
      ) : r.group.state === "backup" ? (
        <span className="badge badge-info">Backup</span>
      ) : r.group.state === "init" ? (
        <span className="badge badge-muted">Init</span>
      ) : (
        dash
      ),
    sortable: true,
    width: 100,
  },
  {
    key: "priority",
    header: "Priority",
    value: (r) => r.group.priority,
    mono: true,
    sortable: true,
    width: 90,
  },
  {
    key: "vips",
    header: "Virtual IPs",
    value: (r) => r.group.virtual_ips.join(", "),
    render: (r) => (r.group.virtual_ips.length ? r.group.virtual_ips.join(", ") : dash),
    mono: true,
    width: 200,
  },
  {
    key: "preempt",
    header: "Preempt",
    value: (r) => (r.group.preempt ? "on" : "off"),
    render: (r) =>
      r.group.preempt ? (
        <span className="badge badge-ok">On</span>
      ) : (
        <span className="badge badge-muted">Off</span>
      ),
    width: 90,
  },
];

/// Read-only VRRP state across the sub-organization's switches — one row per
/// switch per group, so each pair should show one Master and one Backup.
/// Groups are created and edited under Configure → High Availability → VRRP.
export default function VrrpMonitorPage() {
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  const { devices } = useCloudOrg();
  const switches = useMemo(
    () => sonicSwitches(devices, params.sub_guid),
    [devices, params.sub_guid],
  );

  const [docs, setDocs] = useState<HaDeviceDoc<VrrpDoc>[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(
    async (mode: "load" | "refresh" = "load") => {
      if (devices === null) return;
      if (mode === "load") setStatus("loading");
      try {
        setDocs(await fetchHaDocs<VrrpDoc>(params.organization_guid, params.sub_guid, "/ha/vrrp", switches));
        setStatus("ready");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Failed to load VRRP state.");
        setStatus("error");
      }
    },
    [devices, params.organization_guid, params.sub_guid, switches],
  );

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => (docs ? buildRows(docs) : []), [docs]);
  const offline = (docs ?? []).filter((d) => !d.connected);

  return (
    <MonitorPageShell
      title="VRRP"
      subtitle="Live master/backup state for every virtual router across this sub-organization's switches"
    >
      {(status === "loading" || devices === null) && (
        <div className="text-[13px] text-[var(--qz-fg-4)]">Loading VRRP state…</div>
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
        <div className="flex flex-col gap-4">
          {offline.length > 0 && (
            <div
              className="flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px] text-[var(--qz-fg-2)] max-w-[720px]"
              style={{ background: "var(--qz-info-soft)", border: "1px solid var(--qz-border)" }}
            >
              <Info size={14} className="flex-shrink-0 text-[var(--qz-info)]" />
              Offline (not reporting): {offline.map((d) => switchLabel(d.device)).join(", ")}
            </div>
          )}
          <DataTable
            rows={rows}
            columns={columns}
            rowId={(r) => `${r.device.device_id}|${r.group.interface}|${r.group.vrid}`}
            storageKey="monitor-ha-vrrp"
            searchPlaceholder="Search groups…"
            emptyMessage="No VRRP groups configured on this sub-organization's switches."
            onRefresh={() => load("refresh")}
          />
        </div>
      )}
    </MonitorPageShell>
  );
}
