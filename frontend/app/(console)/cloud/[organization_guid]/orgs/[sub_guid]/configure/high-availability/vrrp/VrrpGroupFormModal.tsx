"use client";

import { useEffect, useMemo, useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import type { Device } from "@/lib/api";
import { deviceApiFetch } from "@/lib/device/api";
import { switchLabel } from "@/lib/device/ha-fanout";
import { updateVrrpGroup } from "@/lib/device/sonic-vrrp";
import type { VrrpRow } from "./page";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const CIDR_OR_IP_RE = /^([0-9]{1,3}\.){3}[0-9]{1,3}(\/\d{1,2})?$|^[0-9a-fA-F:]+(\/\d{1,3})?$/;

interface L3IfacesResp {
  interfaces: { name: string; ip_addresses: string[] }[];
}

/// Create or edit a VRRP group across a switch pair. One form writes the
/// group to both switches — same VRID, VIPs, and timers, different
/// priorities (the higher-priority switch is the intended master).
export function VrrpGroupFormModal({
  orgGuid,
  switches,
  row,
  onClose,
  onSaved,
}: {
  orgGuid: string;
  /** Eligible switches (VRRP-capable, in the sub-org). */
  switches: Device[];
  /** null = create. */
  row: VrrpRow | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const options = useMemo(() => {
    const all = [...switches];
    for (const side of row?.sides ?? []) {
      if (!all.some((d) => d.device_id === side.device.device_id)) all.push(side.device);
    }
    return all.sort((x, y) => switchLabel(x).localeCompare(switchLabel(y)));
  }, [switches, row]);

  const sideA = row?.sides[0];
  const sideB = row?.sides[1];

  const [aId, setAId] = useState(sideA?.device.device_id ?? "");
  const [bId, setBId] = useState(sideB?.device.device_id ?? "");
  const [iface, setIface] = useState(row?.iface ?? "");
  const [vrid, setVrid] = useState(row != null ? String(row.vrid) : "1");
  const [vips, setVips] = useState(
    (sideA?.group.virtual_ips ?? []).join(", "),
  );
  const [prioA, setPrioA] = useState(String(sideA?.group.priority ?? 200));
  const [prioB, setPrioB] = useState(String(sideB?.group.priority ?? 100));
  const [preempt, setPreempt] = useState(sideA?.group.preempt ?? true);
  const [advInterval, setAdvInterval] = useState(
    sideA?.group.adv_interval_ms != null ? String(sideA.group.adv_interval_ms) : "",
  );
  const [version, setVersion] = useState<"default" | "2" | "3">(
    sideA?.group.version != null ? (String(sideA.group.version) as "2" | "3") : "default",
  );

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Interface suggestions: L3 interfaces (SVIs first) present on both
  // selected switches — a virtual router only works where both sides have
  // the underlying interface.
  const [ifaceOptions, setIfaceOptions] = useState<string[]>([]);
  useEffect(() => {
    if (!aId || !bId || aId === bId) {
      setIfaceOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled(
        [aId, bId].map((id) =>
          deviceApiFetch<L3IfacesResp>(orgGuid, id, "/routing/l3-interfaces"),
        ),
      );
      if (cancelled) return;
      const sets = results
        .filter((r): r is PromiseFulfilledResult<L3IfacesResp> => r.status === "fulfilled")
        .map((r) => new Set(r.value.interfaces.filter((i) => i.ip_addresses.length > 0).map((i) => i.name)));
      if (sets.length === 0) {
        setIfaceOptions([]);
        return;
      }
      const names = [...sets[0]].filter((n) => sets.every((s) => s.has(n)));
      names.sort((x, y) => {
        // SVIs are the usual VRRP home; float them to the top.
        const sx = x.startsWith("Vlan") ? 0 : 1;
        const sy = y.startsWith("Vlan") ? 0 : 1;
        return sx - sy || x.localeCompare(y);
      });
      setIfaceOptions(names);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgGuid, aId, bId]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (!aId || !bId) return setError("Select both switches of the pair.");
    if (aId === bId) return setError("Pick two different switches.");
    const ifaceName = iface.trim();
    if (!ifaceName) return setError("The group needs an interface (e.g. Vlan10).");
    const vridNum = Number(vrid);
    if (!Number.isInteger(vridNum) || vridNum < 1 || vridNum > 255) {
      return setError("VRID must be between 1 and 255.");
    }
    const vipList = vips
      .split(/[,\s]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (vipList.length === 0) return setError("Add at least one virtual IP.");
    for (const vip of vipList) {
      if (!CIDR_OR_IP_RE.test(vip)) return setError(`"${vip}" is not a valid virtual IP.`);
    }
    const pA = Number(prioA);
    const pB = Number(prioB);
    for (const [label, p] of [
      ["Switch A priority", pA],
      ["Switch B priority", pB],
    ] as const) {
      if (!Number.isInteger(p) || p < 1 || p > 254) {
        return setError(`${label} must be between 1 and 254.`);
      }
    }
    if (pA === pB) {
      return setError("Give the switches different priorities so one is the clear master.");
    }
    let advMs: number | null = null;
    if (advInterval.trim() !== "") {
      advMs = Number(advInterval);
      if (!Number.isInteger(advMs) || advMs < 10 || advMs > 40950) {
        return setError("Advertisement interval must be between 10 and 40950 ms.");
      }
    }

    const shared = {
      interface: ifaceName,
      vrid: vridNum,
      virtual_ips: vipList,
      preempt,
      adv_interval_ms: advMs,
      version: version === "default" ? null : (Number(version) as 2 | 3),
    };
    const labelOf = (id: string) => {
      const d = options.find((o) => o.device_id === id);
      return d ? switchLabel(d) : id;
    };

    setSaving(true);
    try {
      await updateVrrpGroup(orgGuid, aId, { ...shared, priority: pA });
    } catch (err) {
      setError(
        `${labelOf(aId)}: ${err instanceof Error ? err.message : "write failed"} — nothing was changed on ${labelOf(bId)}.`,
      );
      setSaving(false);
      return;
    }
    try {
      await updateVrrpGroup(orgGuid, bId, { ...shared, priority: pB });
    } catch (err) {
      setError(
        `Applied to ${labelOf(aId)}, but ${labelOf(bId)} failed: ${
          err instanceof Error ? err.message : "write failed"
        }. Fix the error and save again to converge the pair.`,
      );
      setSaving(false);
      return;
    }
    onSaved(`Saved VRRP group ${vridNum} on ${ifaceName} across ${labelOf(aId)} and ${labelOf(bId)}.`);
  };

  return (
    <ModalShell onClose={onClose} maxWidth={560}>
      <ModalHeader
        title={row ? "Edit VRRP Group" : "Create VRRP Group"}
        subtitle={
          row
            ? `${row.iface} · VRID ${row.vrid}`
            : "The group is written to both switches in one save"
        }
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Switch A</label>
            <select
              value={aId}
              onChange={(e) => setAId(e.target.value)}
              disabled={row != null}
              className={`${inputCls} cursor-pointer disabled:opacity-60`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="">Select a switch…</option>
              {options
                .filter((d) => d.device_id !== bId)
                .map((d) => (
                  <option key={d.device_id} value={d.device_id}>
                    {switchLabel(d)}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Switch B</label>
            <select
              value={bId}
              onChange={(e) => setBId(e.target.value)}
              disabled={row != null && row.sides.length > 1}
              className={`${inputCls} cursor-pointer disabled:opacity-60`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="">Select a switch…</option>
              {options
                .filter((d) => d.device_id !== aId)
                .map((d) => (
                  <option key={d.device_id} value={d.device_id}>
                    {switchLabel(d)}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Interface</label>
            <input
              value={iface}
              onChange={(e) => setIface(e.target.value)}
              disabled={row != null}
              placeholder="Vlan10"
              list="vrrp-iface-options"
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
            <datalist id="vrrp-iface-options">
              {ifaceOptions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">VRID</label>
            <input
              type="number"
              min={1}
              max={255}
              value={vrid}
              onChange={(e) => setVrid(e.target.value)}
              disabled={row != null}
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
            Virtual IPs (comma-separated)
          </label>
          <input
            value={vips}
            onChange={(e) => setVips(e.target.value)}
            placeholder="10.0.10.1"
            className={inputCls}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
          <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-2">
            The gateway address(es) clients use — inside the interface&apos;s subnet,
            not either switch&apos;s own address.
          </p>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Priority — Switch A
            </label>
            <input
              type="number"
              min={1}
              max={254}
              value={prioA}
              onChange={(e) => setPrioA(e.target.value)}
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Priority — Switch B
            </label>
            <input
              type="number"
              min={1}
              max={254}
              value={prioB}
              onChange={(e) => setPrioB(e.target.value)}
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>
        <p className="text-[12px] text-[var(--qz-fg-4)] m-0 -mt-2">
          The higher-priority switch is the intended master.
        </p>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Advertisement Interval (ms)
            </label>
            <input
              type="number"
              min={10}
              max={40950}
              value={advInterval}
              onChange={(e) => setAdvInterval(e.target.value)}
              placeholder="1000 (default)"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Version</label>
            <select
              value={version}
              onChange={(e) => setVersion(e.target.value as "default" | "2" | "3")}
              className={`${inputCls} cursor-pointer`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="default">Image default</option>
              <option value="2">VRRPv2</option>
              <option value="3">VRRPv3</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">Preempt</p>
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
              The higher-priority switch reclaims master when it comes back
            </p>
          </div>
          <Switch on={preempt} onChange={setPreempt} />
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
            {saving ? "Applying to both switches…" : row ? "Save group" : "Create group"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
