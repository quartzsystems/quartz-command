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
  FdbConfigDoc,
  StaticFdbEntry,
  deleteStaticFdbEntry,
  fetchFdbConfig,
  updateFdbSettings,
} from "@/lib/device/sonic-fdb";
import {
  SwitchVlan,
  fetchPortChannels,
  fetchSwitchPorts,
  fetchVlans,
} from "@/lib/device/switching";
import { StaticMacFormModal } from "./StaticMacFormModal";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const columns: Column<StaticFdbEntry>[] = [
  { key: "vlan", header: "VLAN", value: (r) => r.vlan_id, mono: true, sortable: true, width: 90 },
  { key: "mac", header: "MAC Address", value: (r) => r.mac, mono: true, sortable: true, width: 190 },
  { key: "port", header: "Port", value: (r) => r.port, mono: true, sortable: true },
];

/// Config side of the switch's forwarding database: aging time and static
/// entries. The learned table lives under Monitor → Switching → MAC Table.
export default function MacTablePage() {
  const [doc, setDoc] = useState<FdbConfigDoc | null>(null);
  const [vlans, setVlans] = useState<SwitchVlan[]>([]);
  const [memberCandidates, setMemberCandidates] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");

  // Aging form state, seeded from the loaded doc.
  const [aging, setAging] = useState("");
  const [agingError, setAgingError] = useState("");
  const [savingAging, setSavingAging] = useState(false);

  // null = closed; { entry: undefined } = create; { entry } = edit.
  const [modal, setModal] = useState<{ entry?: StaticFdbEntry } | null>(null);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      // VLAN and interface names populate the static-entry form's pickers;
      // tolerate their failure so the FDB read still renders.
      const [d, vs, ps, pcs] = await Promise.all([
        fetchFdbConfig(),
        fetchVlans().catch(() => []),
        fetchSwitchPorts().catch(() => []),
        fetchPortChannels().catch(() => []),
      ]);
      setDoc(d);
      setAging(d.aging_time_seconds != null ? String(d.aging_time_seconds) : "");
      setVlans(vs);
      setMemberCandidates([...ps.map((p) => p.name), ...pcs.map((p) => p.name)]);
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load the MAC table config.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveAging = async () => {
    setAgingError("");
    let value: number | null = null;
    if (aging.trim() !== "") {
      value = Number(aging);
      if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
        return setAgingError("Aging time must be a whole number of seconds (0 disables aging).");
      }
    }
    setSavingAging(true);
    try {
      await updateFdbSettings(value);
      setToast("Saved MAC aging time.");
      await load("refresh");
    } catch (e) {
      setAgingError(e instanceof Error ? e.message : "Failed to save aging time.");
    } finally {
      setSavingAging(false);
    }
  };

  const remove = async (row: StaticFdbEntry) => {
    try {
      await deleteStaticFdbEntry(row.vlan_id, row.mac);
      setToast(`Deleted static MAC ${row.mac}.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : `Failed to delete ${row.mac}.`);
    }
  };

  const editable = doc?.capability.supported && !doc.capability.read_only;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          MAC Table
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          FDB aging time and static MAC entries — the learned table is under Monitor
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading MAC table config…</div>
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
          <FeatureUnavailable feature="MAC table configuration" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <div
              className="max-w-[640px] rounded-xl p-6"
              style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
            >
              <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">Aging time</p>
              <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
                Seconds a learned MAC stays in the table without traffic; 0 disables aging
              </p>
              <div className="flex items-end gap-3 mt-4">
                <div className="flex-1">
                  <input
                    type="number"
                    min={0}
                    value={aging}
                    onChange={(e) => setAging(e.target.value)}
                    disabled={!editable}
                    placeholder={
                      doc.aging_time_default != null
                        ? `${doc.aging_time_default} (default)`
                        : "Image default"
                    }
                    className={`${inputCls} disabled:opacity-60`}
                    style={monoSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  />
                </div>
                {editable && (
                  <button
                    type="button"
                    onClick={saveAging}
                    disabled={savingAging}
                    className="px-4 py-[9px] rounded-md text-[13px] font-semibold cursor-pointer border-0 flex-shrink-0"
                    style={{ background: "var(--qz-accent)", color: "var(--qz-fg-on-accent)", opacity: savingAging ? 0.7 : 1 }}
                  >
                    {savingAging ? "Saving…" : "Save"}
                  </button>
                )}
              </div>
              {agingError && (
                <p className="text-[12px] m-0 mt-3" style={{ color: "var(--qz-danger)" }}>
                  {agingError}
                </p>
              )}
            </div>

            <div>
              <h2 className="text-[16px] font-semibold text-[var(--qz-fg-1)] m-0 mb-3">
                Static Entries
              </h2>
              <DataTable
                rows={doc.static_entries}
                columns={columns}
                rowId={(r) => `${r.vlan_id}:${r.mac}`}
                storageKey="switching-fdb-static"
                searchPlaceholder="Search entries…"
                emptyMessage="No static MAC entries configured."
                onRefresh={() => load("refresh")}
                onRowDoubleClick={editable ? (r) => setModal({ entry: r }) : undefined}
                toolbar={
                  editable ? (
                    <Button kind="primary" size="sm" icon={Plus} onClick={() => setModal({})}>
                      Add entry
                    </Button>
                  ) : undefined
                }
                actions={
                  editable
                    ? (row) => (
                        <RowActions
                          label={`static MAC ${row.mac}`}
                          onEdit={() => setModal({ entry: row })}
                          onDelete={() => remove(row)}
                        />
                      )
                    : undefined
                }
              />
            </div>
          </div>
        )}
      </div>

      {modal && (
        <StaticMacFormModal
          initial={modal.entry}
          existing={doc?.static_entries ?? []}
          vlans={vlans}
          memberCandidates={memberCandidates}
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
