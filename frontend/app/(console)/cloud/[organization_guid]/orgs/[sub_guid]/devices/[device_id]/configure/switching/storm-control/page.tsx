"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Pencil, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import {
  FeatureReadOnlyNotice,
  FeatureUnavailable,
} from "@/components/device/FeatureUnavailable";
import {
  StormControlDoc,
  StormControlPort,
  fetchStormControl,
} from "@/lib/device/sonic-storm-control";
import { StormControlFormModal } from "./StormControlFormModal";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

/// "10,000 kbps" cells, dash when the class has no limit.
function kbps(v: number | null): React.ReactNode {
  return v != null ? `${v.toLocaleString()} kbps` : dash;
}

const columns: Column<StormControlPort>[] = [
  { key: "port", header: "Port", value: (r) => r.port, mono: true, sortable: true, width: 130 },
  {
    key: "alias",
    header: "Alias",
    value: (r) => r.alias ?? "",
    render: (r) => (r.alias ? r.alias : dash),
    mono: true,
    width: 110,
  },
  {
    key: "broadcast",
    header: "Broadcast",
    value: (r) => r.broadcast_kbps ?? -1,
    render: (r) => kbps(r.broadcast_kbps),
    mono: true,
    sortable: true,
    width: 140,
  },
  {
    key: "uucast",
    header: "Unknown Unicast",
    value: (r) => r.unknown_unicast_kbps ?? -1,
    render: (r) => kbps(r.unknown_unicast_kbps),
    mono: true,
    sortable: true,
    width: 155,
  },
  {
    key: "umcast",
    header: "Unknown Multicast",
    value: (r) => r.unknown_multicast_kbps ?? -1,
    render: (r) => kbps(r.unknown_multicast_kbps),
    mono: true,
    sortable: true,
    width: 160,
  },
  {
    key: "protected",
    header: "Protection",
    value: (r) =>
      r.broadcast_kbps != null || r.unknown_unicast_kbps != null || r.unknown_multicast_kbps != null
        ? "limited"
        : "none",
    render: (r) =>
      r.broadcast_kbps != null || r.unknown_unicast_kbps != null || r.unknown_multicast_kbps != null ? (
        <span className="badge badge-ok">Limited</span>
      ) : (
        <span className="badge badge-muted">None</span>
      ),
    sortable: true,
    width: 110,
  },
];

export default function StormControlPage() {
  const [doc, setDoc] = useState<StormControlDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [editing, setEditing] = useState<StormControlPort | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchStormControl());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load storm control state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const editable = doc?.capability.supported && !doc.capability.read_only;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Storm Control
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Per-port rate limits for broadcast, unknown-unicast, and unknown-multicast floods
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading storm control…</div>
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
          <FeatureUnavailable feature="Storm control" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <DataTable
              rows={doc.ports}
              columns={columns}
              rowId={(r) => r.port}
              storageKey="switching-storm-control"
              searchPlaceholder="Search ports…"
              emptyMessage="No ports reported."
              onRefresh={() => load("refresh")}
              onRowDoubleClick={editable ? (r) => setEditing(r) : undefined}
              actionsWidth={60}
              actions={
                editable
                  ? (r) => (
                      <button
                        type="button"
                        title={`Edit ${r.port}`}
                        aria-label="Edit"
                        onClick={() => setEditing(r)}
                        className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                      >
                        <Pencil size={14} />
                      </button>
                    )
                  : undefined
              }
            />
          </div>
        )}
      </div>

      {editing && (
        <StormControlFormModal
          port={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
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
