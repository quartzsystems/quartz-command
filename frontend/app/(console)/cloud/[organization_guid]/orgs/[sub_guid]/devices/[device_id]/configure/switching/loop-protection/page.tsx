"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Pencil, RotateCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable, FilterDef } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import {
  LoopProtectionDoc,
  LoopProtectionPort,
  fetchLoopProtection,
  recoverLoopProtectionPort,
} from "@/lib/device/stp";
import { LoopGuardFormModal } from "./LoopGuardFormModal";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

function GuardPill({ on }: { on: boolean }) {
  return on ? (
    <span className="badge badge-ok">Enabled</span>
  ) : (
    <span className="badge badge-muted">Off</span>
  );
}

/// Live protection state: BPDU-guard shutdowns are the actionable red case.
function ProtectionStatePill({ port }: { port: LoopProtectionPort }) {
  if (port.bpdu_guard_shutdown) return <span className="badge badge-crit">Shut by BPDU Guard</span>;
  if (port.root_guard_active) return <span className="badge badge-warn">Root Guard blocking</span>;
  if (!port.stp_enabled) return dash;
  return <span className="badge badge-ok">OK</span>;
}

const columns: Column<LoopProtectionPort>[] = [
  { key: "name", header: "Interface", value: (r) => r.name, mono: true, sortable: true, width: 130 },
  {
    key: "stp",
    header: "STP",
    value: (r) => (r.stp_enabled ? "enabled" : "disabled"),
    render: (r) =>
      r.stp_enabled ? (
        <span className="badge badge-ok">Enabled</span>
      ) : (
        <span className="badge badge-muted">Disabled</span>
      ),
    sortable: true,
    width: 100,
  },
  {
    key: "bpdu_guard",
    header: "BPDU Guard",
    value: (r) => (r.bpdu_guard ? "on" : "off"),
    render: (r) => <GuardPill on={r.bpdu_guard} />,
    sortable: true,
    width: 115,
  },
  {
    key: "shutdown_mode",
    header: "On Violation",
    value: (r) => (r.bpdu_guard ? (r.bpdu_guard_do_disable ? "shutdown" : "alarm") : ""),
    render: (r) =>
      r.bpdu_guard ? (r.bpdu_guard_do_disable ? "Shut port" : "Alarm only") : dash,
    width: 115,
  },
  {
    key: "root_guard",
    header: "Root Guard",
    value: (r) => (r.root_guard ? "on" : "off"),
    render: (r) => <GuardPill on={r.root_guard} />,
    sortable: true,
    width: 110,
  },
  {
    key: "state",
    header: "Status",
    value: (r) =>
      r.bpdu_guard_shutdown ? "shutdown" : r.root_guard_active ? "blocking" : r.stp_enabled ? "ok" : "",
    render: (r) => <ProtectionStatePill port={r} />,
    sortable: true,
    width: 165,
  },
];

const filters: FilterDef<LoopProtectionPort>[] = [
  {
    key: "guard",
    label: "Guards",
    options: [
      { value: "bpdu", label: "BPDU Guard on" },
      { value: "root", label: "Root Guard on" },
      { value: "none", label: "No guards" },
    ],
    predicate: (r, v) =>
      v === "bpdu" ? r.bpdu_guard : v === "root" ? r.root_guard : !r.bpdu_guard && !r.root_guard,
  },
  {
    key: "state",
    label: "Status",
    options: [
      { value: "shutdown", label: "Shut by BPDU Guard" },
      { value: "ok", label: "OK" },
    ],
    predicate: (r, v) => (v === "shutdown" ? !!r.bpdu_guard_shutdown : !r.bpdu_guard_shutdown),
  },
];

export default function LoopProtectionPage() {
  const [doc, setDoc] = useState<LoopProtectionDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [editing, setEditing] = useState<LoopProtectionPort | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchLoopProtection());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load loop protection state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const recover = async (port: LoopProtectionPort) => {
    try {
      await recoverLoopProtectionPort(port.name);
      setToast(`Re-enabled ${port.name}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to re-enable ${port.name}.`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Loop Protection
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Per-port BPDU Guard and Root Guard, with recovery of guard-shutdown ports
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading loop protection…</div>
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
          <FeatureUnavailable feature="Loop protection" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <DataTable
            rows={doc.ports}
            columns={columns}
            filters={filters}
            rowId={(r) => r.name}
            storageKey="switching-loop-protection"
            searchPlaceholder="Search ports…"
            emptyMessage="No STP-capable interfaces."
            onRefresh={() => load("refresh")}
            onRowDoubleClick={(r) => setEditing(r)}
            actionsWidth={90}
            actions={(r) => (
              <span className="inline-flex gap-1">
                {r.bpdu_guard_shutdown && (
                  <button
                    type="button"
                    title={`Re-enable ${r.name}`}
                    aria-label="Re-enable"
                    onClick={() => recover(r)}
                    className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-warn)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                  >
                    <Undo2 size={14} />
                  </button>
                )}
                <button
                  type="button"
                  title={`Edit ${r.name}`}
                  aria-label="Edit"
                  onClick={() => setEditing(r)}
                  className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                >
                  <Pencil size={14} />
                </button>
              </span>
            )}
          />
        )}
      </div>

      {editing && (
        <LoopGuardFormModal
          port={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setToast(message);
            load("refresh");
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
