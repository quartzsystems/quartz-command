"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Toast } from "@/components/dashboard/Toast";
import {
  SwitchVlan,
  deleteSwitchVlan,
  fetchPortChannels,
  fetchSwitchPorts,
  fetchVlans,
} from "@/lib/device/switching";
import { VlanFormModal } from "./VlanFormModal";

/// One tagging class of a VLAN's members, as its own column cell.
function MembersCell({ vlan, tagging }: { vlan: SwitchVlan; tagging: "tagged" | "untagged" }) {
  const names = vlan.members
    .filter((m) => m.tagging === tagging)
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (names.length === 0) return <span className="text-[var(--qz-fg-4)]">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-2">
      {names.map((n) => (
        <span key={n}>{n}</span>
      ))}
    </span>
  );
}

const columns: Column<SwitchVlan>[] = [
  { key: "vlan_id", header: "VLAN ID", value: (r) => r.vlan_id, mono: true, sortable: true, width: 95 },
  { key: "description", header: "Description", value: (r) => r.description ?? "", sortable: true, width: 170 },
  {
    key: "ip_addresses",
    header: "IP Address",
    value: (r) => r.ip_addresses.join(", "),
    render: (r) =>
      r.ip_addresses.length ? r.ip_addresses.join(", ") : <span className="text-[var(--qz-fg-4)]">—</span>,
    mono: true,
    width: 170,
  },
  {
    key: "dhcp_helpers",
    header: "DHCP Helpers",
    value: (r) => r.dhcp_helpers.join(", "),
    render: (r) =>
      r.dhcp_helpers.length ? r.dhcp_helpers.join(", ") : <span className="text-[var(--qz-fg-4)]">—</span>,
    mono: true,
    width: 150,
  },
  {
    key: "untagged",
    header: "Untagged",
    value: (r) =>
      r.members.filter((m) => m.tagging === "untagged").map((m) => m.name).join(", "),
    render: (r) => <MembersCell vlan={r} tagging="untagged" />,
    mono: true,
  },
  {
    key: "tagged",
    header: "Tagged",
    value: (r) =>
      r.members.filter((m) => m.tagging === "tagged").map((m) => m.name).join(", "),
    render: (r) => <MembersCell vlan={r} tagging="tagged" />,
    mono: true,
  },
  {
    key: "member_count",
    header: "Ports",
    value: (r) => r.members.length,
    mono: true,
    sortable: true,
    width: 75,
  },
];

export default function VlansPage() {
  const [rows, setRows] = useState<SwitchVlan[]>([]);
  const [memberCandidates, setMemberCandidates] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; vlan: SwitchVlan } | null>(
    null,
  );
  const [toast, setToast] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      const [vlans, ports, pcs] = await Promise.all([
        fetchVlans(),
        fetchSwitchPorts(),
        fetchPortChannels(),
      ]);
      setRows(vlans);
      setMemberCandidates([...ports.map((p) => p.name), ...pcs.map((pc) => pc.name)]);
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load VLANs.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (vlan: SwitchVlan) => {
    try {
      await deleteSwitchVlan(vlan.vlan_id);
      setToast(`Deleted VLAN ${vlan.vlan_id}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to delete VLAN.");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          VLANs
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">Layer 2 VLANs and member ports</p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading VLANs…</div>
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
        {status === "ready" && (
          <DataTable
            rows={rows}
            columns={columns}
            rowId={(r) => r.name}
            storageKey="switching-vlans"
            searchPlaceholder="Search VLANs…"
            emptyMessage="No VLANs configured."
            onRefresh={() => load("refresh")}
            toolbar={
              <Button size="sm" icon={Plus} onClick={() => setModal({ mode: "create" })}>
                Add VLAN
              </Button>
            }
            actions={(r) => (
              <RowActions
                label={`VLAN ${r.vlan_id}`}
                onEdit={() => setModal({ mode: "edit", vlan: r })}
                onDelete={() => remove(r)}
              />
            )}
          />
        )}
      </div>

      {modal && (
        <VlanFormModal
          initial={modal.mode === "edit" ? modal.vlan : undefined}
          existing={rows}
          memberCandidates={memberCandidates}
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
