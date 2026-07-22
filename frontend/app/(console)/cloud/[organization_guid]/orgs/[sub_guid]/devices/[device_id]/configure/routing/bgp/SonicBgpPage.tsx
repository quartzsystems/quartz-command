"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Toast } from "@/components/dashboard/Toast";
import {
  FeatureReadOnlyNotice,
  FeatureUnavailable,
} from "@/components/device/FeatureUnavailable";
import {
  BGP_AF_LABEL,
  BgpDoc,
  BgpNeighbor,
  deleteBgpNeighbor,
  fetchBgpDoc,
} from "@/lib/device/sonic-bgp";
import { SonicBgpGlobalsPanel } from "./SonicBgpGlobalsPanel";
import { SonicBgpNeighborModal } from "./SonicBgpNeighborModal";

type Section = "global" | "neighbors";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

function SessionPill({ neighbor }: { neighbor: BgpNeighbor }) {
  if (neighbor.admin_status === "down") return <span className="badge badge-muted">Shutdown</span>;
  const s = neighbor.session_state;
  if (!s) return dash;
  if (s.toLowerCase() === "established") return <span className="badge badge-ok">Established</span>;
  if (["idle", "active"].includes(s.toLowerCase())) return <span className="badge badge-crit">{s}</span>;
  return <span className="badge badge-warn">{s}</span>;
}

const neighborColumns: Column<BgpNeighbor>[] = [
  { key: "peer", header: "Neighbor", value: (r) => r.peer, mono: true, sortable: true, width: 150 },
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
    key: "remote_asn",
    header: "Remote AS",
    value: (r) => r.remote_asn ?? -1,
    render: (r) => (r.remote_asn != null ? r.remote_asn : dash),
    mono: true,
    sortable: true,
    width: 110,
  },
  {
    key: "name",
    header: "Description",
    value: (r) => r.name ?? "",
    render: (r) => (r.name ? r.name : dash),
    width: 150,
  },
  {
    key: "afs",
    header: "Address Families",
    value: (r) => r.address_families.join(","),
    render: (r) =>
      r.address_families.length ? (
        <span className="inline-flex gap-1">
          {r.address_families.map((af) => (
            <span key={af} className="badge badge-info">
              {BGP_AF_LABEL[af]}
            </span>
          ))}
        </span>
      ) : (
        dash
      ),
    width: 160,
  },
  {
    key: "flags",
    header: "Flags",
    value: (r) => [r.bfd && "bfd", r.ebgp_multihop_ttl != null && "multihop"].filter(Boolean).join(","),
    render: (r) => {
      const flags = [r.bfd && "BFD", r.ebgp_multihop_ttl != null && `multihop ${r.ebgp_multihop_ttl}`].filter(
        Boolean,
      ) as string[];
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
  {
    key: "prefixes",
    header: "Prefixes",
    value: (r) => r.prefixes_received ?? -1,
    render: (r) => (r.prefixes_received != null ? r.prefixes_received : dash),
    mono: true,
    sortable: true,
    width: 95,
  },
  {
    key: "state",
    header: "State",
    value: (r) => r.session_state ?? "",
    render: (r) => <SessionPill neighbor={r} />,
    sortable: true,
    width: 125,
  },
];

/// BGP editor for QuartzSONiC switches: per-VRF globals (ASN, router-id,
/// timers) and the neighbor table, backed by the agent's frrcfgd CONFIG_DB
/// path with live session state.
export function SonicBgpPage() {
  const [doc, setDoc] = useState<BgpDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [section, setSection] = useState<Section>("global");
  const [modal, setModal] = useState<
    { mode: "create" } | { mode: "edit"; neighbor: BgpNeighbor } | null
  >(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchBgpDoc());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load BGP state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (n: BgpNeighbor) => {
    try {
      await deleteBgpNeighbor(n.vrf, n.peer);
      setToast(`Deleted neighbor ${n.peer}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete ${n.peer}.`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          BGP
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Border Gateway Protocol — autonomous system, neighbors, and session state
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading BGP…</div>
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
          <FeatureUnavailable feature="BGP" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />
            <Segmented
              items={[
                { value: "global", label: "Global" },
                { value: "neighbors", label: "Neighbors" },
              ]}
              value={section}
              onChange={(v) => setSection(v as Section)}
            />

            {section === "global" && (
              <SonicBgpGlobalsPanel
                doc={doc}
                onSaved={(message) => {
                  setToast(message);
                  load("refresh");
                }}
              />
            )}

            {section === "neighbors" && (
              <DataTable
                rows={doc.neighbors}
                columns={neighborColumns}
                rowId={(r) => `${r.vrf}:${r.peer}`}
                storageKey="routing-sonic-bgp-neighbors"
                searchPlaceholder="Search neighbors…"
                emptyMessage="No BGP neighbors configured."
                onRefresh={() => load("refresh")}
                onRowDoubleClick={(r) => setModal({ mode: "edit", neighbor: r })}
                toolbar={
                  <Button size="sm" icon={Plus} onClick={() => setModal({ mode: "create" })}>
                    Add Neighbor
                  </Button>
                }
                actions={(r) => (
                  <RowActions
                    label={`neighbor ${r.peer}`}
                    onEdit={() => setModal({ mode: "edit", neighbor: r })}
                    onDelete={() => remove(r)}
                  />
                )}
              />
            )}
          </div>
        )}
      </div>

      {modal && doc && (
        <SonicBgpNeighborModal
          initial={modal.mode === "edit" ? modal.neighbor : undefined}
          existing={doc.neighbors}
          vrfs={doc.globals.map((g) => g.vrf)}
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
