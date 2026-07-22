"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import {
  SonicPrefixList,
  SonicRouteMap,
  SonicRouteMapEntry,
  emptySonicRouteMapEntry,
  putRouteMap,
} from "@/lib/device/sonic-routing-policy";

const inputCls = "w-full rounded-md px-3 py-[8px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/** String-draft mirror of SonicRouteMapEntry for form editing. */
interface EntryDraft {
  seq: string;
  action: "permit" | "deny";
  description: string;
  matchIpPrefixList: string;
  matchIpv6PrefixList: string;
  matchCommunity: string;
  matchMetric: string;
  matchTag: string;
  setLocalPref: string;
  setMetric: string;
  setCommunity: string;
  setAsPathPrepend: string;
  setIpNextHop: string;
  setOrigin: "" | "igp" | "egp" | "incomplete";
  setTag: string;
}

function toDraft(e: SonicRouteMapEntry): EntryDraft {
  return {
    seq: String(e.seq),
    action: e.action,
    description: e.description ?? "",
    matchIpPrefixList: e.match.ip_prefix_list ?? "",
    matchIpv6PrefixList: e.match.ipv6_prefix_list ?? "",
    matchCommunity: e.match.community ?? "",
    matchMetric: e.match.metric != null ? String(e.match.metric) : "",
    matchTag: e.match.tag != null ? String(e.match.tag) : "",
    setLocalPref: e.set.local_preference != null ? String(e.set.local_preference) : "",
    setMetric: e.set.metric != null ? String(e.set.metric) : "",
    setCommunity: e.set.community ?? "",
    setAsPathPrepend: e.set.as_path_prepend ?? "",
    setIpNextHop: e.set.ip_next_hop ?? "",
    setOrigin: e.set.origin ?? "",
    setTag: e.set.tag != null ? String(e.set.tag) : "",
  };
}

/** Parse one optional integer field; returns [value, errorMessage]. */
function optInt(v: string, label: string, min: number, max: number): [number | null, string | null] {
  if (!v.trim()) return [null, null];
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    return [null, `${label} must be a whole number between ${min} and ${max}.`];
  }
  return [n, null];
}

