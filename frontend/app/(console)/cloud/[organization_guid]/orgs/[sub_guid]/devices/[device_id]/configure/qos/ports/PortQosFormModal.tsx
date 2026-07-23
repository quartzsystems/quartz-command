"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { QosPort, QosTrustMode, updatePortQos } from "@/lib/device/sonic-qos";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;

function focusBorder(e: React.FocusEvent<HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Set one port's trust mode and DSCP map binding. Saves through the agent's
/// `PUT /api/qos/ports/{port}`.
export function PortQosFormModal({
  port,
  maps,
  onClose,
  onSaved,
}: {
  port: QosPort;
  /** Names of the switch's DSCP→TC maps (authored on the DSCP Maps page). */
  maps: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [trust, setTrust] = useState<QosTrustMode>(port.trust);
  const [map, setMap] = useState(port.dscp_to_tc_map ?? maps[0] ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (trust === "dscp" && !map) {
      return setError("Trusting DSCP needs a map — create one on the DSCP Maps page first.");
    }

    setSaving(true);
    try {
      await updatePortQos(port.name, {
        trust,
        dscp_to_tc_map: trust === "dscp" ? map : null,
      });
      onSaved(`Saved QoS trust on ${port.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save port QoS.");
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={420}>
      <ModalHeader
        title="Edit Port Trust"
        subtitle={port.alias ? `${port.name} · ${port.alias}` : port.name}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Trust Mode</label>
          <select
            value={trust}
            onChange={(e) => setTrust(e.target.value as QosTrustMode)}
            className={`${inputCls} cursor-pointer`}
            style={inputSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          >
            <option value="none">Untrusted — all traffic in the default class</option>
            <option value="dscp">Trust DSCP</option>
          </select>
        </div>

        {trust === "dscp" && (
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">DSCP Map</label>
            <select
              value={map}
              onChange={(e) => setMap(e.target.value)}
              className={`${inputCls} cursor-pointer`}
              style={{ ...inputSt, fontFamily: "var(--qz-font-mono)" }}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              {maps.length === 0 && <option value="">No maps defined</option>}
              {maps.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}

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
