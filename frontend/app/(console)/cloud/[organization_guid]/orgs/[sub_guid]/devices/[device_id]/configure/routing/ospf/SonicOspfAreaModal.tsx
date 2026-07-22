"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { OspfArea, upsertOspfArea } from "@/lib/device/sonic-ospf";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

interface ListRow {
  key: string;
  value: string;
}

let keyCounter = 0;
const nextKey = () => `ospf-area-row-${keyCounter++}`;

/// Create or edit an OSPF area: id, stub flag, and its network statements
/// (the full desired set — the agent diffs).
export function SonicOspfAreaModal({
  initial,
  existing,
  vrfs,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  initial?: OspfArea & { vrf: string };
  existing: (OspfArea & { vrf: string })[];
  vrfs: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;

  const [vrf, setVrf] = useState(initial?.vrf ?? vrfs[0]);
  const [areaId, setAreaId] = useState(initial?.area_id ?? "");
  const [stub, setStub] = useState(initial?.stub ?? false);
  const [networks, setNetworks] = useState<ListRow[]>(
    (initial?.networks ?? []).map((value) => ({ key: nextKey(), value })),
  );

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const trimmed = areaId.trim();
    if (!trimmed) return setError("Area ID is required, e.g. 0.0.0.0.");
    if (!isEdit && existing.some((a) => a.vrf === vrf && a.area_id === trimmed)) {
      return setError(`Area ${trimmed} already exists in VRF ${vrf}.`);
    }

    setSaving(true);
    try {
      await upsertOspfArea(vrf, trimmed, {
        stub,
        networks: networks.map((n) => n.value.trim()).filter(Boolean),
      });
      onSaved(isEdit ? `Saved area ${trimmed}.` : `Created area ${trimmed}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save area.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={isEdit ? "Edit OSPF Area" : "Add OSPF Area"}
        subtitle={isEdit ? `Area ${initial!.area_id} · VRF ${initial!.vrf}` : "New area"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">VRF</label>
            <select
              value={vrf}
              onChange={(e) => setVrf(e.target.value)}
              disabled={isEdit}
              className={`${inputCls} cursor-pointer disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              {(isEdit && !vrfs.includes(vrf) ? [vrf, ...vrfs] : vrfs).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Area ID <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <input
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
              placeholder="0.0.0.0"
              disabled={isEdit}
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">Stub area</p>
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
              Block external LSAs; reach externals via a default route
            </p>
          </div>
          <Switch on={stub} onChange={setStub} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-[6px]">
            <label className="block text-[12px] text-[var(--qz-fg-3)]">Networks</label>
            <button
              type="button"
              onClick={() => setNetworks((p) => [...p, { key: nextKey(), value: "" }])}
              className="flex items-center gap-[5px] text-[12px] text-[var(--qz-fg-3)] hover:text-[var(--qz-accent)] transition-colors cursor-pointer bg-transparent border-0 p-0"
            >
              <Plus size={13} /> Add
            </button>
          </div>
          {networks.length === 0 ? (
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0">
              No network statements — place interfaces from the Interfaces section instead.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {networks.map((r) => (
                <div key={r.key} className="flex items-center gap-2">
                  <input
                    value={r.value}
                    onChange={(e) =>
                      setNetworks((p) => p.map((n) => (n.key === r.key ? { ...n, value: e.target.value } : n)))
                    }
                    placeholder="10.0.0.0/24"
                    className={inputCls}
                    style={monoSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  />
                  <button
                    type="button"
                    onClick={() => setNetworks((p) => p.filter((n) => n.key !== r.key))}
                    title="Remove"
                    className="grid place-items-center w-9 h-9 flex-shrink-0 rounded-md text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)] transition-colors cursor-pointer bg-transparent"
                    style={{ border: "1px solid var(--qz-border)" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p className="text-[12px] m-0" style={{ color: "var(--qz-danger)" }}>
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end mt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-[9px] rounded-md text-[13px] font-medium cursor-pointer"
            style={{ background: "transparent", border: "1px solid var(--qz-border)", color: "var(--qz-fg-2)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-[9px] rounded-md text-[13px] font-semibold cursor-pointer border-0"
            style={{ background: "var(--qz-accent)", color: "var(--qz-fg-on-accent)", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add area"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
