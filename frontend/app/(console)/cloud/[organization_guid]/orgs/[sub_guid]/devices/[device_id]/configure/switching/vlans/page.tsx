"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { SwitchVlan, fetchVlans } from "@/lib/device/switching";

/// Untagged members first, then tagged (marked "(t)") — compact but complete.
function MembersCell({ vlan }: { vlan: SwitchVlan }) {
  if (vlan.members.length === 0) return <span className="text-[var(--qz-fg-4)]">—</span>;
  const sorted = [...vlan.members].sort((a, b) =>
    a.tagging === b.tagging ? a.name.localeCompare(b.name) : a.tagging === "untagged" ? -1 : 1,
  );
  return (
    <span className="inline-flex flex-wrap gap-x-2">
      {sorted.map((m) => (
        <span key={m.name} title={m.tagging}>
          {m.name}
          {m.tagging === "tagged" && <span style={{ color: "var(--qz-fg-4)" }}> (t)</span>}
        </span>
      ))}
    </span>
  );
}

const columns: Column<SwitchVlan>[] = [
  { key: "vlan_id", header: "VLAN ID", value: (r) => r.vlan_id, mono: true, sortable: true, width: 95 },
  { key: "name", header: "Name", value: (r) => r.name, mono: true, sortable: true, width: 120 },
  { key: "description", header: "Description", value: (r) => r.description ?? "", sortable: true },
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
    key: "members",
    header: "Members",
    value: (r) => r.members.map((m) => m.name).join(", "),
    render: (r) => <MembersCell vlan={r} />,
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
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setRows(await fetchVlans());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load VLANs.");
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
          />
        )}
      </div>
    </div>
  );
}
