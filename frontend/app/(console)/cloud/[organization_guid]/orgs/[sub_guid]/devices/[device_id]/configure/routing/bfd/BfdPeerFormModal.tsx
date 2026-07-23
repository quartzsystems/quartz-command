"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { BfdPeer, updateBfdPeer } from "@/lib/device/sonic-bfd";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const IP_RE = /^([0-9]{1,3}\.){3}[0-9]{1,3}$|^[0-9a-fA-F:]+$/;

/// Create or edit one BFD peer. On edit the identity fields (peer, type,
/// interface, VRF) are frozen — the agent upserts by identity, so changing
/// them would create a second peer.
export function BfdPeerFormModal({
  peer,
  onClose,
  onSaved,
}: {
  /** null = create. */
  peer: BfdPeer | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editingIdentity = peer != null;

  const [address, setAddress] = useState(peer?.peer ?? "");
  const [multihop, setMultihop] = useState(peer?.multihop ?? false);
  const [iface, setIface] = useState(peer?.interface ?? "");
  const [localAddress, setLocalAddress] = useState(peer?.local_address ?? "");
  const [vrf, setVrf] = useState(peer?.vrf ?? "");
  const [rx, setRx] = useState(peer?.rx_interval_ms != null ? String(peer.rx_interval_ms) : "");
  const [tx, setTx] = useState(peer?.tx_interval_ms != null ? String(peer.tx_interval_ms) : "");
  const [multiplier, setMultiplier] = useState(
    peer?.multiplier != null ? String(peer.multiplier) : "",
  );
  const [passive, setPassive] = useState(peer?.passive ?? false);
  const [shutdown, setShutdown] = useState(peer?.shutdown ?? false);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const parseMs = (raw: string, label: string, min: number, max: number): number | null => {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Error(`${label} must be a whole number between ${min} and ${max}.`);
    }
    return n;
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const addr = address.trim();
    if (!IP_RE.test(addr)) return setError("Peer must be an IPv4 or IPv6 address.");
    if (multihop && localAddress.trim() === "") {
      return setError("Multihop peers need a local source address.");
    }
    if (!multihop && iface.trim() === "" && localAddress.trim() === "") {
      return setError("Single-hop peers need an interface (or a local address).");
    }

    let rxMs: number | null, txMs: number | null, mult: number | null;
    try {
      rxMs = parseMs(rx, "Receive interval", 10, 60000);
      txMs = parseMs(tx, "Transmit interval", 10, 60000);
      mult = parseMs(multiplier, "Detection multiplier", 2, 255);
    } catch (err) {
      return setError((err as Error).message);
    }

    setSaving(true);
    try {
      await updateBfdPeer({
        peer: addr,
        interface: multihop ? null : iface.trim() || null,
        local_address: localAddress.trim() || null,
        multihop,
        vrf: vrf.trim() || null,
        rx_interval_ms: rxMs,
        tx_interval_ms: txMs,
        multiplier: mult,
        passive,
        shutdown,
      });
      onSaved(`Saved BFD peer ${addr}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the BFD peer.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={editingIdentity ? "Edit BFD Peer" : "Add BFD Peer"}
        subtitle={editingIdentity ? peer.peer : "Protect routing sessions with fast failure detection"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Peer Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={editingIdentity}
              placeholder="10.0.0.1"
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Type</label>
            <select
              value={multihop ? "multihop" : "single-hop"}
              onChange={(e) => setMultihop(e.target.value === "multihop")}
              disabled={editingIdentity}
              className={`${inputCls} cursor-pointer disabled:opacity-60`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="single-hop">Single-hop</option>
              <option value="multihop">Multihop</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Interface</label>
            <input
              value={multihop ? "" : iface}
              onChange={(e) => setIface(e.target.value)}
              disabled={editingIdentity || multihop}
              placeholder={multihop ? "n/a for multihop" : "Ethernet0 / Vlan10"}
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Local Address{multihop ? "" : " (optional)"}
            </label>
            <input
              value={localAddress}
              onChange={(e) => setLocalAddress(e.target.value)}
              placeholder="10.0.0.2"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">VRF</label>
            <input
              value={vrf}
              onChange={(e) => setVrf(e.target.value)}
              disabled={editingIdentity}
              placeholder="default"
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Detection Multiplier
            </label>
            <input
              type="number"
              min={2}
              max={255}
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
              placeholder="3 (default)"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Min Receive Interval (ms)
            </label>
            <input
              type="number"
              min={10}
              max={60000}
              value={rx}
              onChange={(e) => setRx(e.target.value)}
              placeholder="300 (default)"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Min Transmit Interval (ms)
            </label>
            <input
              type="number"
              min={10}
              max={60000}
              value={tx}
              onChange={(e) => setTx(e.target.value)}
              placeholder="300 (default)"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">Passive mode</p>
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
              Wait for the peer to initiate the session
            </p>
          </div>
          <Switch on={passive} onChange={setPassive} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">Shutdown</p>
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
              Keep the peer configured but administratively down
            </p>
          </div>
          <Switch on={shutdown} onChange={setShutdown} />
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
            {saving ? "Saving…" : editingIdentity ? "Save changes" : "Add peer"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
