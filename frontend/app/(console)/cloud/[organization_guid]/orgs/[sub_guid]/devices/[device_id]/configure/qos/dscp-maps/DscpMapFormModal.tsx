"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { DscpTcMap, updateDscpMap } from "@/lib/device/sonic-qos";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const monoSt = {
  background: "var(--qz-input-bg)",
  border: "1px solid var(--qz-border)",
  fontFamily: "var(--qz-font-mono)",
} as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const TCS = [0, 1, 2, 3, 4, 5, 6, 7];

/** "0-7, 46, 48" → [0,1,...,7,46,48]; throws a readable error on bad input. */
function parseDscpList(raw: string, tc: number): number[] {
  const out: number[] = [];
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (lo > hi || lo < 0 || hi > 63) {
        throw new Error(`TC ${tc}: "${part}" is not a valid DSCP range (0–63).`);
      }
      for (let v = lo; v <= hi; v++) out.push(v);
      continue;
    }
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 63) {
      throw new Error(`TC ${tc}: "${part}" is not a valid DSCP value (0–63).`);
    }
    out.push(n);
  }
  return out;
}

/// Create or edit one DSCP→TC map: for each traffic class, the DSCP values
/// (single values or ranges, e.g. "8-15, 46") it should carry. Unlisted code
/// points keep the image default (TC 0).
export function DscpMapFormModal({
  map,
  existingNames,
  onClose,
  onSaved,
}: {
  /** null = create. */
  map: DscpTcMap | null;
  existingNames: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(map?.name ?? "");
  const [perTc, setPerTc] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    for (const tc of TCS) {
      init[tc] = (map?.entries ?? [])
        .filter((e) => e.tc === tc)
        .map((e) => e.dscp)
        .sort((a, b) => a - b)
        .join(", ");
    }
    return init;
  });

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const mapName = name.trim();
    if (!/^[A-Za-z0-9._-]+$/.test(mapName)) {
      return setError("Map name may only use letters, digits, dots, dashes, and underscores.");
    }
    if (map == null && existingNames.includes(mapName)) {
      return setError(`A map named ${mapName} already exists.`);
    }

    const entries: { dscp: number; tc: number }[] = [];
    const seen = new Map<number, number>();
    try {
      for (const tc of TCS) {
        for (const dscp of parseDscpList(perTc[tc] ?? "", tc)) {
          const prior = seen.get(dscp);
          if (prior != null && prior !== tc) {
            throw new Error(`DSCP ${dscp} is mapped to both TC ${prior} and TC ${tc}.`);
          }
          if (prior == null) {
            seen.set(dscp, tc);
            entries.push({ dscp, tc });
          }
        }
      }
    } catch (err) {
      return setError((err as Error).message);
    }
    if (entries.length === 0) {
      return setError("Map at least one DSCP value to a traffic class.");
    }

    setSaving(true);
    try {
      await updateDscpMap(mapName, entries);
      onSaved(`Saved DSCP map ${mapName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the map.");
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={map ? "Edit DSCP Map" : "Create DSCP Map"}
        subtitle={map ? map.name : "DSCP values per traffic class — values or ranges, e.g. 8-15, 46"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Map Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={map != null}
            placeholder="AZURE"
            className={`${inputCls} disabled:opacity-60`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </div>

        <div className="flex flex-col gap-2">
          {TCS.map((tc) => (
            <div key={tc} className="grid gap-2 items-center" style={{ gridTemplateColumns: "120px 1fr" }}>
              <span className="text-[12.5px] text-[var(--qz-fg-3)]">
                Traffic class {tc}
                {tc === 0 && <span className="text-[var(--qz-fg-4)]"> (default)</span>}
              </span>
              <input
                value={perTc[tc]}
                onChange={(e) => setPerTc((p) => ({ ...p, [tc]: e.target.value }))}
                placeholder={tc === 0 ? "Unlisted DSCPs land here" : `e.g. ${tc * 8}-${tc * 8 + 7}`}
                className={inputCls}
                style={monoSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            </div>
          ))}
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
            {saving ? "Saving…" : map ? "Save changes" : "Create map"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
