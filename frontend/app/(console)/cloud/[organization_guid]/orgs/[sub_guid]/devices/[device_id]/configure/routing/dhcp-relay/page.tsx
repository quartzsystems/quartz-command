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
  DhcpRelayDoc,
  DhcpRelayVlan,
  fetchDhcpRelay,
} from "@/lib/device/sonic-dhcp-relay";
import { DhcpRelayFormModal } from "./DhcpRelayFormModal";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

const columns: Column<DhcpRelayVlan>[] = [
  { key: "vlan", header: "VLAN", value: (r) => r.vlan_id, mono: true, sortable: true, width: 90 },
  {
    key: "description",
    header: "Description",
    value: (r) => r.description ?? "",
    render: (r) => (r.description ? r.description : dash),
    sortable: true,
    width: 180,
  },
  {
    key: "svi",
    header: "SVI Address",
    value: (r) => r.ip_addresses.join(", "),
    render: (r) => (r.ip_addresses.length ? r.ip_addresses.join(", ") : dash),
    mono: true,
    width: 190,
  },
  {
    key: "servers",
    header: "DHCP Servers",
    value: (r) => r.servers.join(", "),
    render: (r) => (r.servers.length ? r.servers.join(", ") : dash),
    mono: true,
  },
  {
    key: "state",
    header: "Relay",
    value: (r) =>
      r.servers.length === 0 ? "off" : r.ip_addresses.length === 0 ? "no-svi" : "on",
    render: (r) =>
      r.servers.length === 0 ? (
        <span className="badge badge-muted">Off</span>
      ) : r.ip_addresses.length === 0 ? (
        <span className="badge badge-warn" title="Relay is configured but the VLAN has no SVI address">
          No SVI
        </span>
      ) : (
        <span className="badge badge-ok">Relaying</span>
      ),
    sortable: true,
    width: 100,
  },
];

export default function DhcpRelayPage() {
  const [doc, setDoc] = useState<DhcpRelayDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [editing, setEditing] = useState<DhcpRelayVlan | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchDhcpRelay());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load DHCP relay state.");
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
          DHCP Relay
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Forward DHCP requests from each VLAN's SVI to central DHCP servers
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading DHCP relay…</div>
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
          <FeatureUnavailable feature="DHCP relay" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <DataTable
              rows={doc.vlans}
              columns={columns}
              rowId={(r) => String(r.vlan_id)}
              storageKey="routing-dhcp-relay"
              searchPlaceholder="Search VLANs…"
              emptyMessage="No VLANs configured — create them under Switching → VLANs."
              onRefresh={() => load("refresh")}
              onRowDoubleClick={editable ? (r) => setEditing(r) : undefined}
              actionsWidth={60}
              actions={
                editable
                  ? (r) => (
                      <button
                        type="button"
                        title={`Edit relay on VLAN ${r.vlan_id}`}
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
        <DhcpRelayFormModal
          vlan={editing}
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
