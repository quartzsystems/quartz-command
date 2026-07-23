"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Toast } from "@/components/dashboard/Toast";
import {
  FeatureReadOnlyNotice,
  FeatureUnavailable,
} from "@/components/device/FeatureUnavailable";
import {
  MirrorSession,
  MirrorSessionDoc,
  deleteMirrorSession,
  fetchMirrorSessions,
} from "@/lib/device/sonic-mirror";
import { fetchPortChannels, fetchSwitchPorts, shortInterfaceName } from "@/lib/device/switching";
import { MirrorSessionFormModal } from "./MirrorSessionFormModal";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

const DIRECTION_LABEL: Record<MirrorSession["direction"], string> = {
  rx: "RX",
  tx: "TX",
  both: "Both",
};

const columns: Column<MirrorSession>[] = [
  { key: "name", header: "Name", value: (r) => r.name, mono: true, sortable: true, width: 150 },
  {
    key: "type",
    header: "Type",
    value: (r) => r.type,
    render: (r) => (
      <span className={`badge ${r.type === "span" ? "badge-info" : "badge-ok"}`}>
        {r.type.toUpperCase()}
      </span>
    ),
    sortable: true,
    width: 95,
  },
  {
    key: "direction",
    header: "Direction",
    value: (r) => r.direction,
    render: (r) => DIRECTION_LABEL[r.direction],
    width: 95,
  },
  {
    key: "sources",
    header: "Source Ports",
    value: (r) => r.source_ports.join(", "),
    render: (r) =>
      r.source_ports.length ? (
        <span className="inline-flex flex-wrap gap-x-2">
          {r.source_ports.map((p) => (
            <span key={p} title={p}>{shortInterfaceName(p)}</span>
          ))}
        </span>
      ) : (
        dash
      ),
    mono: true,
  },
  {
    key: "destination",
    header: "Destination",
    value: (r) => r.dst_port ?? r.erspan?.dst_ip ?? "",
    render: (r) =>
      r.type === "span"
        ? r.dst_port ?? dash
        : r.erspan
          ? `${r.erspan.dst_ip} (GRE)`
          : dash,
    mono: true,
    width: 170,
  },
  {
    key: "status",
    header: "Status",
    value: (r) => r.status ?? "unknown",
    render: (r) =>
      r.status === "active" ? (
        <span className="badge badge-ok">Active</span>
      ) : r.status === "inactive" ? (
        <span className="badge badge-warn">Inactive</span>
      ) : (
        <span className="badge badge-muted">Unknown</span>
      ),
    sortable: true,
    width: 100,
  },
];

export default function PortMirroringPage() {
  const [doc, setDoc] = useState<MirrorSessionDoc | null>(null);
  const [ports, setPorts] = useState<string[]>([]);
  const [portChannels, setPortChannels] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");

  // null = closed; { session: undefined } = create; { session } = edit.
  const [modal, setModal] = useState<{ session?: MirrorSession } | null>(null);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      // Interface names populate the form's pickers; tolerate their failure
      // so a sessions read still renders.
      const [d, p, pc] = await Promise.all([
        fetchMirrorSessions(),
        fetchSwitchPorts().catch(() => []),
        fetchPortChannels().catch(() => []),
      ]);
      setDoc(d);
      setPorts(p.map((x) => x.name));
      setPortChannels(pc.map((x) => x.name));
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load mirror sessions.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (row: MirrorSession) => {
    try {
      await deleteMirrorSession(row.name);
      setToast(`Deleted mirror session ${row.name}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete session ${row.name}.`);
    }
  };

  const editable = doc?.capability.supported && !doc.capability.read_only;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Port Mirroring
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Copy port traffic to a local analyzer port (SPAN) or a remote collector over GRE (ERSPAN)
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading mirror sessions…</div>
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
          <FeatureUnavailable feature="Port mirroring" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <DataTable
              rows={doc.sessions}
              columns={columns}
              rowId={(r) => r.name}
              storageKey="switching-mirror-sessions"
              searchPlaceholder="Search sessions…"
              emptyMessage="No mirror sessions configured."
              onRefresh={() => load("refresh")}
              onRowDoubleClick={editable ? (r) => setModal({ session: r }) : undefined}
              toolbar={
                editable ? (
                  <Button kind="primary" size="sm" icon={Plus} onClick={() => setModal({})}>
                    Create session
                  </Button>
                ) : undefined
              }
              actions={
                editable
                  ? (row) => (
                      <RowActions
                        label={`session ${row.name}`}
                        onEdit={() => setModal({ session: row })}
                        onDelete={() => remove(row)}
                      />
                    )
                  : undefined
              }
            />
          </div>
        )}
      </div>

      {modal && (
        <MirrorSessionFormModal
          initial={modal.session}
          existing={doc?.sessions ?? []}
          ports={ports}
          portChannels={portChannels}
          onClose={() => setModal(null)}
          onSaved={(msg) => {
            setModal(null);
            setToast(msg);
            load("refresh");
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
