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
import { MclagDoc, MclagDomain, MclagState, deleteMclag } from "@/lib/device/sonic-mclag";
import { MclagPairFormModal } from "./MclagPairFormModal";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

/** One switch's side of a domain, joined with its live state. */
export interface MclagSide {
  device: Device;
  connected: boolean;
  domain: MclagDomain;
  state: MclagState | null;
}

/** One table row: a matched pair, or a lone side whose peer is missing or
 *  misconfigured (peer/source IPs don't mirror each other). */
export interface MclagPairRow {
  key: string;
  domainId: number;
  a: MclagSide;
  b: MclagSide | null;
}

/// Two sides pair when they agree on the domain id and each names the other
/// as its keepalive peer.
function mirrored(x: MclagDomain, y: MclagDomain): boolean {
  return (
    x.domain_id === y.domain_id && x.peer_ip === y.source_ip && x.source_ip === y.peer_ip
  );
}

function buildRows(docs: HaDeviceDoc<MclagDoc>[]): MclagPairRow[] {
  const sides: MclagSide[] = docs
    .filter((d) => d.doc?.domain != null)
    .map((d) => ({
      device: d.device,
      connected: d.connected,
      domain: d.doc!.domain!,
      state: d.doc!.state,
    }));

  const used = new Set<string>();
  const rows: MclagPairRow[] = [];
  for (const side of sides) {
    if (used.has(side.device.device_id)) continue;
    const peer = sides.find(
      (o) =>
        o.device.device_id !== side.device.device_id &&
        !used.has(o.device.device_id) &&
        mirrored(side.domain, o.domain),
    );
    used.add(side.device.device_id);
    if (peer) used.add(peer.device.device_id);
    // Stable A/B order so the row doesn't flip between refreshes.
    const [a, b] =
      peer && peer.device.device_id < side.device.device_id ? [peer, side] : [side, peer ?? null];
    rows.push({
      key: peer
        ? [side.device.device_id, peer.device.device_id].sort().join("+")
        : side.device.device_id,
      domainId: side.domain.domain_id,
      a,
      b,
    });
  }
  return rows.sort((x, y) => x.domainId - y.domainId);
}

function sessionBadge(row: MclagPairRow) {
  if (!row.b) return <span className="badge badge-warn">Peer Missing</span>;
  const states = [row.a.state?.session_status, row.b.state?.session_status];
  if (states.every((s) => s === "up")) return <span className="badge badge-ok">Up</span>;
  if (states.some((s) => s === "down")) return <span className="badge badge-crit">Down</span>;
  return <span className="badge badge-muted">Unknown</span>;
}

function sideCell(side: MclagSide | null) {
  if (!side) return <span className="badge badge-warn">Not Configured</span>;
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className="truncate">{switchLabel(side.device)}</span>
      {side.state?.role && (
        <span className={`badge ${side.state.role === "active" ? "badge-info" : "badge-muted"}`}>
          {side.state.role === "active" ? "Active" : "Standby"}
        </span>
      )}
    </span>
  );
}

const columns: Column<MclagPairRow>[] = [
  { key: "domain", header: "Domain", value: (r) => r.domainId, mono: true, sortable: true, width: 90 },
  {
    key: "switch-a",
    header: "Switch A",
    value: (r) => switchLabel(r.a.device),
    render: (r) => sideCell(r.a),
    sortable: true,
    width: 190,
  },
  {
    key: "switch-b",
    header: "Switch B",
    value: (r) => (r.b ? switchLabel(r.b.device) : ""),
    render: (r) => sideCell(r.b),
    sortable: true,
    width: 190,
  },
  {
    key: "peer-link",
    header: "Peer Link",
    value: (r) => r.a.domain.peer_link ?? "",
    render: (r) => (r.a.domain.peer_link ? r.a.domain.peer_link : dash),
    mono: true,
    width: 150,
  },
  {
    key: "members",
    header: "MCLAG Port Channels",
    value: (r) => r.a.domain.members.length,
    render: (r) =>
      r.a.domain.members.length ? (
        <span title={r.a.domain.members.join(", ")}>{r.a.domain.members.join(", ")}</span>
      ) : (
        dash
      ),
    mono: true,
    width: 210,
  },
  {
    key: "session",
    header: "Session",
    value: (r) => (r.b ? (r.a.state?.session_status ?? "unknown") : "peer-missing"),
    render: (r) => sessionBadge(r),
    sortable: true,
    width: 130,
  },
];

