"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import {
  BGP_ADDRESS_FAMILIES,
  BGP_AF_LABEL,
  BgpAddressFamily,
  BgpNeighbor,
  createBgpNeighbor,
  updateBgpNeighbor,
} from "@/lib/device/sonic-bgp";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Create or edit a BGP neighbor: peer address (or interface for unnumbered
/// sessions), remote AS, timers, and the enabled address-family set.
export function SonicBgpNeighborModal({
  initial,
  existing,
  vrfs,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  initial?: BgpNeighbor;
  existing: BgpNeighbor[];
  /** VRFs with BGP globals configured. */
  vrfs: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;
  const vrfChoices = vrfs.length ? vrfs : ["default"];

  const [vrf, setVrf] = useState(initial?.vrf ?? vrfChoices[0]);
  const [peer, setPeer] = useState(initial?.peer ?? "");
  const [remoteAsn, setRemoteAsn] = useState(
    initial?.remote_asn != null ? String(initial.remote_asn) : "",
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [localAddr, setLocalAddr] = useState(initial?.local_addr ?? "");
  const [keepalive, setKeepalive] = useState(
    initial?.keepalive != null ? String(initial.keepalive) : "",
  );
  const [holdtime, setHoldtime] = useState(
    initial?.holdtime != null ? String(initial.holdtime) : "",
  );
  const [multihopTtl, setMultihopTtl] = useState(
    initial?.ebgp_multihop_ttl != null ? String(initial.ebgp_multihop_ttl) : "",
  );
  const [bfd, setBfd] = useState(initial?.bfd ?? false);
  const [adminUp, setAdminUp] = useState((initial?.admin_status ?? "up") === "up");
  const [afs, setAfs] = useState<BgpAddressFamily[]>(
    initial?.address_families ?? ["ipv4_unicast"],
  );

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleAf = (af: BgpAddressFamily) =>
    setAfs((p) => (p.includes(af) ? p.filter((a) => a !== af) : [...p, af]));

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

    const trimmedPeer = peer.trim();
    if (!isEdit) {
      if (!trimmedPeer) return setError("Neighbor address or interface is required.");
      if (existing.some((n) => n.vrf === vrf && n.peer === trimmedPeer)) {
        return setError(`Neighbor ${trimmedPeer} already exists in VRF ${vrf}.`);
      }
    }

    let asnNum: number | null = null;
    if (remoteAsn.trim()) {
      asnNum = Number(remoteAsn);
      if (!Number.isInteger(asnNum) || asnNum < 1 || asnNum > 4294967295) {
        return setError("Remote AS must be a whole number between 1 and 4294967295.");
      }
    } else {
      return setError("Remote AS is required.");
    }
    const ka = optInt("Keepalive", keepalive, 1, 3600);
    if (typeof ka === "string") return setError(ka);
    const ht = optInt("Hold time", holdtime, 3, 3600);
    if (typeof ht === "string") return setError(ht);
    const ttl = optInt("Multihop TTL", multihopTtl, 1, 255);
    if (typeof ttl === "string") return setError(ttl);
    if (afs.length === 0) return setError("Enable at least one address family.");

    setSaving(true);
    try {
      const input = {
        remote_asn: asnNum,
        name: name.trim() || null,
        local_addr: localAddr.trim() || null,
        keepalive: ka,
        holdtime: ht,
        ebgp_multihop_ttl: ttl,
        bfd,
        admin_status: (adminUp ? "up" : "down") as "up" | "down",
        address_families: afs,
      };
      if (isEdit) {
        await updateBgpNeighbor(initial!.vrf, initial!.peer, input);
        onSaved(`Saved neighbor ${initial!.peer}.`);
      } else {
        await createBgpNeighbor(vrf, trimmedPeer, input);
        onSaved(`Created neighbor ${trimmedPeer}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save neighbor.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={isEdit ? "Edit BGP Neighbor" : "Add BGP Neighbor"}
        subtitle={isEdit ? `${initial!.peer} · VRF ${initial!.vrf}` : "New peering session"}
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
              {(isEdit && !vrfChoices.includes(vrf) ? [vrf, ...vrfChoices] : vrfChoices).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Neighbor <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <input
              value={peer}
              onChange={(e) => setPeer(e.target.value)}
              placeholder="10.0.0.2 or Ethernet0"
              disabled={isEdit}
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Remote AS <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <input
              type="number"
              value={remoteAsn}
              onChange={(e) => setRemoteAsn(e.target.value)}
              placeholder="65001"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Description</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="spine-1"
              className={inputCls}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Local Address</label>
            <input
              value={localAddr}
              onChange={(e) => setLocalAddr(e.target.value)}
              placeholder="Source of the session"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              eBGP Multihop TTL
            </label>
            <input
              type="number"
              value={multihopTtl}
              onChange={(e) => setMultihopTtl(e.target.value)}
              placeholder="Disabled"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Keepalive (s)</label>
            <input
              type="number"
              value={keepalive}
              onChange={(e) => setKeepalive(e.target.value)}
              placeholder="Inherit global"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Hold Time (s)</label>
            <input
              type="number"
              value={holdtime}
              onChange={(e) => setHoldtime(e.target.value)}
              placeholder="Inherit global"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Address Families</label>
          <div className="flex gap-2">
            {BGP_ADDRESS_FAMILIES.map((af) => {
              const on = afs.includes(af);
              return (
                <button
                  key={af}
                  type="button"
                  onClick={() => toggleAf(af)}
                  className="px-3 py-[7px] rounded-md text-[12.5px] font-medium cursor-pointer transition-all duration-[120ms]"
                  style={
                    on
                      ? {
                          background: "var(--qz-accent-soft)",
                          color: "var(--qz-accent)",
                          border: "1px solid color-mix(in oklab, var(--qz-accent) 30%, transparent)",
                        }
                      : {
                          background: "var(--qz-input-bg)",
                          color: "var(--qz-fg-3)",
                          border: "1px solid var(--qz-border)",
                        }
                  }
                >
                  {BGP_AF_LABEL[af]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">BFD</p>
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
              Fast failure detection for this session
            </p>
          </div>
          <Switch on={bfd} onChange={setBfd} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">Session enabled</p>
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
              Disable to hold the neighbor in shutdown
            </p>
          </div>
          <Switch on={adminUp} onChange={setAdminUp} />
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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add neighbor"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
