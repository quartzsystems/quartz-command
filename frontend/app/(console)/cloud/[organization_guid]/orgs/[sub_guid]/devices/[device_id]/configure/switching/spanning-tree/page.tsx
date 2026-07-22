"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Pencil, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import {
  StpDoc,
  StpPort,
  StpVlan,
  fetchStp,
} from "@/lib/device/stp";
import { StpGlobalPanel } from "./StpGlobalPanel";
import { StpVlanFormModal } from "./StpVlanFormModal";
import { StpPortFormModal } from "./StpPortFormModal";

type Section = "global" | "vlans" | "ports";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

function EnabledPill({ on }: { on: boolean }) {
  return on ? (
    <span className="badge badge-ok">Enabled</span>
  ) : (
    <span className="badge badge-muted">Disabled</span>
  );
}

/// STP port state: forwarding is healthy, blocking is a normal converged
/// state (informational), transitional states amber, disabled muted.
function StatePill({ port }: { port: StpPort }) {
  if (port.bpdu_guard_shutdown) return <span className="badge badge-crit">BPDU Shutdown</span>;
  switch (port.state) {
    case "forwarding":
      return <span className="badge badge-ok">Forwarding</span>;
    case "blocking":
      return <span className="badge badge-info">Blocking</span>;
    case "learning":
      return <span className="badge badge-warn">Learning</span>;
    case "listening":
      return <span className="badge badge-warn">Listening</span>;
    case "disabled":
      return <span className="badge badge-muted">Disabled</span>;
    default:
      return dash;
  }
}

const vlanColumns: Column<StpVlan>[] = [
  { key: "vlan_id", header: "VLAN ID", value: (r) => r.vlan_id, mono: true, sortable: true, width: 95 },
  {
    key: "enabled",
    header: "STP",
    value: (r) => (r.enabled ? "enabled" : "disabled"),
    render: (r) => <EnabledPill on={r.enabled} />,
    sortable: true,
    width: 100,
  },
  {
    key: "priority",
    header: "Priority",
    value: (r) => r.priority ?? -1,
    render: (r) => (r.priority != null ? r.priority : dash),
    mono: true,
    sortable: true,
    width: 95,
  },
  {
    key: "root",
    header: "Root Bridge",
    value: (r) => r.root_bridge_id ?? "",
    render: (r) =>
      r.is_root ? (
        <span className="badge badge-ok">This switch</span>
      ) : r.root_bridge_id ? (
        <span>{r.root_bridge_id}</span>
      ) : (
        dash
      ),
    mono: true,
  },
  {
    key: "root_port",
    header: "Root Port",
    value: (r) => r.root_port ?? "",
    render: (r) => (r.root_port ? r.root_port : dash),
    mono: true,
    width: 120,
  },
  {
    key: "topo",
    header: "Topo Changes",
    value: (r) => r.topology_change_count ?? -1,
    render: (r) => (r.topology_change_count != null ? r.topology_change_count : dash),
    mono: true,
    sortable: true,
    width: 120,
  },
];

