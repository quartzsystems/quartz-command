"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Pencil, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable, FilterDef } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import {
  L3Interface,
  L3InterfacesDoc,
  deleteLoopback,
  fetchL3Interfaces,
  fetchVrfs,
} from "@/lib/device/sonic-routing";
import { L3InterfaceFormModal } from "./L3InterfaceFormModal";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

const KIND_LABEL: Record<L3Interface["kind"], string> = {
  port: "Port",
  "port-channel": "Port Channel",
  vlan: "VLAN (SVI)",
  loopback: "Loopback",
};

function LinkPill({ iface }: { iface: L3Interface }) {
  if (iface.oper_status === "up") return <span className="badge badge-ok">Up</span>;
  if (iface.oper_status === "down") return <span className="badge badge-crit">Down</span>;
  return <span className="badge badge-muted">Unknown</span>;
}

const columns: Column<L3Interface>[] = [
  { key: "name", header: "Interface", value: (r) => r.name, mono: true, sortable: true, width: 140 },
  {
    key: "kind",
    header: "Type",
    value: (r) => r.kind,
    render: (r) => KIND_LABEL[r.kind],
    sortable: true,
    width: 120,
  },
  {
    key: "description",
    header: "Description",
    value: (r) => r.description ?? "",
    render: (r) => (r.description ? r.description : dash),
    width: 160,
  },
  {
    key: "vrf",
    header: "VRF",
    value: (r) => r.vrf ?? "",
    render: (r) => (r.vrf ? <span className="badge badge-info">{r.vrf}</span> : <span className="text-[var(--qz-fg-4)]">default</span>),
    sortable: true,
    width: 130,
  },
  {
    key: "ips",
    header: "IP Addresses",
    value: (r) => r.ip_addresses.join(", "),
    render: (r) => (r.ip_addresses.length ? r.ip_addresses.join(", ") : dash),
    mono: true,
  },
  {
    key: "link",
    header: "Link",
    value: (r) => r.oper_status,
    render: (r) => <LinkPill iface={r} />,
    sortable: true,
    width: 100,
  },
];

const filters: FilterDef<L3Interface>[] = [
  {
    key: "kind",
    label: "Type",
    options: [
      { value: "port", label: "Port" },
      { value: "port-channel", label: "Port Channel" },
      { value: "vlan", label: "VLAN (SVI)" },
      { value: "loopback", label: "Loopback" },
    ],
    predicate: (r, v) => r.kind === v,
  },
  {
    key: "addressed",
    label: "Addressing",
    options: [
      { value: "addressed", label: "Has addresses" },
      { value: "unaddressed", label: "No addresses" },
    ],
    predicate: (r, v) => (v === "addressed" ? r.ip_addresses.length > 0 : r.ip_addresses.length === 0),
  },
];

export default function L3InterfacesPage() {
  const [doc, setDoc] = useState<L3InterfacesDoc | null>(null);
  const [vrfNames, setVrfNames] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [modal, setModal] = useState<
    { mode: "create-loopback" } | { mode: "edit"; iface: L3Interface } | null
  >(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      const [d, vrfs] = await Promise.all([fetchL3Interfaces(), fetchVrfs()]);
      setDoc(d);
      setVrfNames(vrfs.vrfs.map((v) => v.name));
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load L3 interfaces.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const removeLoopback = async (iface: L3Interface) => {
    try {
      await deleteLoopback(iface.name);
      setToast(`Deleted ${iface.name}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete ${iface.name}.`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          L3 Interfaces
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          IP addressing and VRF binding for ports, port channels, SVIs, and loopbacks
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading L3 interfaces…</div>
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
          <FeatureUnavailable feature="L3 interfaces" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <DataTable
            rows={doc.interfaces}
            columns={columns}
            filters={filters}
            rowId={(r) => r.name}
            storageKey="routing-l3-interfaces"
            searchPlaceholder="Search interfaces…"
            emptyMessage="No L3-capable interfaces."
            onRefresh={() => load("refresh")}
            onRowDoubleClick={(r) => setModal({ mode: "edit", iface: r })}
            toolbar={
              <Button size="sm" icon={Plus} onClick={() => setModal({ mode: "create-loopback" })}>
                Add Loopback
              </Button>
            }
            actions={(r) =>
              r.kind === "loopback" ? (
                <RowActions
                  label={r.name}
                  onEdit={() => setModal({ mode: "edit", iface: r })}
                  onDelete={() => removeLoopback(r)}
                />
              ) : (
                <button
                  type="button"
                  title={`Edit ${r.name}`}
                  aria-label="Edit"
                  onClick={() => setModal({ mode: "edit", iface: r })}
                  className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                >
                  <Pencil size={14} />
                </button>
              )
            }
          />
        )}
      </div>

      {modal && doc && (
        <L3InterfaceFormModal
          iface={modal.mode === "edit" ? modal.iface : undefined}
          existing={doc.interfaces}
          vrfNames={vrfNames}
          onClose={() => setModal(null)}
          onSaved={(message) => {
            setModal(null);
            setToast(message);
            load("refresh");
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
