"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, Check, Info, Pencil, Plus, RotateCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import { useCloudOrg } from "@/components/CloudShell";
import type { Device } from "@/lib/api";
import { HaDeviceDoc, fetchHaDocs, sonicSwitches, switchLabel } from "@/lib/device/ha-fanout";
import { VrrpDoc, VrrpGroup, deleteVrrpGroup } from "@/lib/device/sonic-vrrp";
import { VrrpGroupFormModal } from "./VrrpGroupFormModal";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

/** One switch carrying a (interface, vrid) group. */
export interface VrrpSide {
  device: Device;
  connected: boolean;
  group: VrrpGroup;
}

/** One table row: every switch configured with the same (interface, vrid),
 *  normally exactly two. */
export interface VrrpRow {
  key: string;
  iface: string;
  vrid: number;
  sides: VrrpSide[];
}

function buildRows(docs: HaDeviceDoc<VrrpDoc>[]): VrrpRow[] {
  const byKey = new Map<string, VrrpRow>();
  for (const d of docs) {
    for (const group of d.doc?.groups ?? []) {
      const key = `${group.interface}|${group.vrid}`;
      let row = byKey.get(key);
      if (!row) {
        row = { key, iface: group.interface, vrid: group.vrid, sides: [] };
        byKey.set(key, row);
      }
      row.sides.push({ device: d.device, connected: d.connected, group });
    }
  }
  for (const row of byKey.values()) {
    // Highest priority first, so the intended master reads as "Switch A".
    row.sides.sort((x, y) => y.group.priority - x.group.priority);
  }
  return [...byKey.values()].sort(
    (x, y) => x.iface.localeCompare(y.iface) || x.vrid - y.vrid,
  );
}

function stateBadge(state: VrrpGroup["state"]) {
  switch (state) {
    case "master":
      return <span className="badge badge-ok">Master</span>;
    case "backup":
      return <span className="badge badge-info">Backup</span>;
    case "init":
      return <span className="badge badge-muted">Init</span>;
    default:
      return null;
  }
}

function sideCell(side: VrrpSide | undefined) {
  if (!side) return <span className="badge badge-warn">Missing</span>;
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className="truncate">{switchLabel(side.device)}</span>
      <span className="text-[var(--qz-fg-4)]" style={{ fontFamily: "var(--qz-font-mono)" }}>
        {side.group.priority}
      </span>
      {stateBadge(side.group.state)}
    </span>
  );
}

function healthBadge(row: VrrpRow) {
  if (row.sides.length < 2) return <span className="badge badge-warn">Single Switch</span>;
  const masters = row.sides.filter((s) => s.group.state === "master").length;
  if (masters > 1) return <span className="badge badge-crit">Split Brain</span>;
  if (masters === 1) return <span className="badge badge-ok">Healthy</span>;
  return <span className="badge badge-muted">Unknown</span>;
}

const columns: Column<VrrpRow>[] = [
  { key: "iface", header: "Interface", value: (r) => r.iface, mono: true, sortable: true, width: 120 },
  { key: "vrid", header: "VRID", value: (r) => r.vrid, mono: true, sortable: true, width: 75 },
  {
    key: "vips",
    header: "Virtual IPs",
    value: (r) => r.sides[0]?.group.virtual_ips.join(", ") ?? "",
    render: (r) => {
      const vips = [...new Set(r.sides.flatMap((s) => s.group.virtual_ips))];
      return vips.length ? vips.join(", ") : dash;
    },
    mono: true,
    width: 190,
  },
  {
    key: "side-a",
    header: "Switch A",
    value: (r) => (r.sides[0] ? switchLabel(r.sides[0].device) : ""),
    render: (r) => sideCell(r.sides[0]),
    sortable: true,
    width: 200,
  },
  {
    key: "side-b",
    header: "Switch B",
    value: (r) => (r.sides[1] ? switchLabel(r.sides[1].device) : ""),
    render: (r) => sideCell(r.sides[1]),
    width: 200,
  },
  {
    key: "preempt",
    header: "Preempt",
    value: (r) => (r.sides.every((s) => s.group.preempt) ? "on" : "off"),
    render: (r) =>
      r.sides.every((s) => s.group.preempt) ? (
        <span className="badge badge-ok">On</span>
      ) : (
        <span className="badge badge-muted">Off</span>
      ),
    width: 90,
  },
  {
    key: "health",
    header: "Health",
    value: (r) =>
      r.sides.length < 2 ? "single" : r.sides.some((s) => s.group.state === "master") ? "ok" : "unknown",
    render: (r) => healthBadge(r),
    sortable: true,
    width: 120,
  },
];

