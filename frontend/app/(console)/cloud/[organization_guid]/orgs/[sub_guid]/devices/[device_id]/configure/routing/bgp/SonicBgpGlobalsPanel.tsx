"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/Switch";
import { BgpDoc, BgpGlobals, updateBgpGlobals } from "@/lib/device/sonic-bgp";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const EMPTY = (vrf: string): BgpGlobals => ({
  vrf,
  local_asn: null,
  router_id: null,
  keepalive: null,
  holdtime: null,
  graceful_restart: false,
  max_ebgp_paths: null,
  max_ibgp_paths: null,
});

/// Per-VRF BGP globals: local ASN (required to run BGP in the VRF),
/// router-id, session timers, graceful restart, and ECMP path limits.
export function SonicBgpGlobalsPanel({
  doc,
  onSaved,
}: {
  doc: BgpDoc;
  onSaved: (message: string) => void;
}) {
  const vrfs = doc.globals.length ? doc.globals.map((g) => g.vrf) : ["default"];
  const [vrf, setVrf] = useState(vrfs[0]);

  const current = doc.globals.find((g) => g.vrf === vrf) ?? EMPTY(vrf);

  const [asn, setAsn] = useState("");
  const [routerId, setRouterId] = useState("");
  const [keepalive, setKeepalive] = useState("");
  const [holdtime, setHoldtime] = useState("");
  const [gracefulRestart, setGracefulRestart] = useState(false);
  const [maxEbgp, setMaxEbgp] = useState("");
  const [maxIbgp, setMaxIbgp] = useState("");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Re-seed the form when the selected VRF (or a refresh) changes.
  useEffect(() => {
    setAsn(current.local_asn != null ? String(current.local_asn) : "");
    setRouterId(current.router_id ?? "");
    setKeepalive(current.keepalive != null ? String(current.keepalive) : "");
    setHoldtime(current.holdtime != null ? String(current.holdtime) : "");
    setGracefulRestart(current.graceful_restart);
    setMaxEbgp(current.max_ebgp_paths != null ? String(current.max_ebgp_paths) : "");
    setMaxIbgp(current.max_ibgp_paths != null ? String(current.max_ibgp_paths) : "");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrf, doc]);

  const optInt = (label: string, raw: string, min: number, max: number): number | null | string => {
    if (!raw.trim()) return null;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < min || v > max) {
      return `${label} must be a whole number between ${min} and ${max}.`;
    }
    return v;
  };

  const save = async () => {
    setError("");

    let asnNum: number | null = null;
    if (asn.trim()) {
      asnNum = Number(asn);
      if (!Number.isInteger(asnNum) || asnNum < 1 || asnNum > 4294967295) {
        return setError("Local AS must be a whole number between 1 and 4294967295.");
      }
    }
    const ka = optInt("Keepalive", keepalive, 1, 3600);
    if (typeof ka === "string") return setError(ka);
    const ht = optInt("Hold time", holdtime, 3, 3600);
    if (typeof ht === "string") return setError(ht);
    const me = optInt("Max eBGP paths", maxEbgp, 1, 256);
    if (typeof me === "string") return setError(me);
    const mi = optInt("Max iBGP paths", maxIbgp, 1, 256);
    if (typeof mi === "string") return setError(mi);

    setSaving(true);
    try {
      await updateBgpGlobals(vrf, {
        local_asn: asnNum,
        router_id: routerId.trim() || null,
        keepalive: ka,
        holdtime: ht,
        graceful_restart: gracefulRestart,
        max_ebgp_paths: me,
        max_ibgp_paths: mi,
      });
      onSaved(`Saved BGP settings for VRF ${vrf}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save BGP settings.");
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, node: React.ReactNode) => (
    <div>
      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">{label}</label>
      {node}
    </div>
  );

  return (
    <div
      className="max-w-[640px] rounded-xl p-6"
      style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
    >
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {field(
          "VRF",
          <select
            value={vrf}
            onChange={(e) => setVrf(e.target.value)}
            className={`${inputCls} cursor-pointer`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          >
            {vrfs.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>,
        )}
        {field(
          "Local AS",
          <input
            type="number"
            value={asn}
            onChange={(e) => setAsn(e.target.value)}
            placeholder="65000"
            className={inputCls}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />,
        )}
        {field(
          "Router ID",
          <input
            value={routerId}
            onChange={(e) => setRouterId(e.target.value)}
            placeholder="10.0.0.1"
            className={inputCls}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />,
        )}
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {field(
            "Keepalive (s)",
            <input
              type="number"
              value={keepalive}
              onChange={(e) => setKeepalive(e.target.value)}
              placeholder="60"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />,
          )}
          {field(
            "Hold Time (s)",
            <input
              type="number"
              value={holdtime}
              onChange={(e) => setHoldtime(e.target.value)}
              placeholder="180"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />,
          )}
        </div>
        {field(
          "Max eBGP Paths",
          <input
            type="number"
            value={maxEbgp}
            onChange={(e) => setMaxEbgp(e.target.value)}
            placeholder="FRR default"
            className={inputCls}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />,
        )}
        {field(
          "Max iBGP Paths",
          <input
            type="number"
            value={maxIbgp}
            onChange={(e) => setMaxIbgp(e.target.value)}
            placeholder="FRR default"
            className={inputCls}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />,
        )}
      </div>

      <div className="flex items-center justify-between mt-4">
        <div>
          <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">Graceful restart</p>
          <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
            Preserve forwarding across BGP restarts
          </p>
        </div>
        <Switch on={gracefulRestart} onChange={setGracefulRestart} />
      </div>

      {error && (
        <p className="text-[12px] m-0 mt-4" style={{ color: "var(--qz-danger)" }}>
          {error}
        </p>
      )}

      <div className="flex justify-end mt-5">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-[9px] rounded-md text-[13px] font-semibold cursor-pointer border-0"
          style={{ background: "var(--qz-accent)", color: "var(--qz-fg-on-accent)", opacity: saving ? 0.7 : 1 }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
