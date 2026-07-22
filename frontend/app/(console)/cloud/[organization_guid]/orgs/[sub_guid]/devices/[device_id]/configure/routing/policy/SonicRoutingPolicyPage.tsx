"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureReadOnlyNotice, FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import {
  RoutingPolicyDoc,
  SonicPrefixList,
  SonicRouteMap,
  deletePrefixList,
  deleteRouteMap,
  fetchRoutingPolicy,
} from "@/lib/device/sonic-routing-policy";
import { SonicPrefixListFormModal } from "./SonicPrefixListFormModal";
import { SonicRouteMapFormModal } from "./SonicRouteMapFormModal";

type Tab = "prefix-lists" | "route-maps";

const prefixColumns: Column<SonicPrefixList>[] = [
  { key: "name", header: "Name", value: (r) => r.name, mono: true, sortable: true },
  {
    key: "family",
    header: "Family",
    value: (r) => r.family,
    render: (r) => <span className="badge badge-info">{r.family === "ipv4" ? "IPv4" : "IPv6"}</span>,
    sortable: true,
    width: 100,
  },
  { key: "rules", header: "Rules", value: (r) => r.rules.length, mono: true, sortable: true, width: 90 },
  {
    key: "summary",
    header: "Summary",
    value: (r) => r.rules.map((x) => x.prefix).join(", "),
    render: (r) =>
      r.rules.length
        ? r.rules.map((x) => x.prefix).slice(0, 3).join(", ") + (r.rules.length > 3 ? " …" : "")
        : "—",
    mono: true,
  },
];

const routeMapColumns: Column<SonicRouteMap>[] = [
  { key: "name", header: "Name", value: (r) => r.name, mono: true, sortable: true },
  { key: "entries", header: "Entries", value: (r) => r.entries.length, mono: true, sortable: true, width: 90 },
  {
    key: "summary",
    header: "Summary",
    value: (r) => r.entries.map((x) => `${x.seq} ${x.action}`).join(", "),
    render: (r) =>
      r.entries.length ? r.entries.map((x) => `${x.seq}:${x.action}`).slice(0, 4).join("  ") : "—",
    mono: true,
  },
];

export function SonicRoutingPolicyPage() {
  const [doc, setDoc] = useState<RoutingPolicyDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [tab, setTab] = useState<Tab>("prefix-lists");
  const [toast, setToast] = useState("");

  const [prefixModal, setPrefixModal] = useState<{ list?: SonicPrefixList } | null>(null);
  const [routeMapModal, setRouteMapModal] = useState<{ map?: SonicRouteMap } | null>(null);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchRoutingPolicy());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load routing policy.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saved = (msg: string) => {
    setPrefixModal(null);
    setRouteMapModal(null);
    setToast(msg);
    load("refresh");
  };

  const removePrefix = async (row: SonicPrefixList) => {
    try {
      await deletePrefixList(row.name);
      setToast(`Deleted prefix-list ${row.name}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete ${row.name}.`);
    }
  };
  const removeRouteMap = async (row: SonicRouteMap) => {
    try {
      await deleteRouteMap(row.name);
      setToast(`Deleted route-map ${row.name}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete ${row.name}.`);
    }
  };

  const tabs: [Tab, string, number][] = [
    ["prefix-lists", "Prefix Lists", doc?.prefix_lists.length ?? 0],
    ["route-maps", "Route Maps", doc?.route_maps.length ?? 0],
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Routing Policy
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Prefix-lists and route-maps for filtering and shaping routes — referenced by BGP and OSPF
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading routing policy…</div>
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
          <FeatureUnavailable feature="Routing policy" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <div className="flex items-center gap-1 border-b border-[var(--qz-border)]">
              {tabs.map(([id, label, count]) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={[
                      "px-3 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors cursor-pointer",
                      active
                        ? "text-[var(--qz-accent)] border-[var(--qz-accent)]"
                        : "text-[var(--qz-fg-3)] border-transparent hover:text-[var(--qz-fg-1)]",
                    ].join(" ")}
                  >
                    {label}
                    <span className="ml-[6px] text-[12px] text-[var(--qz-fg-4)]">{count}</span>
                  </button>
                );
              })}
            </div>

            {tab === "prefix-lists" && (
              <DataTable
                rows={doc.prefix_lists}
                columns={prefixColumns}
                rowId={(r) => `${r.family}|${r.name}`}
                storageKey="routing-sonic-policy-prefix-lists"
                searchPlaceholder="Search prefix-lists…"
                emptyMessage="No prefix-lists configured."
                onRefresh={() => load("refresh")}
                onRowDoubleClick={(r) => setPrefixModal({ list: r })}
                toolbar={
                  !doc.capability.read_only ? (
                    <Button kind="primary" size="sm" icon={Plus} onClick={() => setPrefixModal({})}>
                      Create prefix-list
                    </Button>
                  ) : undefined
                }
                actions={(row) => (
                  <RowActions
                    label={`prefix-list ${row.name}`}
                    onEdit={() => setPrefixModal({ list: row })}
                    onDelete={() => removePrefix(row)}
                  />
                )}
              />
            )}

            {tab === "route-maps" && (
              <DataTable
                rows={doc.route_maps}
                columns={routeMapColumns}
                rowId={(r) => r.name}
                storageKey="routing-sonic-policy-route-maps"
                searchPlaceholder="Search route-maps…"
                emptyMessage="No route-maps configured."
                onRefresh={() => load("refresh")}
                onRowDoubleClick={(r) => setRouteMapModal({ map: r })}
                toolbar={
                  !doc.capability.read_only ? (
                    <Button kind="primary" size="sm" icon={Plus} onClick={() => setRouteMapModal({})}>
                      Create route-map
                    </Button>
                  ) : undefined
                }
                actions={(row) => (
                  <RowActions
                    label={`route-map ${row.name}`}
                    onEdit={() => setRouteMapModal({ map: row })}
                    onDelete={() => removeRouteMap(row)}
                  />
                )}
              />
            )}
          </div>
        )}
      </div>

      {prefixModal && doc && (
        <SonicPrefixListFormModal
          initial={prefixModal.list}
          existing={doc.prefix_lists}
          onClose={() => setPrefixModal(null)}
          onSaved={saved}
        />
      )}
      {routeMapModal && doc && (
        <SonicRouteMapFormModal
          initial={routeMapModal.map}
          existingNames={doc.route_maps.map((r) => r.name)}
          prefixLists={doc.prefix_lists}
          onClose={() => setRouteMapModal(null)}
          onSaved={saved}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