/// VRRP virtual routers across this sub-organization's switch pairs. A group
/// is created on two switches at once (different priorities decide the
/// intended master); live master/backup state is under Monitor → High
/// Availability → VRRP.
export default function VrrpConfigurePage() {
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  const { devices } = useCloudOrg();
  const switches = useMemo(
    () => sonicSwitches(devices, params.sub_guid),
    [devices, params.sub_guid],
  );

  const [docs, setDocs] = useState<HaDeviceDoc<VrrpDoc>[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState<VrrpRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const unsupported = (docs ?? []).filter((d) => d.doc && !d.doc.capability.supported);
  const offline = (docs ?? []).filter((d) => !d.doc && !d.connected);
  const eligible = (docs ?? []).filter((d) => d.doc?.capability.supported);

  const removeGroup = async (row: VrrpRow) => {
    setDeleting(true);
    const failures: string[] = [];
    for (const side of row.sides) {
      try {
        await deleteVrrpGroup(params.organization_guid, side.device.device_id, row.iface, row.vrid);
      } catch (e) {
        failures.push(
          `${switchLabel(side.device)}: ${e instanceof Error ? e.message : "delete failed"}`,
        );
      }
    }
    setToast(
      failures.length
        ? `Group ${row.iface}/${row.vrid} partially removed — ${failures.join("; ")}`
        : `Removed VRRP group ${row.vrid} on ${row.iface}.`,
    );
    setConfirmDelete(null);
    setDeleting(false);
    await load("refresh");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          VRRP
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Virtual gateway addresses shared across a switch pair — one master, one backup per group
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
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
        {status === "ready" && devices !== null && switches.length < 2 && (
          <div
            className="flex items-start gap-3 rounded-lg px-4 py-[14px] max-w-[640px]"
            style={{ background: "var(--qz-info-soft)", border: "1px solid var(--qz-border)" }}
          >
            <Info size={16} className="flex-shrink-0 mt-[1px] text-[var(--qz-info)]" />
            <div>
              <p className="text-[13px] font-semibold text-[var(--qz-fg-1)] m-0">
                VRRP needs two switches
              </p>
              <p className="text-[13px] text-[var(--qz-fg-3)] m-0 mt-[3px]">
                {switches.length === 0
                  ? "This sub-organization has no adopted QuartzSONiC switches. Allocate two under Inventory, then define virtual routers here."
                  : "Only one QuartzSONiC switch is adopted here — allocate a second switch so a backup can take over the virtual address."}
              </p>
            </div>
          </div>
        )}
        {status === "ready" && switches.length >= 2 && (
          <div className="flex flex-col gap-4">
            {(unsupported.length > 0 || offline.length > 0) && (
              <div
                className="flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px] text-[var(--qz-fg-2)] max-w-[720px]"
                style={{ background: "var(--qz-info-soft)", border: "1px solid var(--qz-border)" }}
              >
                <Info size={14} className="flex-shrink-0 text-[var(--qz-info)]" />
                <span>
                  {[
                    unsupported.length > 0
                      ? `No VRRP support: ${unsupported
                          .map((d) => switchLabel(d.device))
                          .join(", ")} (${unsupported[0].doc?.capability.reason ?? "requires an image with vrrpd, e.g. Enterprise SONiC"})`
                      : null,
                    offline.length > 0
                      ? `Offline: ${offline.map((d) => switchLabel(d.device)).join(", ")}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            )}

            <DataTable
              rows={rows}
              columns={columns}
              rowId={(r) => r.key}
              storageKey="ha-vrrp-groups"
              searchPlaceholder="Search groups…"
              emptyMessage="No VRRP groups configured on this sub-organization's switches."
              onRefresh={() => load("refresh")}
              onRowDoubleClick={(r) => setEditing(r)}
              toolbar={
                <Button
                  icon={Plus}
                  onClick={() => setCreating(true)}
                  disabled={eligible.length < 2}
                >
                  Create group
                </Button>
              }
              actionsWidth={confirmDelete ? 90 : 60}
              actions={(r) =>
                confirmDelete === r.key ? (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Confirm delete on all switches"
                      aria-label="Confirm delete"
                      disabled={deleting}
                      onClick={() => removeGroup(r)}
                      className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-danger)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      title="Cancel"
                      aria-label="Cancel delete"
                      onClick={() => setConfirmDelete(null)}
                      className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-fg-1)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      title={`Edit ${r.iface} VRID ${r.vrid}`}
                      aria-label="Edit"
                      onClick={() => setEditing(r)}
                      className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      title={`Delete ${r.iface} VRID ${r.vrid} from all switches`}
                      aria-label="Delete"
                      onClick={() => setConfirmDelete(r.key)}
                      className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                )
              }
            />
          </div>
        )}
      </div>

      {(creating || editing) && (
        <VrrpGroupFormModal
          orgGuid={params.organization_guid}
          switches={eligible.map((d) => d.device)}
          row={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(msg) => {
            setCreating(false);
            setEditing(null);
            setToast(msg);
            load("refresh");
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
