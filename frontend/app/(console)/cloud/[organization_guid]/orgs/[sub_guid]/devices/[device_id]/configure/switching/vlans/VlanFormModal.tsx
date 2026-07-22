"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import {
  SwitchVlan,
  VlanMember,
  createSwitchVlan,
  updateSwitchVlan,
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

interface ListRow {
  key: string;
  value: string;
}
interface MemberRow {
  key: string;
  name: string;
  tagging: "tagged" | "untagged";
}

let keyCounter = 0;
const nextKey = () => `vlan-row-${keyCounter++}`;
const toRows = (values: string[]): ListRow[] => values.map((value) => ({ key: nextKey(), value }));
const toMemberRows = (members: VlanMember[]): MemberRow[] =>
  members.map((m) => ({ key: nextKey(), name: m.name, tagging: m.tagging }));

/// Create or edit an L2 VLAN: id, description, SVI addresses, DHCP helpers,
/// and the member set with per-member tagging. Saves through the agent's
/// VLAN write endpoints; the page reloads live state afterwards.
export function VlanFormModal({
  initial,
  existing,
  memberCandidates,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  initial?: SwitchVlan;
  /** All current VLANs, for duplicate-ID detection. */
  existing: SwitchVlan[];
  /** Names eligible for membership: front-panel ports and port channels. */
  memberCandidates: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;

  const [vlanId, setVlanId] = useState(initial ? String(initial.vlan_id) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [addresses, setAddresses] = useState<ListRow[]>(toRows(initial?.ip_addresses ?? []));
  const [helpers, setHelpers] = useState<ListRow[]>(toRows(initial?.dhcp_helpers ?? []));
  const [members, setMembers] = useState<MemberRow[]>(toMemberRows(initial?.members ?? []));

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const addRow = (set: React.Dispatch<React.SetStateAction<ListRow[]>>) =>
    set((p) => [...p, { key: nextKey(), value: "" }]);
  const removeRow = (set: React.Dispatch<React.SetStateAction<ListRow[]>>, key: string) =>
    set((p) => p.filter((r) => r.key !== key));
  const updateRow = (set: React.Dispatch<React.SetStateAction<ListRow[]>>, key: string, value: string) =>
    set((p) => p.map((r) => (r.key === key ? { ...r, value } : r)));

  const addMember = () =>
    setMembers((p) => {
      const used = new Set(p.map((m) => m.name));
      const free = memberCandidates.find((c) => !used.has(c)) ?? "";
      return [...p, { key: nextKey(), name: free, tagging: "untagged" }];
    });
  const removeMember = (key: string) => setMembers((p) => p.filter((m) => m.key !== key));
  const updateMember = (key: string, patch: Partial<MemberRow>) =>
    setMembers((p) => p.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const id = Number(vlanId);
    if (!Number.isInteger(id) || id < 1 || id > 4094) {
      setError("VLAN ID must be a whole number between 1 and 4094.");
      return;
    }
    if (!isEdit && existing.some((v) => v.vlan_id === id)) {
      setError(`VLAN ${id} already exists.`);
      return;
    }
    const memberList: VlanMember[] = [];
    const seen = new Set<string>();
    for (const m of members) {
      if (!m.name) {
        setError("Every member row needs an interface.");
        return;
      }
      if (seen.has(m.name)) {
        setError(`${m.name} is listed twice.`);
        return;
      }
      seen.add(m.name);
      memberList.push({ name: m.name, tagging: m.tagging });
    }

    setSaving(true);
    try {
      const input = {
        description: description.trim() || null,
        ip_addresses: addresses.map((a) => a.value.trim()).filter(Boolean),
        dhcp_helpers: helpers.map((h) => h.value.trim()).filter(Boolean),
        members: memberList,
      };
      if (isEdit) await updateSwitchVlan(id, input);
      else await createSwitchVlan(id, input);
      onSaved(isEdit ? `Saved VLAN ${id}.` : `Created VLAN ${id}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save VLAN.");
    } finally {
      setSaving(false);
    }
  };

  const listEditor = (
    label: string,
    rows: ListRow[],
    set: React.Dispatch<React.SetStateAction<ListRow[]>>,
    placeholder: string,
    emptyHint: string,
  ) => (
    <div>
      <div className="flex items-center justify-between mb-[6px]">
        <label className="block text-[12px] text-[var(--qz-fg-3)]">{label}</label>
        <button
          type="button"
          onClick={() => addRow(set)}
          className="flex items-center gap-[5px] text-[12px] text-[var(--qz-fg-3)] hover:text-[var(--qz-accent)] transition-colors cursor-pointer bg-transparent border-0 p-0"
        >
          <Plus size={13} /> Add
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12px] text-[var(--qz-fg-4)] m-0">{emptyHint}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-2">
              <input
                value={r.value}
                onChange={(e) => updateRow(set, r.key, e.target.value)}
                placeholder={placeholder}
                className={inputCls}
                style={monoSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
              <button
                type="button"
                onClick={() => removeRow(set, r.key)}
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
  );

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={isEdit ? "Edit VLAN" : "Create VLAN"}
        subtitle={isEdit ? `Vlan${initial!.vlan_id}` : "Layer 2 VLAN"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "140px 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              VLAN ID <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <input
              type="number"
              min={1}
              max={4094}
              value={vlanId}
              onChange={(e) => setVlanId(e.target.value)}
              placeholder="10"
              disabled={isEdit}
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Servers"
              className={inputCls}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        {listEditor(
          "IP Addresses (SVI)",
          addresses,
          setAddresses,
          "10.0.10.1/24",
          "No addresses — leave empty for a pure L2 VLAN.",
        )}
        {listEditor(
          "DHCP Helpers",
          helpers,
          setHelpers,
          "10.0.0.5",
          "No DHCP relay destinations.",
        )}

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
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0">No member ports.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {members.map((m) => (
                <div key={m.key} className="flex items-center gap-2">
                  <select
                    value={m.name}
                    onChange={(e) => updateMember(m.key, { name: e.target.value })}
                    className={`${inputCls} cursor-pointer`}
                    style={monoSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  >
                    {!m.name && <option value="">Select…</option>}
                    {/* Keep the current name selectable even if it's no longer a candidate. */}
                    {(memberCandidates.includes(m.name) || !m.name
                      ? memberCandidates
                      : [m.name, ...memberCandidates]
                    ).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={m.tagging}
                    onChange={(e) =>
                      updateMember(m.key, { tagging: e.target.value as "tagged" | "untagged" })
                    }
                    className={`${inputCls} cursor-pointer`}
                    style={{ ...inputSt, width: 140 }}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  >
                    <option value="untagged">Untagged</option>
                    <option value="tagged">Tagged</option>
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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create VLAN"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
