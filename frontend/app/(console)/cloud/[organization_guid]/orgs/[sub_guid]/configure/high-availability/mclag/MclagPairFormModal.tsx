"use client";

import { useEffect, useMemo, useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import type { Device } from "@/lib/api";
import { deviceApiFetch } from "@/lib/device/api";
import { switchLabel } from "@/lib/device/ha-fanout";
import { updateMclag } from "@/lib/device/sonic-mclag";
import type { MclagPairRow } from "./page";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const IPV4_RE = /^([0-9]{1,3}\.){3}[0-9]{1,3}$/;
const MAC_RE = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;

/// Create or edit an MCLAG pair. One form drives both switches: the domain
/// is written to switch A with (source A, peer B) and to switch B mirrored.
/// Port-channel suggestions come live from both switches — the peer link and
/// member port channels must exist under the same name on each.
export function MclagPairFormModal({
  orgGuid,
  switches,
  pair,
  onClose,
  onSaved,
}: {
  orgGuid: string;
  /** Eligible pair members (MCLAG-capable switches in the sub-org). */
  switches: Device[];
  /** null = create. */
  pair: MclagPairRow | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  // On edit, the pair's own devices stay selectable even if they dropped out
  // of the eligible list (e.g. one side is offline right now).
  const options = useMemo(() => {
    const all = [...switches];
    for (const side of [pair?.a, pair?.b]) {
      if (side && !all.some((d) => d.device_id === side.device.device_id)) {
        all.push(side.device);
      }
    }
    return all.sort((x, y) => switchLabel(x).localeCompare(switchLabel(y)));
  }, [switches, pair]);

  const [aId, setAId] = useState(pair?.a.device.device_id ?? "");
  const [bId, setBId] = useState(pair?.b?.device.device_id ?? "");
  const [domainId, setDomainId] = useState(pair != null ? String(pair.domainId) : "1");
  const [sourceA, setSourceA] = useState(pair?.a.domain.source_ip ?? "");
  const [sourceB, setSourceB] = useState(
    pair?.b?.domain.source_ip ?? pair?.a.domain.peer_ip ?? "",
  );
  const [peerLink, setPeerLink] = useState(pair?.a.domain.peer_link ?? "");
  const [keepalive, setKeepalive] = useState(
    pair?.a.domain.keepalive_interval_s != null ? String(pair.a.domain.keepalive_interval_s) : "",
  );
  const [sessionTimeout, setSessionTimeout] = useState(
    pair?.a.domain.session_timeout_s != null ? String(pair.a.domain.session_timeout_s) : "",
  );
  const [systemMac, setSystemMac] = useState(pair?.a.domain.system_mac ?? "");
  const [members, setMembers] = useState<Set<string>>(new Set(pair?.a.domain.members ?? []));

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Port channels present on BOTH selected switches — MCLAG expects the peer
  // link and member port channels to exist under the same name on each side.
  const [channelOptions, setChannelOptions] = useState<string[] | null>(null);
  useEffect(() => {
    if (!aId || !bId || aId === bId) {
      setChannelOptions(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled(
        [aId, bId].map((id) =>
          deviceApiFetch<{ port_channels: { name: string }[] }>(
            orgGuid,
            id,
            "/switching/port-channels",
          ),
        ),
      );
      if (cancelled) return;
      const sets = results.map((r) =>
        r.status === "fulfilled" ? new Set(r.value.port_channels.map((p) => p.name)) : null,
      );
      if (sets.every((s) => s === null)) {
        setChannelOptions(null); // both fetches failed — fall back to free text
        return;
      }
      const present = sets.filter((s): s is Set<string> => s !== null);
      const intersection = [...present[0]].filter((n) => present.every((s) => s.has(n)));
      setChannelOptions(intersection.sort());
    })();
    return () => {
      cancelled = true;
    };
  }, [orgGuid, aId, bId]);

  const memberChoices = useMemo(() => {
    const all = new Set<string>(channelOptions ?? []);
    for (const m of members) all.add(m); // keep configured members visible
    all.delete(peerLink.trim());
    return [...all].sort();
  }, [channelOptions, members, peerLink]);

  const toggleMember = (name: string) =>
    setMembers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (!aId || !bId) return setError("Select both switches of the pair.");
    if (aId === bId) return setError("Pick two different switches.");
    const domain = Number(domainId);
    if (!Number.isInteger(domain) || domain < 1 || domain > 4095) {
      return setError("Domain ID must be between 1 and 4095.");
    }
    const ipA = sourceA.trim();
    const ipB = sourceB.trim();
    if (!IPV4_RE.test(ipA) || !IPV4_RE.test(ipB)) {
      return setError("Both peer addresses must be IPv4 addresses reachable between the switches.");
    }
    if (ipA === ipB) return setError("The two switches need different peer addresses.");
    const link = peerLink.trim();
    if (!link) return setError("The pair needs a peer-link port channel (e.g. PortChannel0001).");
    if (members.has(link)) {
      return setError("The peer link can't also be an MCLAG member port channel.");
    }

    const parseSecs = (raw: string, label: string, min: number, max: number): number | null => {
      if (raw.trim() === "") return null;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < min || n > max) {
        throw new Error(`${label} must be a whole number between ${min} and ${max} seconds.`);
      }
      return n;
    };
    let keepaliveS: number | null, timeoutS: number | null;
    try {
      keepaliveS = parseSecs(keepalive, "Keepalive interval", 1, 60);
      timeoutS = parseSecs(sessionTimeout, "Session timeout", 3, 3600);
    } catch (err) {
      return setError((err as Error).message);
    }
    const mac = systemMac.trim();
    if (mac && !MAC_RE.test(mac)) {
      return setError("System MAC must look like 00:11:22:33:44:55.");
    }

    const shared = {
      domain_id: domain,
      peer_link: link,
      keepalive_interval_s: keepaliveS,
      session_timeout_s: timeoutS,
      system_mac: mac ? mac.toLowerCase() : null,
      members: [...members].sort(),
    };
    const labelOf = (id: string) => {
      const d = options.find((o) => o.device_id === id);
      return d ? switchLabel(d) : id;
    };

    setSaving(true);
    try {
      await updateMclag(orgGuid, aId, { ...shared, source_ip: ipA, peer_ip: ipB });
    } catch (err) {
      setError(
        `${labelOf(aId)}: ${err instanceof Error ? err.message : "write failed"} — nothing was changed on ${labelOf(bId)}.`,
      );
      setSaving(false);
      return;
    }
    try {
      await updateMclag(orgGuid, bId, { ...shared, source_ip: ipB, peer_ip: ipA });
    } catch (err) {
      setError(
        `Applied to ${labelOf(aId)}, but ${labelOf(bId)} failed: ${
          err instanceof Error ? err.message : "write failed"
        }. Fix the error and save again to converge the pair.`,
      );
      setSaving(false);
      return;
    }
    onSaved(`Saved MCLAG domain ${domain} on ${labelOf(aId)} and ${labelOf(bId)}.`);
  };

  return (
    <ModalShell onClose={onClose} maxWidth={560}>
      <ModalHeader
        title={pair ? "Edit MCLAG Pair" : "Create MCLAG Pair"}
        subtitle={
          pair
            ? `Domain ${pair.domainId}`
            : "The domain is written to both switches in one save"
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
              disabled={pair != null}
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
              disabled={pair != null && pair.b != null}
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
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Domain ID</label>
            <input
              type="number"
              min={1}
              max={4095}
              value={domainId}
              onChange={(e) => setDomainId(e.target.value)}
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Peer Link (port channel)
            </label>
            <input
              value={peerLink}
              onChange={(e) => setPeerLink(e.target.value)}
              placeholder="PortChannel0001"
              list="mclag-peer-link-options"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
            <datalist id="mclag-peer-link-options">
              {(channelOptions ?? []).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Peer Address — Switch A
            </label>
            <input
              value={sourceA}
              onChange={(e) => setSourceA(e.target.value)}
              placeholder="10.0.0.1"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Peer Address — Switch B
            </label>
            <input
              value={sourceB}
              onChange={(e) => setSourceB(e.target.value)}
              placeholder="10.0.0.2"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>
        <p className="text-[12px] text-[var(--qz-fg-4)] m-0 -mt-2">
          Keepalive addresses the switches reach each other on — typically SVIs
          over the peer link or the management network. Each switch sources from
          its own address and peers with the other's.
        </p>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Keepalive (s)
            </label>
            <input
              type="number"
              min={1}
              max={60}
              value={keepalive}
              onChange={(e) => setKeepalive(e.target.value)}
              placeholder="1 (default)"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Session Timeout (s)
            </label>
            <input
              type="number"
              min={3}
              max={3600}
              value={sessionTimeout}
              onChange={(e) => setSessionTimeout(e.target.value)}
              placeholder="15 (default)"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              System MAC
            </label>
            <input
              value={systemMac}
              onChange={(e) => setSystemMac(e.target.value)}
              placeholder="Optional"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
            MCLAG Member Port Channels
          </label>
          {memberChoices.length === 0 ? (
            <p className="text-[12.5px] text-[var(--qz-fg-4)] m-0">
              {aId && bId
                ? "No port channel exists on both switches yet — create matching port channels on each switch (Configure → Switching → Port Channels), then add them here."
                : "Select both switches to list the port channels they share."}
            </p>
          ) : (
            <div className="flex flex-col gap-[6px]">
              {memberChoices.map((name) => (
                <label
                  key={name}
                  className="flex items-center gap-2 text-[13px] text-[var(--qz-fg-2)] cursor-pointer"
                  style={{ fontFamily: "var(--qz-font-mono)" }}
                >
                  <input
                    type="checkbox"
                    checked={members.has(name)}
                    onChange={() => toggleMember(name)}
                    className="cursor-pointer"
                  />
                  {name}
                </label>
              ))}
            </div>
          )}
          <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-2">
            Downstream-facing port channels that behave as one logical link
            across the pair. The peer link is excluded automatically.
          </p>
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
            {saving ? "Applying to both switches…" : pair ? "Save pair" : "Create pair"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
