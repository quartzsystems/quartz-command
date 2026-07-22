"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureReadOnlyNotice, FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import { useDeviceProduct } from "@/components/device/useDeviceProduct";
import { shortInterfaceName } from "@/lib/device/switching";
import {
  AclRule,
  AclTable,
  AclsDoc,
  deleteAclRule,
  deleteAclTable,
  fetchAcls,
} from "@/lib/device/sonic-acl";
import { AclTableFormModal } from "./AclTableFormModal";
import { AclRuleFormModal } from "./AclRuleFormModal";

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

const TYPE_LABEL: Record<AclTable["type"], string> = {
  L3: "IPv4",
  L3V6: "IPv6",
  MAC: "MAC",
};

const tableColumns: Column<AclTable>[] = [
  { key: "name", header: "Name", value: (r) => r.name, mono: true, sortable: true, width: 170 },
  {
    key: "type",
    header: "Type",
    value: (r) => r.type,
    render: (r) => <span className="badge badge-info">{TYPE_LABEL[r.type]}</span>,
    sortable: true,
    width: 90,
  },
  {
    key: "stage",
    header: "Stage",
    value: (r) => r.stage,
    render: (r) => (r.stage === "ingress" ? "Ingress" : "Egress"),
    sortable: true,
    width: 100,
  },
  { key: "rules", header: "Rules", value: (r) => r.rules.length, mono: true, sortable: true, width: 80 },
  {
    key: "ports",
    header: "Bound To",
    value: (r) => r.ports.join(", "),
    render: (r) =>
      r.ports.length ? (
        <span className="inline-flex flex-wrap gap-x-2">
          {r.ports.map((p) => (
            <span key={p} title={p}>
              {shortInterfaceName(p)}
            </span>
          ))}
        </span>
      ) : (
        dash
      ),
    mono: true,
  },
  {
    key: "description",
    header: "Description",
    value: (r) => r.description ?? "",
    render: (r) => (r.description ? r.description : dash),
  },
];

const ruleColumns: Column<AclRule>[] = [
  { key: "priority", header: "Priority", value: (r) => r.priority, mono: true, sortable: true, width: 90 },
  {
    key: "action",
    header: "Action",
    value: (r) => r.action,
    render: (r) =>
      r.action === "forward" ? (
        <span className="badge badge-ok">Forward</span>
      ) : (
        <span className="badge badge-crit">Drop</span>
      ),
    sortable: true,
    width: 100,
  },
  { key: "src", header: "Source", value: (r) => r.src ?? "", render: (r) => (r.src ? r.src : <span className="text-[var(--qz-fg-4)]">any</span>), mono: true },
  { key: "dst", header: "Destination", value: (r) => r.dst ?? "", render: (r) => (r.dst ? r.dst : <span className="text-[var(--qz-fg-4)]">any</span>), mono: true },
  {
    key: "protocol",
    header: "Protocol",
    value: (r) => r.protocol ?? "",
    render: (r) => (r.protocol ? r.protocol : <span className="text-[var(--qz-fg-4)]">any</span>),
    mono: true,
    width: 90,
  },
  {
    key: "ports",
    header: "L4 Ports",
    value: (r) => `${r.src_port ?? ""}→${r.dst_port ?? ""}`,
    render: (r) =>
      r.src_port || r.dst_port ? `${r.src_port ?? "any"} → ${r.dst_port ?? "any"}` : dash,
    mono: true,
    width: 140,
  },
  {
    key: "description",
    header: "Description",
    value: (r) => r.description ?? "",
    render: (r) => (r.description ? r.description : dash),
  },
];

