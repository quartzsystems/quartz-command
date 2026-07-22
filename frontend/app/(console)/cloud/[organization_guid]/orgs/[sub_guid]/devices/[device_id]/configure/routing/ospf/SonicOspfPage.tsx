"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Pencil, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import {
  OspfArea,
  OspfDoc,
  OspfInterface,
  OspfNeighborStatus,
  deleteOspfArea,
  fetchOspfDoc,
} from "@/lib/device/sonic-ospf";
import { SonicOspfInstancePanel } from "./SonicOspfInstancePanel";
import { SonicOspfAreaModal } from "./SonicOspfAreaModal";
import { SonicOspfInterfaceModal } from "./SonicOspfInterfaceModal";

type Section = "global" | "areas" | "interfaces" | "neighbors";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

/** Areas rows are flattened per-VRF so the table can show multi-VRF setups. */
interface AreaRow extends OspfArea {
  vrf: string;
}

const areaColumns: Column<AreaRow>[] = [
  { key: "area_id", header: "Area", value: (r) => r.area_id, mono: true, sortable: true, width: 130 },
  {
    key: "vrf",
    header: "VRF",
    value: (r) => r.vrf,
    render: (r) =>
      r.vrf === "default" ? <span className="text-[var(--qz-fg-4)]">default</span> : <span className="badge badge-info">{r.vrf}</span>,
    sortable: true,
    width: 110,
  },
  {
    key: "type",
    header: "Type",
    value: (r) => (r.stub ? "stub" : "normal"),
    render: (r) =>
      r.stub ? <span className="badge badge-info">Stub</span> : <span className="badge badge-muted">Normal</span>,
    sortable: true,
    width: 100,
  },
  {
    key: "networks",
    header: "Networks",
    value: (r) => r.networks.join(", "),
    render: (r) => (r.networks.length ? r.networks.join(", ") : dash),
    mono: true,
  },
];

