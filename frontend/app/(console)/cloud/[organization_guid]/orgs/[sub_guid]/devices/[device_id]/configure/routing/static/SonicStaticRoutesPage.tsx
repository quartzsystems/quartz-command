"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureReadOnlyNotice, FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import { shortInterfaceName } from "@/lib/device/switching";
import { fetchVrfs } from "@/lib/device/sonic-routing";
import {
  StaticRoute,
  StaticRoutesDoc,
  deleteStaticRoute,
  fetchStaticRoutes,
  staticRouteKey,
} from "@/lib/device/sonic-static-routes";
import { SonicStaticRouteFormModal } from "./SonicStaticRouteFormModal";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

function nextHopSummary(r: StaticRoute): string {
  return r.next_hops
    .map((h) => {
      if (h.blackhole) return "blackhole";
      const via = [h.gateway, h.interface ? shortInterfaceName(h.interface) : null]
        .filter(Boolean)
        .join(" @ ");
      return h.nexthop_vrf ? `${via} (vrf ${h.nexthop_vrf})` : via;
    })
    .join(", ");
}

const columns: Column<StaticRoute>[] = [
  { key: "prefix", header: "Destination", value: (r) => r.prefix, mono: true, sortable: true, width: 180 },
  {
    key: "vrf",
    header: "VRF",
    value: (r) => r.vrf ?? "",
    render: (r) => (r.vrf ? r.vrf : <span className="badge badge-muted">default</span>),
    mono: true,
    sortable: true,
    width: 120,
  },
  {
    key: "next_hops",
    header: "Next Hops",
    value: (r) => nextHopSummary(r),
    render: (r) =>
      r.next_hops.length ? (
        <span className="inline-flex flex-wrap gap-x-2">
          {r.next_hops.map((h, i) => (
            <span key={i}>
              {h.blackhole ? (
                <span className="badge badge-muted">blackhole</span>
              ) : (
                [h.gateway, h.interface ? shortInterfaceName(h.interface) : null]
                  .filter(Boolean)
                  .join(" @ ") + (h.nexthop_vrf ? ` (vrf ${h.nexthop_vrf})` : "")
              )}
            </span>
          ))}
        </span>
      ) : (
        dash
      ),
    mono: true,
  },
  {
    key: "distance",
    header: "Distance",
    value: (r) => r.next_hops[0]?.distance ?? 1,
    render: (r) => {
      const ds = [...new Set(r.next_hops.map((h) => h.distance ?? 1))];
      return ds.join(", ");
    },
    mono: true,
    sortable: true,
    width: 100,
  },
  {
    key: "ecmp",
    header: "Paths",
    value: (r) => r.next_hops.length,
    mono: true,
    sortable: true,
    width: 80,
  },
];

export function SonicStaticRoutesPage() {
  const [doc, setDoc] = useState<StaticRoutesDoc | null>(null);
  const [vrfNames, setVrfNames] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [modal, setModal] = useState<{ route?: StaticRoute } | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      // VRF names populate the form's picker; tolerate their failure so a
      // routes read still renders.
      const [routes, vrfs] = await Promise.all([
        fetchStaticRoutes(),
        fetchVrfs().catch(() => null),
      ]);
      setDoc(routes);
      setVrfNames(vrfs?.vrfs.map((v) => v.name) ?? []);
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load static routes.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (row: StaticRoute) => {
    try {
      await deleteStaticRoute(row.vrf, row.prefix);
      setToast(`Deleted route ${row.prefix}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete route ${row.prefix}.`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Static Routes
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Manually configured routes via a gateway, an interface, or a blackhole — per VRF, with ECMP
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading static routes…</div>
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
          <FeatureUnavailable feature="Static routes" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />
            <DataTable
              rows={doc.routes}
              columns={columns}
              rowId={staticRouteKey}
              storageKey="routing-sonic-static"
              searchPlaceholder="Search routes…"
              emptyMessage="No static routes configured."
              onRefresh={() => load("refresh")}
              onRowDoubleClick={(r) => setModal({ route: r })}
              toolbar={
                !doc.capability.read_only ? (
                  <Button kind="primary" size="sm" icon={Plus} onClick={() => setModal({})}>
                    Create route
                  </Button>
                ) : undefined
              }
              actions={(row) => (
                <RowActions
                  label={`route ${row.prefix}`}
                  onEdit={() => setModal({ route: row })}
                  onDelete={() => remove(row)}
                />
              )}
            />
          </div>
        )}
      </div>

      {modal && doc && (
        <SonicStaticRouteFormModal
          initial={modal.route}
          existing={doc.routes}
          vrfs={vrfNames}
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