function SonicAclsPage() {
  const [doc, setDoc] = useState<AclsDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");

  const [selected, setSelected] = useState<string | null>(null);
  const [tableModal, setTableModal] = useState<{ table?: AclTable } | null>(null);
  const [ruleModal, setRuleModal] = useState<{ rule?: AclRule } | null>(null);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      const d = await fetchAcls();
      setDoc(d);
      setSelected((cur) =>
        cur && d.tables.some((t) => t.name === cur) ? cur : d.tables[0]?.name ?? null,
      );
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load ACLs.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedTable = useMemo(
    () => doc?.tables.find((t) => t.name === selected) ?? null,
    [doc, selected],
  );

  const removeTable = async (row: AclTable) => {
    try {
      await deleteAclTable(row.name);
      setToast(`Deleted ACL ${row.name}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete ${row.name}.`);
    }
  };

  const removeRule = async (row: AclRule) => {
    if (!selectedTable) return;
    try {
      await deleteAclRule(selectedTable.name, row.priority);
      setToast(`Deleted rule ${row.priority}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete rule ${row.priority}.`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          ACLs
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Access control lists — packet filters bound to ports, port channels, or VLANs
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading ACLs…</div>
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
          <FeatureUnavailable feature="ACLs" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-6">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <DataTable
              rows={doc.tables}
              columns={tableColumns}
              rowId={(r) => r.name}
              storageKey="security-acl-tables"
              searchPlaceholder="Search ACLs…"
              emptyMessage="No ACLs configured."
              onRefresh={() => load("refresh")}
              onRowDoubleClick={(r) => setTableModal({ table: r })}
              toolbar={
                !doc.capability.read_only ? (
                  <Button kind="primary" size="sm" icon={Plus} onClick={() => setTableModal({})}>
                    Create ACL
                  </Button>
                ) : undefined
              }
              actions={(row) => (
                <RowActions
                  label={`ACL ${row.name}`}
                  onEdit={() => setTableModal({ table: row })}
                  onDelete={() => removeTable(row)}
                />
              )}
            />

            {doc.tables.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-[16px] font-semibold text-[var(--qz-fg-1)] m-0">Rules</h2>
                  <select
                    value={selected ?? ""}
                    onChange={(e) => setSelected(e.target.value)}
                    className="rounded-md px-3 py-[7px] text-[13px] text-[var(--qz-fg-1)] outline-none"
                    style={{
                      background: "var(--qz-input-bg)",
                      border: "1px solid var(--qz-border)",
                      fontFamily: "var(--qz-font-mono)",
                    }}
                  >
                    {doc.tables.map((t) => (
                      <option key={t.name} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>

                {selectedTable && (
                  <DataTable
                    rows={selectedTable.rules}
                    columns={ruleColumns}
                    rowId={(r) => String(r.priority)}
                    storageKey="security-acl-rules"
                    searchPlaceholder="Search rules…"
                    emptyMessage={`${selectedTable.name} has no rules — it permits nothing yet (implicit deny).`}
                    onRefresh={() => load("refresh")}
                    onRowDoubleClick={(r) => setRuleModal({ rule: r })}
                    toolbar={
                      !doc.capability.read_only ? (
                        <Button kind="primary" size="sm" icon={Plus} onClick={() => setRuleModal({})}>
                          Add rule
                        </Button>
                      ) : undefined
                    }
                    actions={(row) => (
                      <RowActions
                        label={`rule ${row.priority}`}
                        onEdit={() => setRuleModal({ rule: row })}
                        onDelete={() => removeRule(row)}
                      />
                    )}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {tableModal && doc && (
        <AclTableFormModal
          initial={tableModal.table}
          existingNames={doc.tables.map((t) => t.name)}
          onClose={() => setTableModal(null)}
          onSaved={(msg) => {
            setTableModal(null);
            setToast(msg);
            load("refresh");
          }}
        />
      )}
      {ruleModal && selectedTable && (
        <AclRuleFormModal
          table={selectedTable}
          initial={ruleModal.rule}
          onClose={() => setRuleModal(null)}
          onSaved={(msg) => {
            setRuleModal(null);
            setToast(msg);
            load("refresh");
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}

/// /security/acls only exists in the QuartzSONiC nav; render nothing for
/// other products (QuartzFire filters under Firewall).
export default function AclsPage() {
  const product = useDeviceProduct();
  if (product === null) return null;
  return product === "quartzsonic" ? <SonicAclsPage /> : null;
}
