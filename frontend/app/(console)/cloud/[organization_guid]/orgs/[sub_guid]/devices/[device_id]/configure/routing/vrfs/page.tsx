"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import { shortInterfaceName } from "@/lib/device/switching";
import {
  Vrf,
  VrfsDoc,
  deleteVrf,
  fetchVrfs,
  setMgmtVrf,
} from "@/lib/device/sonic-routing";
import { VrfFormModal } from "./VrfFormModal";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

const columns: Column<Vrf>[] = [
  { key: "name", header: "Name", value: (r) => r.name, mono: true, sortable: true, width: 160 },
  {
    key: "vni",
    header: "L3 VNI",
    value: (r) => r.vni ?? -1,
    render: (r) => (r.vni != null ? r.vni : dash),
    mono: true,
    sortable: true,
    width: 100,
  },
  {
    key: "fallback",
    header: "Fallback",
    value: (r) => (r.fallback ? "on" : "off"),
    render: (r) =>
      r.fallback ? (
        <span className="badge badge-info" title="Falls back to default VRF routes on lookup miss">
          Enabled
        </span>
      ) : (
        <span className="badge badge-muted">Off</span>
      ),
    sortable: true,
    width: 100,
  },
  {
    key: "interfaces",
    header: "Interfaces",
    value: (r) => r.interfaces.join(", "),
    render: (r) =>
      r.interfaces.length ? (
        <span className="inline-flex flex-wrap gap-x-2">
          {r.interfaces.map((i) => (
            <span key={i} title={i}>
              {shortInterfaceName(i)}
            </span>
          ))}
        </span>
      ) : (
        dash
      ),
    mono: true,
  },
  {
    key: "iface_count",
    header: "Bound",
    value: (r) => r.interfaces.length,
    mono: true,
    sortable: true,
    width: 80,
  },
];

export default function VrfsPage() {
  const [doc, setDoc] = useState<VrfsDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; vrf: Vrf } | null>(null);
  const [toast, setToast] = useState("");
  const [togglingMgmt, setTogglingMgmt] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchVrfs());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load VRFs.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (vrf: Vrf) => {
    try {
      await deleteVrf(vrf.name);
      setToast(`Deleted ${vrf.name}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete ${vrf.name}.`);
    }
  };

  const toggleMgmt = async (enabled: boolean) => {
    setTogglingMgmt(true);
    try {
      await setMgmtVrf(enabled);
      setToast(enabled ? "Enabled management VRF." : "Disabled management VRF.");
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to toggle management VRF.");
    } finally {
      setTogglingMgmt(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          VRFs
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Virtual routing and forwarding instances and their interface bindings
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading VRFs…</div>
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
          <FeatureUnavailable feature="VRFs" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <div
              className="flex items-center justify-between max-w-[640px] rounded-xl px-6 py-4"
              style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)", opacity: togglingMgmt ? 0.6 : 1 }}
            >
              <div>
                <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">Management VRF</p>
                <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
                  Isolate the management interface in its own VRF — toggling restarts management
                  services on the switch
                </p>
              </div>
              <Switch on={doc.mgmt_vrf_enabled} onChange={togglingMgmt ? () => {} : toggleMgmt} />
            </div>

            <DataTable
              rows={doc.vrfs}
              columns={columns}
              rowId={(r) => r.name}
              storageKey="routing-vrfs"
              searchPlaceholder="Search VRFs…"
              emptyMessage="No VRFs configured."
              onRefresh={() => load("refresh")}
              onRowDoubleClick={(r) => setModal({ mode: "edit", vrf: r })}
              toolbar={
                <Button size="sm" icon={Plus} onClick={() => setModal({ mode: "create" })}>
                  Add VRF
                </Button>
              }
              actions={(r) => (
                <RowActions
                  label={r.name}
                  onEdit={() => setModal({ mode: "edit", vrf: r })}
                  onDelete={() => remove(r)}
                />
              )}
            />
          </div>
        )}
      </div>

      {modal && doc && (
        <VrfFormModal
          initial={modal.mode === "edit" ? modal.vrf : undefined}
          existing={doc.vrfs}
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