function portColumns(): Column<StpPort>[] {
  return [
    { key: "name", header: "Interface", value: (r) => r.name, mono: true, sortable: true, width: 130 },
    {
      key: "enabled",
      header: "STP",
      value: (r) => (r.enabled ? "enabled" : "disabled"),
      render: (r) => <EnabledPill on={r.enabled} />,
      sortable: true,
      width: 100,
    },
    {
      key: "priority",
      header: "Priority",
      value: (r) => r.priority ?? -1,
      render: (r) => (r.priority != null ? r.priority : dash),
      mono: true,
      width: 90,
    },
    {
      key: "path_cost",
      header: "Cost",
      value: (r) => r.path_cost ?? -1,
      render: (r) => (r.path_cost != null ? r.path_cost : <span title="Auto from link speed">auto</span>),
      mono: true,
      width: 90,
    },
    {
      key: "flags",
      header: "Flags",
      value: (r) =>
        [r.portfast && "portfast", r.uplink_fast && "uplinkfast", r.bpdu_guard && "bpduguard", r.root_guard && "rootguard"]
          .filter(Boolean)
          .join(","),
      render: (r) => {
        const flags = [
          r.portfast && "PortFast",
          r.uplink_fast && "UplinkFast",
          r.bpdu_guard && "BPDU Guard",
          r.root_guard && "Root Guard",
        ].filter(Boolean) as string[];
        return flags.length ? (
          <span className="inline-flex gap-1 flex-wrap">
            {flags.map((f) => (
              <span key={f} className="badge badge-muted">{f}</span>
            ))}
          </span>
        ) : (
          dash
        );
      },
    },
    {
      key: "bpdus",
      header: "BPDU TX/RX",
      value: (r) => (r.bpdu_sent ?? 0) + (r.bpdu_received ?? 0),
      render: (r) =>
        r.bpdu_sent == null && r.bpdu_received == null ? (
          dash
        ) : (
          <span>{r.bpdu_sent ?? "—"} / {r.bpdu_received ?? "—"}</span>
        ),
      mono: true,
      width: 110,
    },
    {
      key: "state",
      header: "State",
      value: (r) => r.state ?? "",
      render: (r) => <StatePill port={r} />,
      sortable: true,
      width: 130,
    },
  ];
}

export default function SpanningTreePage() {
  const [doc, setDoc] = useState<StpDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [section, setSection] = useState<Section>("global");
  const [vlanModal, setVlanModal] = useState<StpVlan | null>(null);
  const [portModal, setPortModal] = useState<StpPort | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchStp());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load spanning tree state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const editAction = (label: string, onClick: () => void) => (
    <button
      type="button"
      title={label}
      aria-label="Edit"
      onClick={onClick}
      className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
    >
      <Pencil size={14} />
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Spanning Tree
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Loop-free L2 topology — bridge settings, per-VLAN instances, and port roles
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading spanning tree…</div>
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
          <FeatureUnavailable feature="Spanning tree" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <Segmented
              items={[
                { value: "global", label: "Global" },
                { value: "vlans", label: "VLANs" },
                { value: "ports", label: "Ports" },
              ]}
              value={section}
              onChange={(v) => setSection(v as Section)}
            />

            {section === "global" && (
              <StpGlobalPanel
                doc={doc}
                onSaved={(message) => {
                  setToast(message);
                  load("refresh");
                }}
              />
            )}

            {section === "vlans" && (
              <DataTable
                rows={doc.vlans}
                columns={vlanColumns}
                rowId={(r) => String(r.vlan_id)}
                storageKey="switching-stp-vlans"
                searchPlaceholder="Search VLANs…"
                emptyMessage="No VLANs configured."
                onRefresh={() => load("refresh")}
                onRowDoubleClick={(r) => setVlanModal(r)}
                actionsWidth={60}
                actions={(r) => editAction(`Edit VLAN ${r.vlan_id}`, () => setVlanModal(r))}
              />
            )}

            {section === "ports" && (
              <DataTable
                rows={doc.ports}
                columns={portColumns()}
                rowId={(r) => r.name}
                storageKey="switching-stp-ports"
                searchPlaceholder="Search ports…"
                emptyMessage="No STP-capable interfaces."
                onRefresh={() => load("refresh")}
                onRowDoubleClick={(r) => setPortModal(r)}
                actionsWidth={60}
                actions={(r) => editAction(`Edit ${r.name}`, () => setPortModal(r))}
              />
            )}
          </div>
        )}
      </div>

      {vlanModal && (
        <StpVlanFormModal
          vlan={vlanModal}
          onClose={() => setVlanModal(null)}
          onSaved={(message) => {
            setVlanModal(null);
            setToast(message);
            load("refresh");
          }}
        />
      )}
      {portModal && doc && (
        <StpPortFormModal
          port={portModal}
          mstMode={doc.global?.mode === "mst"}
          onClose={() => setPortModal(null)}
          onSaved={(message) => {
            setPortModal(null);
            setToast(message);
            load("refresh");
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