/// Create or edit a route map: an ordered list of permit/deny entries, each
/// with match conditions and set actions. Saving replaces the whole map.
export function SonicRouteMapFormModal({
  initial,
  existingNames,
  prefixLists,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  initial?: SonicRouteMap;
  existingNames: string[];
  /** For the match prefix-list pickers. */
  prefixLists: SonicPrefixList[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [entries, setEntries] = useState<EntryDraft[]>(
    initial ? initial.entries.map(toDraft) : [toDraft(emptySonicRouteMapEntry(10))],
  );
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true });

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const setEntry = (i: number, patch: Partial<EntryDraft>) =>
    setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  const v4Lists = prefixLists.filter((l) => l.family === "ipv4").map((l) => l.name);
  const v6Lists = prefixLists.filter((l) => l.family === "ipv6").map((l) => l.name);

  const addEntry = () => {
    const maxSeq = entries.reduce((m, e) => Math.max(m, Number(e.seq) || 0), 0);
    setEntries((p) => [...p, toDraft(emptySonicRouteMapEntry(maxSeq + 10))]);
    setOpen((p) => ({ ...p, [entries.length]: true }));
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const trimmed = name.trim();
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
      return setError("Name may only contain letters, digits, dot, dash, and underscore.");
    }
    if (!isEdit && existingNames.includes(trimmed)) {
      return setError(`${trimmed} already exists.`);
    }
    if (entries.length === 0) return setError("Add at least one entry.");

    const parsed: SonicRouteMapEntry[] = [];
    const seqs = new Set<number>();
    for (const [i, d] of entries.entries()) {
      const label = `Entry ${i + 1}`;
      const seq = Number(d.seq);
      if (!Number.isInteger(seq) || seq < 1 || seq > 65535) {
        return setError(`${label}: sequence must be a whole number between 1 and 65535.`);
      }
      if (seqs.has(seq)) return setError(`${label}: sequence ${seq} is used twice.`);
      seqs.add(seq);

      const [matchMetric, e1] = optInt(d.matchMetric, `${label}: match metric`, 0, 4294967295);
      if (e1) return setError(e1);
      const [matchTag, e2] = optInt(d.matchTag, `${label}: match tag`, 0, 4294967295);
      if (e2) return setError(e2);
      const [localPref, e3] = optInt(d.setLocalPref, `${label}: local preference`, 0, 4294967295);
      if (e3) return setError(e3);
      const [setMetric, e4] = optInt(d.setMetric, `${label}: set metric`, 0, 4294967295);
      if (e4) return setError(e4);
      const [setTag, e5] = optInt(d.setTag, `${label}: set tag`, 0, 4294967295);
      if (e5) return setError(e5);

      parsed.push({
        seq,
        action: d.action,
        description: d.description.trim() || null,
        match: {
          ip_prefix_list: d.matchIpPrefixList || null,
          ipv6_prefix_list: d.matchIpv6PrefixList || null,
          community: d.matchCommunity.trim() || null,
          metric: matchMetric,
          tag: matchTag,
        },
        set: {
          local_preference: localPref,
          metric: setMetric,
          community: d.setCommunity.trim() || null,
          as_path_prepend: d.setAsPathPrepend.trim() || null,
          ip_next_hop: d.setIpNextHop.trim() || null,
          origin: d.setOrigin || null,
          tag: setTag,
        },
      });
    }
    parsed.sort((a, b) => a.seq - b.seq);

    setSaving(true);
    try {
      await putRouteMap({ name: trimmed, entries: parsed });
      onSaved(isEdit ? `Saved route-map ${trimmed}.` : `Created route-map ${trimmed}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save route-map.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={760}>
      <ModalHeader
        title={isEdit ? "Edit route-map" : "Create route-map"}
        subtitle={isEdit ? initial!.name : "Ordered entries that match and shape routes"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
            Name <span style={{ color: "var(--qz-danger)" }}>*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="RM-UPSTREAM-IN"
            disabled={isEdit}
            className={`${inputCls} disabled:opacity-60`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-[12px] text-[var(--qz-fg-3)]">Entries</label>
          <button
            type="button"
            onClick={addEntry}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--qz-accent)] bg-transparent border-0 cursor-pointer p-0"
          >
            <Plus size={13} /> Add entry
          </button>
        </div>

        {entries.map((d, i) => {
          const expanded = open[i] ?? false;
          return (
            <div
              key={i}
              className="rounded-lg"
              style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
            >
              <div className="flex items-center gap-2 p-3">
                <button
                  type="button"
                  onClick={() => setOpen((p) => ({ ...p, [i]: !expanded }))}
                  className="flex-shrink-0 p-1 bg-transparent border-0 cursor-pointer text-[var(--qz-fg-3)]"
                >
                  {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                <input
                  value={d.seq}
                  onChange={(e) => setEntry(i, { seq: e.target.value })}
                  placeholder="Seq"
                  className={inputCls}
                  style={{ ...monoSt, width: 70, flexShrink: 0 }}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />
                <select
                  value={d.action}
                  onChange={(e) => setEntry(i, { action: e.target.value as "permit" | "deny" })}
                  className={inputCls}
                  style={{ ...inputSt, width: 100, flexShrink: 0 }}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                >
                  <option value="permit">permit</option>
                  <option value="deny">deny</option>
                </select>
                <input
                  value={d.description}
                  onChange={(e) => setEntry(i, { description: e.target.value })}
                  placeholder="Description"
                  className={inputCls}
                  style={inputSt}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />
                <button
                  type="button"
                  onClick={() => setEntries((p) => p.filter((_, j) => j !== i))}
                  title="Remove entry"
                  className="flex-shrink-0 p-2 rounded-md bg-transparent border-0 cursor-pointer text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)]"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              {expanded && (
                <div className="px-4 pb-4 flex flex-col gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--qz-fg-4)] m-0">
                    Match
                  </p>
                  <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                    <div>
                      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[4px]">IPv4 prefix-list</label>
                      <select
                        value={d.matchIpPrefixList}
                        onChange={(e) => setEntry(i, { matchIpPrefixList: e.target.value })}
                        className={inputCls}
                        style={inputSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      >
                        <option value="">any</option>
                        {v4Lists.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[4px]">IPv6 prefix-list</label>
                      <select
                        value={d.matchIpv6PrefixList}
                        onChange={(e) => setEntry(i, { matchIpv6PrefixList: e.target.value })}
                        className={inputCls}
                        style={inputSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      >
                        <option value="">any</option>
                        {v6Lists.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[4px]">Community</label>
                      <input
                        value={d.matchCommunity}
                        onChange={(e) => setEntry(i, { matchCommunity: e.target.value })}
                        placeholder="65000:100"
                        className={inputCls}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[4px]">Metric</label>
                      <input
                        value={d.matchMetric}
                        onChange={(e) => setEntry(i, { matchMetric: e.target.value })}
                        placeholder="any"
                        className={inputCls}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[4px]">Tag</label>
                      <input
                        value={d.matchTag}
                        onChange={(e) => setEntry(i, { matchTag: e.target.value })}
                        placeholder="any"
                        className={inputCls}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                    </div>
                  </div>

                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--qz-fg-4)] m-0 mt-1">
                    Set
                  </p>
                  <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                    <div>
                      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[4px]">Local preference</label>
                      <input
                        value={d.setLocalPref}
                        onChange={(e) => setEntry(i, { setLocalPref: e.target.value })}
                        placeholder="unchanged"
                        className={inputCls}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[4px]">Metric (MED)</label>
                      <input
                        value={d.setMetric}
                        onChange={(e) => setEntry(i, { setMetric: e.target.value })}
                        placeholder="unchanged"
                        className={inputCls}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[4px]">Community</label>
                      <input
                        value={d.setCommunity}
                        onChange={(e) => setEntry(i, { setCommunity: e.target.value })}
                        placeholder="65000:100 65000:200"
                        className={inputCls}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[4px]">AS-path prepend</label>
                      <input
                        value={d.setAsPathPrepend}
                        onChange={(e) => setEntry(i, { setAsPathPrepend: e.target.value })}
                        placeholder="65000 65000"
                        className={inputCls}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[4px]">Next hop</label>
                      <input
                        value={d.setIpNextHop}
                        onChange={(e) => setEntry(i, { setIpNextHop: e.target.value })}
                        placeholder="unchanged"
                        className={inputCls}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[4px]">Origin</label>
                      <select
                        value={d.setOrigin}
                        onChange={(e) => setEntry(i, { setOrigin: e.target.value as EntryDraft["setOrigin"] })}
                        className={inputCls}
                        style={inputSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      >
                        <option value="">unchanged</option>
                        <option value="igp">igp</option>
                        <option value="egp">egp</option>
                        <option value="incomplete">incomplete</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[4px]">Tag</label>
                      <input
                        value={d.setTag}
                        onChange={(e) => setEntry(i, { setTag: e.target.value })}
                        placeholder="unchanged"
                        className={inputCls}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create route-map"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
