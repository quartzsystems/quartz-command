"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { OspfInterface, updateOspfInterface } from "@/lib/device/sonic-ospf";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Per-interface OSPF settings: area placement (clearing the area removes
/// the interface from OSPF), cost, timers, network type, passive, and BFD.
export function SonicOspfInterfaceModal({
  iface,
  areas,
  onClose,
  onSaved,
}: {
  iface: OspfInterface;
  /** Known area ids, offered as suggestions. */
  areas: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [area, setArea] = useState(iface.area ?? "");
  const [cost, setCost] = useState(iface.cost != null ? String(iface.cost) : "");
  const [helloInterval, setHelloInterval] = useState(
    iface.hello_interval != null ? String(iface.hello_interval) : "",
  );
  const [deadInterval, setDeadInterval] = useState(
    iface.dead_interval != null ? String(iface.dead_interval) : "",
  );
  const [networkType, setNetworkType] = useState(iface.network_type ?? "");
  const [passive, setPassive] = useState(iface.passive);
  const [bfd, setBfd] = useState(iface.bfd);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const optInt = (label: string, raw: string, min: number, max: number): number | null | string => {
    if (!raw.trim()) return null;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < min || v > max) {
      return `${label} must be a whole number between ${min} and ${max}.`;
    }
    return v;
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const c = optInt("Cost", cost, 1, 65535);
    if (typeof c === "string") return setError(c);
    const hello = optInt("Hello interval", helloInterval, 1, 65535);
    if (typeof hello === "string") return setError(hello);
    const dead = optInt("Dead interval", deadInterval, 1, 65535);
    if (typeof dead === "string") return setError(dead);

    setSaving(true);
    try {
      await updateOspfInterface(iface.name, {
        area: area.trim() || null,
        cost: c,
        hello_interval: hello,
        dead_interval: dead,
        network_type: (networkType || null) as "broadcast" | "point-to-point" | null,
        passive,
        bfd,
      });
      onSaved(`Saved OSPF settings for ${iface.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save interface settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader title="Edit OSPF Interface" subtitle={iface.name} onClose={onClose} />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Area</label>
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="0.0.0.0 — empty removes from OSPF"
            list="sonic-ospf-areas"
            className={inputCls}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
          <datalist id="sonic-ospf-areas">
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Cost</label>
            <input
              type="number"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="Auto"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Network Type</label>
            <select
              value={networkType}
              onChange={(e) => setNetworkType(e.target.value)}
              className={`${inputCls} cursor-pointer`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="">Default</option>
              <option value="broadcast">Broadcast</option>
              <option value="point-to-point">Point-to-point</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Hello Interval (s)</label>
            <input
              type="number"
              value={helloInterval}
              onChange={(e) => setHelloInterval(e.target.value)}
              placeholder="10 (default)"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Dead Interval (s)</label>
            <input
              type="number"
              value={deadInterval}
              onChange={(e) => setDeadInterval(e.target.value)}
              placeholder="40 (default)"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">Passive</p>
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
              Advertise the network but form no adjacencies
            </p>
          </div>
          <Switch on={passive} onChange={setPassive} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">BFD</p>
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
              Fast failure detection for adjacencies on this interface
            </p>
          </div>
          <Switch on={bfd} onChange={setBfd} />
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
