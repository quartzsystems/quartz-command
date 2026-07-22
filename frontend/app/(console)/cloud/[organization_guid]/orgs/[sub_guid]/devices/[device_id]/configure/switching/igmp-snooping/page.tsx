"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Pencil, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import {
  IgmpGroup,
  IgmpSnoopingDoc,
  IgmpSnoopingVlan,
  fetchIgmpSnooping,
} from "@/lib/device/igmp-snooping";
import { shortInterfaceName } from "@/lib/device/switching";
import { IgmpVlanFormModal } from "./IgmpVlanFormModal";

type Section = "vlans" | "groups";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

function OnPill({ on, label = "Enabled", offLabel = "Off" }: { on: boolean; label?: string; offLabel?: string }) {
  return on ? (
    <span className="badge badge-ok">{label}</span>
  ) : (
    <span className="badge badge-muted">{offLabel}</span>
  );
}

const vlanColumns: Column<IgmpSnoopingVlan>[] = [
  { key: "vlan_id", header: "VLAN ID", value: (r) => r.vlan_id, mono: true, sortable: true, width: 95 },
  {
    key: "enabled",
    header: "Snooping",
    value: (r) => (r.enabled ? "enabled" : "disabled"),
    render: (r) => <OnPill on={r.enabled} />,
    sortable: true,
    width: 105,
  },
  {
    key: "querier",
    header: "Querier",
    value: (r) => (r.querier ? "on" : "off"),
    render: (r) => <OnPill on={r.querier} />,
    sortable: true,
    width: 100,
  },
  {
    key: "fast_leave",
    header: "Fast Leave",
    value: (r) => (r.fast_leave ? "on" : "off"),
    render: (r) => <OnPill on={r.fast_leave} />,
    width: 105,
  },
  {
    key: "version",
    header: "Version",
    value: (r) => r.version ?? -1,
    render: (r) => (r.version != null ? `v${r.version}` : dash),
    mono: true,
    width: 90,
  },
  {
    key: "query_interval",
    header: "Query Interval",
    value: (r) => r.query_interval ?? -1,
    render: (r) => (r.query_interval != null ? `${r.query_interval}s` : dash),
    mono: true,
    width: 125,
  },
  {
    key: "response",
    header: "Max Response",
    value: (r) => r.query_max_response_time ?? -1,
    render: (r) => (r.query_max_response_time != null ? `${r.query_max_response_time}s` : dash),
    mono: true,
    width: 125,
  },
];

const groupColumns: Column<IgmpGroup>[] = [
  { key: "vlan_id", header: "VLAN", value: (r) => r.vlan_id, mono: true, sortable: true, width: 85 },
  { key: "group", header: "Group", value: (r) => r.group_address, mono: true, sortable: true, width: 150 },
  {
    key: "source",
    header: "Source",
    value: (r) => r.source_address ?? "",
    render: (r) => (r.source_address ? r.source_address : <span title="Any source">*</span>),
    mono: true,
    width: 130,
  },
  {
    key: "ports",
    header: "Member Ports",
    value: (r) => r.ports.join(", "),
    render: (r) =>
      r.ports.length ? (
        <span className="inline-flex flex-wrap gap-x-2">
          {r.ports.map((p) => (
            <span key={p} title={p}>{shortInterfaceName(p)}</span>
          ))}
        </span>
      ) : (
        dash
      ),
    mono: true,
  },
  {
    key: "origin",
    header: "Origin",
    value: (r) => r.origin,
    render: (r) =>
      r.origin === "static" ? (
        <span className="badge badge-info">Static</span>
      ) : (
        <span className="badge badge-muted">Dynamic</span>
      ),
    sortable: true,
    width: 100,
  },
];

export default function IgmpSnoopingPage() {
  const [doc, setDoc] = useState<IgmpSnoopingDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [section, setSection] = useState<Section>("vlans");
  const [editing, setEditing] = useState<IgmpSnoopingVlan | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchIgmpSnooping());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load IGMP snooping state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          IGMP Snooping
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Constrain L2 multicast flooding to interested receivers per VLAN
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading IGMP snooping…</div>
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
          <FeatureUnavailable feature="IGMP snooping" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <Segmented
              items={[
                { value: "vlans", label: "VLANs" },
                { value: "groups", label: "Groups" },
              ]}
              value={section}
              onChange={(v) => setSection(v as Section)}
            />

            {section === "vlans" && (
              <DataTable
                rows={doc.vlans}
                columns={vlanColumns}
                rowId={(r) => String(r.vlan_id)}
                storageKey="switching-igmp-vlans"
                searchPlaceholder="Search VLANs…"
                emptyMessage="No VLANs configured."
                onRefresh={() => load("refresh")}
                onRowDoubleClick={(r) => setEditing(r)}
                actionsWidth={60}
                actions={(r) => (
                  <button
                    type="button"
                    title={`Edit VLAN ${r.vlan_id}`}
                    aria-label="Edit"
                    onClick={() => setEditing(r)}
                    className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                  >
                    <Pencil size={14} />
                  </button>
                )}
              />
            )}

            {section === "groups" && (
              <DataTable
                rows={doc.groups}
                columns={groupColumns}
                rowId={(r) => `${r.vlan_id}:${r.group_address}:${r.source_address ?? "*"}`}
                storageKey="switching-igmp-groups"
                searchPlaceholder="Search groups…"
                emptyMessage="No multicast groups learned."
                onRefresh={() => load("refresh")}
              />
            )}
          </div>
        )}
      </div>

      {editing && (
        <IgmpVlanFormModal
          vlan={editing}
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
