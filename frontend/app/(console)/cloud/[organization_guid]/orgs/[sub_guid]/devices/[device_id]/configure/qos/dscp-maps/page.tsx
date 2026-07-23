"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Pencil, Plus, RotateCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import {
  FeatureReadOnlyNotice,
  FeatureUnavailable,
} from "@/components/device/FeatureUnavailable";
import { DscpTcMap, QosDoc, deleteDscpMap, fetchQos } from "@/lib/device/sonic-qos";
import { DscpMapFormModal } from "./DscpMapFormModal";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

const columns: Column<DscpTcMap>[] = [
  { key: "name", header: "Map", value: (r) => r.name, mono: true, sortable: true, width: 200 },
  {
    key: "entries",
    header: "Mapped Code Points",
    value: (r) => r.entries.length,
    render: (r) => `${r.entries.length} of 64`,
    mono: true,
    sortable: true,
    width: 160,
  },
  {
    key: "classes",
    header: "Traffic Classes Used",
    value: (r) => new Set(r.entries.map((e) => e.tc)).size,
    render: (r) => {
      const tcs = [...new Set(r.entries.map((e) => e.tc))].sort((a, b) => a - b);
      return tcs.length ? tcs.join(", ") : dash;
    },
    mono: true,
    width: 170,
  },
  {
    key: "bound",
    header: "Bound Ports",
    value: (r) => r.bound_ports.length,
    render: (r) =>
      r.bound_ports.length ? (
        <span title={r.bound_ports.join(", ")}>{r.bound_ports.length}</span>
      ) : (
        dash
      ),
    mono: true,
    sortable: true,
    width: 110,
  },
];

/// DSCP→traffic-class map objects (CONFIG_DB DSCP_TO_TC_MAP). Ports opt in
/// on the Port Trust page; a map can't be deleted while ports are bound.
export default function DscpMapsPage() {
  const [doc, setDoc] = useState<QosDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState<DscpTcMap | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchQos());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load QoS state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const removeMap = async (r: DscpTcMap) => {
    setDeleting(true);
    try {
      await deleteDscpMap(r.name);
      setToast(`Deleted DSCP map ${r.name}.`);
      setConfirmDelete(null);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to delete the map.");
    } finally {
      setDeleting(false);
    }
  };

  const editable = doc?.capability.supported && !doc.capability.read_only;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          DSCP Maps
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          DSCP→traffic-class maps that classify trusted traffic — bind them to ports on the Port Trust page
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading QoS maps…</div>
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
          <FeatureUnavailable feature="QoS" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <DataTable
              rows={doc.dscp_tc_maps}
              columns={columns}
              rowId={(r) => r.name}
              storageKey="qos-dscp-maps"
              searchPlaceholder="Search maps…"
              emptyMessage="No DSCP maps yet — create one, then bind it to ports on the Port Trust page."
              onRefresh={() => load("refresh")}
              onRowDoubleClick={editable ? (r) => setEditing(r) : undefined}
              toolbar={
                editable ? (
                  <Button icon={Plus} onClick={() => setCreating(true)}>
                    Create map
                  </Button>
                ) : undefined
              }
              actionsWidth={confirmDelete ? 90 : 60}
              actions={
                editable
                  ? (r) =>
                      confirmDelete === r.name ? (
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            title="Confirm delete"
                            aria-label="Confirm delete"
                            disabled={deleting}
                            onClick={() => removeMap(r)}
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
                            title={`Edit ${r.name}`}
                            aria-label="Edit"
                            onClick={() => setEditing(r)}
                            className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            title={
                              r.bound_ports.length
                                ? `Unbind ${r.bound_ports.length} port(s) before deleting`
                                : `Delete ${r.name}`
                            }
                            aria-label="Delete"
                            disabled={r.bound_ports.length > 0}
                            onClick={() => setConfirmDelete(r.name)}
                            className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>
                      )
                  : undefined
              }
            />
          </div>
        )}
      </div>

      {(creating || editing) && doc && (
        <DscpMapFormModal
          map={editing}
          existingNames={doc.dscp_tc_maps.map((m) => m.name)}
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
