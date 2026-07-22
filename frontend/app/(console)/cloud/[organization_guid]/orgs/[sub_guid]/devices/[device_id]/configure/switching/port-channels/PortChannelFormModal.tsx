"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import {
  PortChannel,
  createPortChannel,
  updatePortChannel,
} from "@/lib/device/switching";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

interface MemberRow {
  key: string;
  name: string;
}

let keyCounter = 0;
const nextKey = () => `pc-member-${keyCounter++}`;

/// Create or edit a port channel: protocol, member set, and the LAG knobs
/// (min links, fallback, fast rate, MTU). Saves through the agent's
/// port-channel write endpoints; the page reloads live state afterwards.
export function PortChannelFormModal({
  initial,
  existing,
  portCandidates,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  initial?: PortChannel;
  /** All current port channels, for duplicate-name detection. */
  existing: PortChannel[];
  /** Front-panel port names eligible as members. */
  portCandidates: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;

  // "PortChannel0001" → editable numeric suffix; the prefix is fixed.
  const [number, setNumber] = useState(
    initial ? initial.name.replace(/^PortChannel/, "") : "",
  );
  const [protocol, setProtocol] = useState<"lacp" | "static">(initial?.protocol ?? "lacp");
  const [enabled, setEnabled] = useState(initial ? initial.admin_status === "up" : true);
  const [mtu, setMtu] = useState(initial?.mtu != null ? String(initial.mtu) : "");
  const [minLinks, setMinLinks] = useState(
    initial?.min_links != null ? String(initial.min_links) : "",
  );
  const [fallback, setFallback] = useState(initial?.fallback ?? false);
  const [fastRate, setFastRate] = useState(initial?.fast_rate ?? false);
  const [members, setMembers] = useState<MemberRow[]>(
    (initial?.members ?? []).map((m) => ({ key: nextKey(), name: m.name })),
  );

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const addMember = () =>
    setMembers((p) => {
      const used = new Set(p.map((m) => m.name));
      const free = portCandidates.find((c) => !used.has(c)) ?? "";
      return [...p, { key: nextKey(), name: free }];
    });
  const removeMember = (key: string) => setMembers((p) => p.filter((m) => m.key !== key));
  const updateMember = (key: string, name: string) =>
    setMembers((p) => p.map((m) => (m.key === key ? { ...m, name } : m)));

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const n = Number(number);
    if (!Number.isInteger(n) || n < 0 || n > 9999) {
      setError("Port channel number must be a whole number between 0 and 9999.");
      return;
    }
    const name = `PortChannel${String(n).padStart(4, "0")}`;
    if (!isEdit && existing.some((pc) => pc.name === name)) {
      setError(`${name} already exists.`);
      return;
    }
    if (mtu.trim() !== "") {
      const m = Number(mtu);
      if (!Number.isInteger(m) || m < 68 || m > 9216) {
        setError("MTU must be a whole number between 68 and 9216.");
        return;
      }
    }
    if (minLinks.trim() !== "") {
      const m = Number(minLinks);
      if (!Number.isInteger(m) || m < 1) {
        setError("Min links must be a positive whole number.");
        return;
      }
    }
    const memberNames: string[] = [];
    const seen = new Set<string>();
    for (const m of members) {
      if (!m.name) {
        setError("Every member row needs a port.");
        return;
      }
      if (seen.has(m.name)) {
        setError(`${m.name} is listed twice.`);
        return;
      }
      seen.add(m.name);
      memberNames.push(m.name);
    }

    setSaving(true);
    try {
      const input = {
        protocol,
        admin_status: enabled ? ("up" as const) : ("down" as const),
        mtu: mtu.trim() === "" ? null : Number(mtu),
        min_links: minLinks.trim() === "" ? null : Number(minLinks),
        fallback,
        fast_rate: fastRate,
        members: memberNames,
      };
      if (isEdit) await updatePortChannel(initial!.name, input);
      else await createPortChannel(name, input);
      onSaved(isEdit ? `Saved ${initial!.name}.` : `Created ${name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save port channel.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={isEdit ? "Edit Port Channel" : "Create Port Channel"}
        subtitle={isEdit ? initial!.name : "Link aggregation group"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Number <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-[var(--qz-fg-3)]" style={{ fontFamily: "var(--qz-font-mono)" }}>
                PortChannel
              </span>
              <input
                type="number"
                min={0}
                max={9999}
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="0001"
                disabled={isEdit}
                className={`${inputCls} disabled:opacity-60`}
                style={monoSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            </div>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Protocol</label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as "lacp" | "static")}
              className={`${inputCls} cursor-pointer`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="lacp">LACP</option>
              <option value="static">Static</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">MTU</label>
            <input
              type="number"
              min={68}
              max={9216}
              value={mtu}
              onChange={(e) => setMtu(e.target.value)}
              placeholder="9100"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Min Links</label>
            <input
              type="number"
              min={1}
              value={minLinks}
              onChange={(e) => setMinLinks(e.target.value)}
              placeholder="1"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        <div className="flex items-center gap-6 flex-wrap">
          <label className="flex items-center gap-[10px] cursor-pointer select-none">
            <Switch on={enabled} onChange={setEnabled} />
            <span className="text-[13px] text-[var(--qz-fg-2)]">Enabled</span>
          </label>
          {protocol === "lacp" && (
            <>
              <label className="flex items-center gap-[10px] cursor-pointer select-none">
                <Switch on={fastRate} onChange={setFastRate} />
                <span className="text-[13px] text-[var(--qz-fg-2)]">Fast rate</span>
              </label>
              <label className="flex items-center gap-[10px] cursor-pointer select-none">
                <Switch on={fallback} onChange={setFallback} />
                <span className="text-[13px] text-[var(--qz-fg-2)]">Fallback</span>
              </label>
            </>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-[6px]">
            <label className="block text-[12px] text-[var(--qz-fg-3)]">Members</label>
            <button
              type="button"
              onClick={addMember}
              className="flex items-center gap-[5px] text-[12px] text-[var(--qz-fg-3)] hover:text-[var(--qz-accent)] transition-colors cursor-pointer bg-transparent border-0 p-0"
            >
              <Plus size={13} /> Add member
            </button>
          </div>
          {members.length === 0 ? (
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0">No member ports yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {members.map((m) => (
                <div key={m.key} className="flex items-center gap-2">
                  <select
                    value={m.name}
                    onChange={(e) => updateMember(m.key, e.target.value)}
                    className={`${inputCls} cursor-pointer`}
                    style={monoSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  >
                    {!m.name && <option value="">Select…</option>}
                    {(portCandidates.includes(m.name) || !m.name
                      ? portCandidates
                      : [m.name, ...portCandidates]
                    ).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeMember(m.key)}
                    title="Remove member"
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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create Port Channel"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
