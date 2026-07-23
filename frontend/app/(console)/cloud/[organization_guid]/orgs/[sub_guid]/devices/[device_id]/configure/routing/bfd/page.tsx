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
import { BfdDoc, BfdPeer, deleteBfdPeer, fetchBfd } from "@/lib/device/sonic-bfd";
import { BfdPeerFormModal } from "./BfdPeerFormModal";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

const columns: Column<BfdPeer>[] = [
  { key: "peer", header: "Peer", value: (r) => r.peer, mono: true, sortable: true, width: 170 },
  {
    key: "type",
    header: "Type",
    value: (r) => (r.multihop ? "multihop" : "single-hop"),
    render: (r) =>
      r.multihop ? (
        <span className="badge badge-info">Multihop</span>
      ) : (
        <span className="badge badge-muted">Single-hop</span>
      ),
    sortable: true,
    width: 110,
  },
  {
    key: "interface",
    header: "Interface",
    value: (r) => r.interface ?? "",
    render: (r) => (r.interface ? r.interface : dash),
    mono: true,
    sortable: true,
    width: 130,
  },
  {
    key: "local",
    header: "Local Address",
    value: (r) => r.local_address ?? "",
    render: (r) => (r.local_address ? r.local_address : dash),
    mono: true,
    width: 150,
  },
  {
    key: "vrf",
    header: "VRF",
    value: (r) => r.vrf ?? "default",
    render: (r) => (r.vrf ? r.vrf : <span className="text-[var(--qz-fg-4)]">default</span>),
    mono: true,
    sortable: true,
    width: 110,
  },
  {
    key: "intervals",
    header: "RX / TX (ms)",
    value: (r) => r.rx_interval_ms ?? 300,
    render: (r) => `${r.rx_interval_ms ?? 300} / ${r.tx_interval_ms ?? 300}`,
    mono: true,
    width: 120,
  },
  {
    key: "multiplier",
    header: "Multiplier",
    value: (r) => r.multiplier ?? 3,
    render: (r) => String(r.multiplier ?? 3),
    mono: true,
    width: 95,
  },
  {
    key: "admin",
    header: "Admin",
    value: (r) => (r.shutdown ? "shutdown" : r.passive ? "passive" : "active"),
    render: (r) =>
      r.shutdown ? (
        <span className="badge badge-muted">Shutdown</span>
      ) : r.passive ? (
        <span className="badge badge-info">Passive</span>
      ) : (
        <span className="badge badge-ok">Active</span>
      ),
    sortable: true,
    width: 100,
  },
];

const peerId = (r: BfdPeer) =>
  `${r.vrf ?? "default"}|${r.interface ?? "-"}|${r.peer}|${r.multihop ? "mh" : "sh"}`;

/// Configured BFD peers (FRR bfdd). Live session state — including sessions
/// BGP/OSPF bring up dynamically — is under Monitor → Routing → BFD.
export default function BfdPage() {
  const [doc, setDoc] = useState<BfdDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState<BfdPeer | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchBfd());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load BFD peers.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const removePeer = async (r: BfdPeer) => {
    setDeleting(true);
    try {
      await deleteBfdPeer({
        peer: r.peer,
        interface: r.interface,
        vrf: r.vrf,
        multihop: r.multihop,
      });
      setToast(`Deleted BFD peer ${r.peer}.`);
      setConfirmDelete(null);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to delete the peer.");
    } finally {
      setDeleting(false);
    }
  };

  const editable = doc?.capability.supported && !doc.capability.read_only;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          BFD
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Bidirectional Forwarding Detection peers protecting BGP, OSPF, and static next hops
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading BFD peers…</div>
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
          <FeatureUnavailable feature="BFD" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <DataTable
              rows={doc.peers}
              columns={columns}
              rowId={peerId}
              storageKey="routing-bfd-peers"
              searchPlaceholder="Search peers…"
              emptyMessage="No BFD peers configured. Sessions raised dynamically by BGP/OSPF appear under Monitor → Routing → BFD."
              onRefresh={() => load("refresh")}
              onRowDoubleClick={editable ? (r) => setEditing(r) : undefined}
              toolbar={
                editable ? (
                  <Button icon={Plus} onClick={() => setCreating(true)}>
                    Add peer
                  </Button>
                ) : undefined
              }
              actionsWidth={confirmDelete ? 90 : 60}
              actions={
                editable
                  ? (r) => {
                      const id = peerId(r);
                      return confirmDelete === id ? (
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            title="Confirm delete"
                            aria-label="Confirm delete"
                            disabled={deleting}
                            onClick={() => removePeer(r)}
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
                            title={`Edit ${r.peer}`}
                            aria-label="Edit"
                            onClick={() => setEditing(r)}
                            className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            title={`Delete ${r.peer}`}
                            aria-label="Delete"
                            onClick={() => setConfirmDelete(id)}
                            className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>
                      );
                    }
                  : undefined
              }
            />
          </div>
        )}
      </div>

      {(creating || editing) && (
        <BfdPeerFormModal
          peer={editing}
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