const interfaceColumns: Column<OspfInterface>[] = [
  { key: "name", header: "Interface", value: (r) => r.name, mono: true, sortable: true, width: 140 },
  {
    key: "area",
    header: "Area",
    value: (r) => r.area ?? "",
    render: (r) => (r.area ? r.area : dash),
    mono: true,
    sortable: true,
    width: 120,
  },
  {
    key: "cost",
    header: "Cost",
    value: (r) => r.cost ?? -1,
    render: (r) => (r.cost != null ? r.cost : dash),
    mono: true,
    width: 85,
  },
  {
    key: "timers",
    header: "Hello / Dead",
    value: (r) => `${r.hello_interval ?? ""}/${r.dead_interval ?? ""}`,
    render: (r) =>
      r.hello_interval == null && r.dead_interval == null
        ? dash
        : `${r.hello_interval ?? "—"} / ${r.dead_interval ?? "—"}`,
    mono: true,
    width: 115,
  },
  {
    key: "network_type",
    header: "Network Type",
    value: (r) => r.network_type ?? "",
    render: (r) =>
      r.network_type === "point-to-point" ? "Point-to-point" : r.network_type === "broadcast" ? "Broadcast" : dash,
    width: 130,
  },
  {
    key: "flags",
    header: "Flags",
    value: (r) => [r.passive && "passive", r.bfd && "bfd"].filter(Boolean).join(","),
    render: (r) => {
      const flags = [r.passive && "passive", r.bfd && "BFD"].filter(Boolean) as string[];
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
    width: 140,
  },
];

const neighborColumns: Column<OspfNeighborStatus>[] = [
  { key: "neighbor_id", header: "Neighbor ID", value: (r) => r.neighbor_id, mono: true, sortable: true, width: 140 },
  { key: "address", header: "Address", value: (r) => r.address, mono: true, width: 140 },
  { key: "interface", header: "Interface", value: (r) => r.interface, mono: true, sortable: true, width: 140 },
  {
    key: "state",
    header: "State",
    value: (r) => r.state,
    render: (r) =>
      r.state.toLowerCase().startsWith("full") ? (
        <span className="badge badge-ok">{r.state}</span>
      ) : (
        <span className="badge badge-warn">{r.state}</span>
      ),
    sortable: true,
    width: 130,
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
    key: "dead_time",
    header: "Dead Time",
    value: (r) => r.dead_time_secs ?? -1,
    render: (r) => (r.dead_time_secs != null ? `${r.dead_time_secs}s` : dash),
    mono: true,
    width: 100,
  },
];

/// OSPFv2 editor for QuartzSONiC switches, backed by the agent's frrcfgd
/// CONFIG_DB path (OSPFV2_* tables) with FRR neighbor state.
export function SonicOspfPage() {
  const [doc, setDoc] = useState<OspfDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [section, setSection] = useState<Section>("global");
  const [areaModal, setAreaModal] = useState<{ area?: AreaRow } | null>(null);
  const [ifaceModal, setIfaceModal] = useState<OspfInterface | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchOspfDoc());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load OSPF state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const areaRows: AreaRow[] = (doc?.instances ?? []).flatMap((inst) =>
    inst.areas.map((a) => ({ ...a, vrf: inst.vrf })),
  );

  const removeArea = async (row: AreaRow) => {
    try {
      await deleteOspfArea(row.vrf, row.area_id);
      setToast(`Deleted area ${row.area_id}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete area ${row.area_id}.`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          OSPF
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          OSPFv2 — router instance, areas, interfaces, and adjacency state
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading OSPF…</div>
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
          <FeatureUnavailable feature="OSPF" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <Segmented
              items={[
                { value: "global", label: "Global" },
                { value: "areas", label: "Areas" },
                { value: "interfaces", label: "Interfaces" },
                { value: "neighbors", label: "Neighbors" },
              ]}
              value={section}
              onChange={(v) => setSection(v as Section)}
            />

            {section === "global" && (
              <SonicOspfInstancePanel
                doc={doc}
                onSaved={(message) => {
                  setToast(message);
                  load("refresh");
                }}
              />
            )}

            {section === "areas" && (
              <DataTable
                rows={areaRows}
                columns={areaColumns}
                rowId={(r) => `${r.vrf}:${r.area_id}`}
                storageKey="routing-sonic-ospf-areas"
                searchPlaceholder="Search areas…"
                emptyMessage="No OSPF areas configured."
                onRefresh={() => load("refresh")}
                onRowDoubleClick={(r) => setAreaModal({ area: r })}
                toolbar={
                  <Button size="sm" icon={Plus} onClick={() => setAreaModal({})}>
                    Add Area
                  </Button>
                }
                actions={(r) => (
                  <RowActions
                    label={`area ${r.area_id}`}
                    onEdit={() => setAreaModal({ area: r })}
                    onDelete={() => removeArea(r)}
                  />
                )}
              />
            )}

            {section === "interfaces" && (
              <DataTable
                rows={doc.interfaces}
                columns={interfaceColumns}
                rowId={(r) => r.name}
                storageKey="routing-sonic-ospf-interfaces"
                searchPlaceholder="Search interfaces…"
                emptyMessage="No L3 interfaces available for OSPF."
                onRefresh={() => load("refresh")}
                onRowDoubleClick={(r) => setIfaceModal(r)}
                actionsWidth={60}
                actions={(r) => (
                  <button
                    type="button"
                    title={`Edit ${r.name}`}
                    aria-label="Edit"
                    onClick={() => setIfaceModal(r)}
                    className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                  >
                    <Pencil size={14} />
                  </button>
                )}
              />
            )}

            {section === "neighbors" && (
              <DataTable
                rows={doc.neighbors}
                columns={neighborColumns}
                rowId={(r) => `${r.neighbor_id}:${r.interface}`}
                storageKey="routing-sonic-ospf-neighbors"
                searchPlaceholder="Search neighbors…"
                emptyMessage="No OSPF adjacencies."
                onRefresh={() => load("refresh")}
              />
            )}
          </div>
        )}
      </div>

      {areaModal && doc && (
        <SonicOspfAreaModal
          initial={areaModal.area}
          existing={areaRows}
          vrfs={doc.instances.length ? doc.instances.map((i) => i.vrf) : ["default"]}
          onClose={() => setAreaModal(null)}
          onSaved={(message) => {
            setAreaModal(null);
            setToast(message);
            load("refresh");
          }}
        />
      )}
      {ifaceModal && doc && (
        <SonicOspfInterfaceModal
          iface={ifaceModal}
          areas={[...new Set(areaRows.map((a) => a.area_id))]}
          onClose={() => setIfaceModal(null)}
          onSaved={(message) => {
            setIfaceModal(null);
            setToast(message);
            load("refresh");
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
