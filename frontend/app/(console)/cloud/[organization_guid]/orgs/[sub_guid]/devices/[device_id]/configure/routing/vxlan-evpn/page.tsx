"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Pencil, Plus, RotateCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { Toast } from "@/components/dashboard/Toast";
import {
  FeatureReadOnlyNotice,
  FeatureUnavailable,
} from "@/components/device/FeatureUnavailable";
import {
  VlanVniMap,
  VxlanDoc,
  deleteVtep,
  fetchVxlan,
  updateVlanVniMaps,
  updateVtep,
} from "@/lib/device/sonic-vxlan";
import { VniMapFormModal } from "./VniMapFormModal";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const mapColumns: Column<VlanVniMap>[] = [
  { key: "vlan", header: "VLAN", value: (r) => r.vlan_id, mono: true, sortable: true, width: 110 },
  { key: "vni", header: "VNI", value: (r) => r.vni, mono: true, sortable: true, width: 130 },
];

/// The switch's VTEP, its EVPN NVO binding, and the VLAN↔VNI map. Pairs with
/// the BGP page (l2vpn evpn address family) for EVPN fabrics; learned remote
/// VTEPs are under Monitor → Routing → VXLAN / EVPN.
export default function VxlanEvpnPage() {
  const [doc, setDoc] = useState<VxlanDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");

  // VTEP panel form state, seeded from the loaded doc.
  const [vtepName, setVtepName] = useState("");
  const [sourceIp, setSourceIp] = useState("");
  const [evpnNvo, setEvpnNvo] = useState(false);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmVtepDelete, setConfirmVtepDelete] = useState(false);

  const [editingMap, setEditingMap] = useState<VlanVniMap | null>(null);
  const [creatingMap, setCreatingMap] = useState(false);
  const [confirmMapDelete, setConfirmMapDelete] = useState<number | null>(null);
  const [mapBusy, setMapBusy] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      const d = await fetchVxlan();
      setDoc(d);
      setVtepName(d.vtep?.name ?? "vtep1");
      setSourceIp(d.vtep?.source_ip ?? "");
      setEvpnNvo(d.evpn_nvo);
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load VXLAN state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveVtep = async () => {
    setFormError("");
    const name = vtepName.trim();
    const src = sourceIp.trim();
    if (!name) return setFormError("The VTEP needs a name (e.g. vtep1).");
    if (!src) return setFormError("The VTEP needs a source IP — normally a loopback address.");

    setSaving(true);
    try {
      await updateVtep({ name, source_ip: src, evpn_nvo: evpnNvo });
      setToast("Saved VTEP settings.");
      await load("refresh");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save the VTEP.");
    } finally {
      setSaving(false);
    }
  };

  const removeVtep = async () => {
    setSaving(true);
    try {
      await deleteVtep();
      setToast("Removed the VTEP.");
      setConfirmVtepDelete(false);
      await load("refresh");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to remove the VTEP.");
    } finally {
      setSaving(false);
    }
  };

  /// Map writes send the full desired set (the agent diffs VXLAN_TUNNEL_MAP).
  const writeMaps = async (maps: VlanVniMap[], message: string) => {
    setMapBusy(true);
    try {
      await updateVlanVniMaps(maps);
      setToast(message);
      setConfirmMapDelete(null);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to update VLAN↔VNI maps.");
    } finally {
      setMapBusy(false);
    }
  };

  const editable = doc?.capability.supported && !doc.capability.read_only;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          VXLAN / EVPN
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          VTEP, EVPN NVO binding, and VLAN↔VNI mappings for the overlay fabric
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading VXLAN state…</div>
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
          <FeatureUnavailable feature="VXLAN" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <div
              className="max-w-[640px] rounded-xl p-6"
              style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
            >
              <h2 className="text-[15px] font-semibold text-[var(--qz-fg-1)] m-0 mb-4">
                VTEP
              </h2>

              <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Name</label>
                  <input
                    value={vtepName}
                    onChange={(e) => setVtepName(e.target.value)}
                    disabled={!editable || doc.vtep != null}
                    placeholder="vtep1"
                    className={`${inputCls} disabled:opacity-60`}
                    style={monoSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
                    Source IP
                  </label>
                  <input
                    value={sourceIp}
                    onChange={(e) => setSourceIp(e.target.value)}
                    disabled={!editable}
                    placeholder="Loopback address, e.g. 10.0.0.11"
                    className={`${inputCls} disabled:opacity-60`}
                    style={monoSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between mt-4">
                <div>
                  <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">EVPN NVO</p>
                  <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
                    Bind the VTEP to BGP EVPN so remote VTEPs and MACs are learned
                    dynamically (configure the l2vpn evpn address family on the BGP page)
                  </p>
                </div>
                <Switch on={evpnNvo} onChange={editable ? setEvpnNvo : () => {}} />
              </div>

              {formError && (
                <p className="text-[12px] m-0 mt-4" style={{ color: "var(--qz-danger)" }}>
                  {formError}
                </p>
              )}

              {editable && (
                <div className="flex justify-between items-center mt-5">
                  <div>
                    {doc.vtep &&
                      (confirmVtepDelete ? (
                        <span className="flex items-center gap-2 text-[12.5px] text-[var(--qz-fg-3)]">
                          Remove the VTEP?
                          <Button kind="danger" size="sm" icon={Check} onClick={removeVtep} disabled={saving}>
                            Remove
                          </Button>
                          <Button kind="secondary" size="sm" icon={X} onClick={() => setConfirmVtepDelete(false)}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button
                          kind="secondary"
                          size="sm"
                          icon={Trash2}
                          onClick={() => setConfirmVtepDelete(true)}
                        >
                          Remove VTEP
                        </Button>
                      ))}
                  </div>
                  <button
                    type="button"
                    onClick={saveVtep}
                    disabled={saving}
                    className="px-4 py-[9px] rounded-md text-[13px] font-semibold cursor-pointer border-0"
                    style={{ background: "var(--qz-accent)", color: "var(--qz-fg-on-accent)", opacity: saving ? 0.7 : 1 }}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              )}
            </div>

            <div>
              <h2 className="text-[16px] font-semibold text-[var(--qz-fg-1)] m-0 mb-3">
                VLAN ↔ VNI Mappings
              </h2>
              <DataTable
                rows={doc.vlan_vni_maps}
                columns={mapColumns}
                rowId={(r) => String(r.vlan_id)}
                storageKey="routing-vxlan-maps"
                searchPlaceholder="Search mappings…"
                emptyMessage={
                  doc.vtep
                    ? "No VLANs are mapped into the overlay yet."
                    : "Configure the VTEP above before mapping VLANs to VNIs."
                }
                onRefresh={() => load("refresh")}
                onRowDoubleClick={editable && doc.vtep ? (r) => setEditingMap(r) : undefined}
                toolbar={
                  editable && doc.vtep ? (
                    <Button icon={Plus} onClick={() => setCreatingMap(true)}>
                      Add mapping
                    </Button>
                  ) : undefined
                }
                actionsWidth={confirmMapDelete != null ? 90 : 60}
                actions={
                  editable && doc.vtep
                    ? (r) =>
                        confirmMapDelete === r.vlan_id ? (
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              title="Confirm delete"
                              aria-label="Confirm delete"
                              disabled={mapBusy}
                              onClick={() =>
                                writeMaps(
                                  doc.vlan_vni_maps.filter((m) => m.vlan_id !== r.vlan_id),
                                  `Unmapped VLAN ${r.vlan_id}.`,
                                )
                              }
                              className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-danger)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              type="button"
                              title="Cancel"
                              aria-label="Cancel delete"
                              onClick={() => setConfirmMapDelete(null)}
                              className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-fg-1)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                            >
                              <X size={14} />
                            </button>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              title={`Edit VLAN ${r.vlan_id}`}
                              aria-label="Edit"
                              onClick={() => setEditingMap(r)}
                              className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-accent)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              title={`Delete VLAN ${r.vlan_id} mapping`}
                              aria-label="Delete"
                              onClick={() => setConfirmMapDelete(r.vlan_id)}
                              className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                            >
                              <Trash2 size={14} />
                            </button>
                          </span>
                        )
                    : undefined
                }
              />
            </div>
          </div>
        )}
      </div>

      {(creatingMap || editingMap) && doc && (
        <VniMapFormModal
          map={editingMap}
          existing={doc.vlan_vni_maps}
          onClose={() => {
            setCreatingMap(false);
            setEditingMap(null);
          }}
          onSave={async (next, message) => {
            await writeMaps(next, message);
            setCreatingMap(false);
            setEditingMap(null);
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