/// MCLAG domains across this sub-organization's switch pairs. Reads fan out
/// over every switch; a create/edit writes the mirrored domain to both
/// members of the pair. Live per-interface sync state is under Monitor →
/// High Availability → MCLAG.
export default function MclagConfigurePage() {
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  const { devices } = useCloudOrg();
  const switches = useMemo(
    () => sonicSwitches(devices, params.sub_guid),
    [devices, params.sub_guid],
  );

  const [docs, setDocs] = useState<HaDeviceDoc<MclagDoc>[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState<MclagPairRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    async (mode: "load" | "refresh" = "load") => {
      if (devices === null) return; // sidebar device list still loading
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

  // Switches whose image can't do MCLAG (or that are offline) are called out
  // rather than silently missing from the pair pickers.
  const unsupported = (docs ?? []).filter((d) => d.doc && !d.doc.capability.supported);
  const offline = (docs ?? []).filter((d) => !d.doc && !d.connected);
  const eligible = (docs ?? []).filter((d) => d.doc?.capability.supported);

  const removePair = async (row: MclagPairRow) => {
    setDeleting(true);
    const failures: string[] = [];
    for (const side of [row.a, row.b].filter(Boolean) as MclagSide[]) {
      try {
        await deleteMclag(params.organization_guid, side.device.device_id);
      } catch (e) {
        failures.push(
          `${switchLabel(side.device)}: ${e instanceof Error ? e.message : "delete failed"}`,
        );
      }
    }
    setToast(
      failures.length
        ? `Domain ${row.domainId} partially removed — ${failures.join("; ")}`
        : `Removed MCLAG domain ${row.domainId}.`,
    );
    setConfirmDelete(null);
    setDeleting(false);
    await load("refresh");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          MCLAG
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Multi-chassis link aggregation — pair two switches so downstream devices dual-home over one port channel
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
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
        {status === "ready" && devices !== null && switches.length < 2 && (
          <div
            className="flex items-start gap-3 rounded-lg px-4 py-[14px] max-w-[640px]"
            style={{ background: "var(--qz-info-soft)", border: "1px solid var(--qz-border)" }}
          >
            <Info size={16} className="flex-shrink-0 mt-[1px] text-[var(--qz-info)]" />
            <div>
              <p className="text-[13px] font-semibold text-[var(--qz-fg-1)] m-0">
                MCLAG needs two switches
              </p>
              <p className="text-[13px] text-[var(--qz-fg-3)] m-0 mt-[3px]">
                {switches.length === 0
                  ? "This sub-organization has no adopted QuartzSONiC switches. Allocate two under Inventory, then pair them here."
                  : "Only one QuartzSONiC switch is adopted here — allocate a second switch to form an MCLAG pair."}
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
                      ? `No MCLAG support: ${unsupported
                          .map((d) => switchLabel(d.device))
                          .join(", ")} (${unsupported[0].doc?.capability.reason ?? "image lacks iccpd"})`
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
              storageKey="ha-mclag-pairs"
              searchPlaceholder="Search pairs…"
              emptyMessage="No MCLAG domains configured on this sub-organization's switches."
              onRefresh={() => load("refresh")}
              onRowDoubleClick={(r) => setEditing(r)}
              toolbar={
                <Button
                  icon={Plus}
                  onClick={() => setCreating(true)}
                  disabled={eligible.length < 2}
                >
                  Create pair
                </Button>
              }
              actionsWidth={confirmDelete ? 90 : 60}
              actions={(r) =>
                confirmDelete === r.key ? (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Confirm delete on both switches"
                      aria-label="Confirm delete"
                      disabled={deleting}
                      onClick={() => removePair(r)}
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
                      title={`Edit domain ${r.domainId}`}
                      aria-label="Edit"
                      onClick={() => setEditing(r)}
                      className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      title={`Delete domain ${r.domainId} from both switches`}
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
        <MclagPairFormModal
          orgGuid={params.organization_guid}
          switches={eligible.map((d) => d.device)}
          pair={editing}
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
