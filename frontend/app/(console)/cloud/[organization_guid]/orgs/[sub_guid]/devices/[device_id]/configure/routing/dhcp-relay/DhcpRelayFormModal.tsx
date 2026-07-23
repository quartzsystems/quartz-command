"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { DhcpRelayVlan, updateDhcpRelay } from "@/lib/device/sonic-dhcp-relay";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

interface ServerRow {
  key: string;
  value: string;
}

let keyCounter = 0;
const nextKey = () => `relay-row-${keyCounter++}`;

/// Edit one VLAN's DHCP relay servers (the VLAN's dhcp_servers list — the
/// same field the VLAN editor calls DHCP helpers). Saves through the
/// agent's `PUT /api/routing/dhcp-relay/{vlan_id}`.
export function DhcpRelayFormModal({
  vlan,
  onClose,
  onSaved,
}: {
  vlan: DhcpRelayVlan;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [servers, setServers] = useState<ServerRow[]>(
    vlan.servers.map((value) => ({ key: nextKey(), value })),
  );

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const cleaned: string[] = [];
    for (const row of servers) {
      const v = row.value.trim();
      if (!v) continue;
      if (cleaned.includes(v)) return setError(`Duplicate server ${v}.`);
      cleaned.push(v);
    }

    setSaving(true);
    try {
      await updateDhcpRelay(vlan.vlan_id, cleaned);
      onSaved(`Saved DHCP relay on VLAN ${vlan.vlan_id}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save DHCP relay.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title="Edit DHCP Relay"
        subtitle={
          vlan.description ? `VLAN ${vlan.vlan_id} — ${vlan.description}` : `VLAN ${vlan.vlan_id}`
        }
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        {vlan.ip_addresses.length === 0 && (
          <p
            className="text-[12.5px] m-0 rounded-md px-3 py-2"
            style={{ background: "var(--qz-warn-soft)", color: "var(--qz-fg-2)", border: "1px solid var(--qz-border)" }}
          >
            This VLAN has no SVI address — relayed requests need one to source
            replies. Add an address under Switching → VLANs.
          </p>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[12px] text-[var(--qz-fg-3)]">DHCP Servers</label>
            <button
              type="button"
              onClick={() => setServers((p) => [...p, { key: nextKey(), value: "" }])}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--qz-accent)] bg-transparent border-0 cursor-pointer p-0"
            >
              <Plus size={13} /> Add server
            </button>
          </div>
          {servers.length === 0 && (
            <p className="text-[12.5px] text-[var(--qz-fg-4)] m-0">
              No servers — DHCP relay is off for this VLAN.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {servers.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <input
                  value={row.value}
                  onChange={(e) =>
                    setServers((p) =>
                      p.map((r) => (r.key === row.key ? { ...r, value: e.target.value } : r)),
                    )
                  }
                  placeholder="10.0.0.10"
                  className={inputCls}
                  style={monoSt}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />
                <button
                  type="button"
                  title="Remove server"
                  aria-label="Remove server"
                  onClick={() => setServers((p) => p.filter((r) => r.key !== row.key))}
                  className="grid place-items-center w-8 h-8 flex-shrink-0 rounded-md bg-transparent border-0 text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer"
                >
                  <Trash2 size={14} />
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
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
