"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { SnmpAccess, SystemSnmpDoc, updateSystemSnmp } from "@/lib/device/sonic-system";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

interface CommunityDraft {
  name: string;
  access: SnmpAccess;
}

/// Edit the SNMP agent state, location/contact strings, and v2c communities.
/// The agent diffs the full desired set against SNMP_COMMUNITY.
export function SnmpFormModal({
  live,
  onClose,
  onSaved,
}: {
  live: SystemSnmpDoc;
  onClose: () => void;
  /** Called after a successful apply with a toast-able summary. */
  onSaved: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(live.enabled);
  const [location, setLocation] = useState(live.location ?? "");
  const [contact, setContact] = useState(live.contact ?? "");
  const [communities, setCommunities] = useState<CommunityDraft[]>(
    live.communities.map((c) => ({ ...c })),
  );

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const parsed: CommunityDraft[] = [];
    const seen = new Set<string>();
    for (const [i, c] of communities.entries()) {
      const name = c.name.trim();
      if (!name) continue;
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        return setError(`Community ${i + 1}: only letters, digits, dash, and underscore.`);
      }
      if (seen.has(name)) return setError(`Community "${name}" is listed twice.`);
      seen.add(name);
      parsed.push({ name, access: c.access });
    }
    if (enabled && parsed.length === 0) {
      return setError("Add at least one community, or disable SNMP.");
    }

    setSaving(true);
    try {
      await updateSystemSnmp({
        enabled,
        location: location.trim() || null,
        contact: contact.trim() || null,
        communities: parsed,
      });
      onSaved("Saved SNMP settings.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save SNMP settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={560}>
      <ModalHeader
        title="Edit SNMP Settings"
        subtitle="SNMP agent, v2c communities, and system location / contact strings"
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">SNMP enabled</p>
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
              Run the SNMP agent and answer polls from monitoring systems
            </p>
          </div>
          <Switch on={enabled} onChange={setEnabled} />
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Location</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Rack A4, HQ closet"
              className={inputCls}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Contact</label>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="netops@example.com"
              className={inputCls}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-[6px]">
            <label className="text-[12px] text-[var(--qz-fg-3)]">v2c communities</label>
            <button
              type="button"
              onClick={() => setCommunities((p) => [...p, { name: "", access: "ro" }])}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--qz-accent)] bg-transparent border-0 cursor-pointer p-0"
            >
              <Plus size={13} /> Add community
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {communities.length === 0 && (
              <p className="text-[12px] text-[var(--qz-fg-4)] m-0">No communities configured.</p>
            )}
            {communities.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={c.name}
                  onChange={(e) =>
                    setCommunities((p) =>
                      p.map((v, j) => (j === i ? { ...v, name: e.target.value } : v)),
                    )
                  }
                  placeholder="public"
                  className={inputCls}
                  style={monoSt}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />
                <select
                  value={c.access}
                  onChange={(e) =>
                    setCommunities((p) =>
                      p.map((v, j) =>
                        j === i ? { ...v, access: e.target.value as SnmpAccess } : v,
                      ),
                    )
                  }
                  className={inputCls}
                  style={{ ...inputSt, width: 140, flexShrink: 0 }}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                >
                  <option value="ro">Read-only</option>
                  <option value="rw">Read-write</option>
                </select>
                <button
                  type="button"
                  onClick={() => setCommunities((p) => p.filter((_, j) => j !== i))}
                  title="Remove community"
                  className="flex-shrink-0 p-2 rounded-md bg-transparent border-0 cursor-pointer text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)]"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
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
            {saving ? "Applying…" : "Apply changes"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
