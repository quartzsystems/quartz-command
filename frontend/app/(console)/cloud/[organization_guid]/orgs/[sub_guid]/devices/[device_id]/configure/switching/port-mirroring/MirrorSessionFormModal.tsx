"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import {
  MirrorDirection,
  MirrorSession,
  updateMirrorSession,
} from "@/lib/device/sonic-mirror";
import { shortInterfaceName } from "@/lib/device/switching";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Checkbox-dropdown over the switch's interfaces for picking a session's
/// source set. Sources on the session but no longer present stay listed
/// (and checked) so saving doesn't silently drop them.
function PortMultiSelect({
  candidates,
  selected,
  onChange,
}: {
  candidates: string[];
  selected: string[];
  onChange: (names: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const known = new Set(candidates);
  const options = [...candidates, ...selected.filter((s) => !known.has(s))];

  const toggle = (name: string) =>
    onChange(
      selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name],
    );

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputCls} cursor-pointer flex items-center justify-between gap-2 text-left`}
        style={monoSt}
      >
        <span className={selected.length ? undefined : "text-[var(--qz-fg-4)]"}>
          {selected.length ? selected.map(shortInterfaceName).join(", ") : "Select ports…"}
        </span>
        <ChevronDown size={14} className="flex-shrink-0 text-[var(--qz-fg-4)]" />
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 mt-1 z-20 rounded-md py-1 max-h-[220px] overflow-y-auto"
          style={{
            background: "var(--qz-surface)",
            border: "1px solid var(--qz-border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          {options.map((name) => (
            <label
              key={name}
              className="flex items-center gap-2 px-3 py-[6px] text-[13px] text-[var(--qz-fg-2)] hover:bg-[color-mix(in_oklab,white_5%,transparent)] transition-colors cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={selected.includes(name)}
                onChange={() => toggle(name)}
                className="qz-check"
              />
              <span style={{ fontFamily: "var(--qz-font-mono)" }}>{name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/// Create or edit a mirror session: SPAN (copy to a local analyzer port) or
/// ERSPAN (GRE-encapsulate to a remote collector). Saves through the agent's
/// `PUT /api/switching/mirror-sessions/{name}`.
export function MirrorSessionFormModal({
  initial,
  existing,
  ports,
  portChannels,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  initial?: MirrorSession;
  /** All current sessions, for duplicate-name detection. */
  existing: MirrorSession[];
  /** Front-panel port names. */
  ports: string[];
  /** Port channel names (valid mirror sources). */
  portChannels: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<"span" | "erspan">(initial?.type ?? "span");
  const [direction, setDirection] = useState<MirrorDirection>(initial?.direction ?? "both");
  const [sources, setSources] = useState<string[]>(initial?.source_ports ?? []);
  const [dstPort, setDstPort] = useState(initial?.dst_port ?? "");
  const [srcIp, setSrcIp] = useState(initial?.erspan?.src_ip ?? "");
  const [dstIp, setDstIp] = useState(initial?.erspan?.dst_ip ?? "");
  const [greType, setGreType] = useState(initial?.erspan?.gre_type ?? "");
  const [dscp, setDscp] = useState(
    initial?.erspan?.dscp != null ? String(initial.erspan.dscp) : "",
  );
  const [ttl, setTtl] = useState(
    initial?.erspan?.ttl != null ? String(initial.erspan.ttl) : "",
  );
  const [queue, setQueue] = useState(
    initial?.erspan?.queue != null ? String(initial.erspan.queue) : "",
  );

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const numField = (
    label: string,
    raw: string,
    min: number,
    max: number,
  ): number | null | undefined => {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      setError(`${label} must be a whole number between ${min} and ${max}.`);
      return undefined;
    }
    return n;
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const trimmed = name.trim();
    if (!trimmed) return setError("Session name is required.");
    if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
      return setError("Session names may only use letters, digits, dot, dash, and underscore.");
    }
    if (!isEdit && existing.some((s) => s.name === trimmed)) {
      return setError(`Session ${trimmed} already exists.`);
    }
    if (sources.length === 0) return setError("Pick at least one source port.");

    let dst: string | null = null;
    let erspan = null;
    if (type === "span") {
      if (!dstPort) return setError("Pick the destination port.");
      if (sources.includes(dstPort)) {
        return setError("The destination port cannot also be a source.");
      }
      dst = dstPort;
    } else {
      if (!srcIp.trim() || !dstIp.trim()) {
        return setError("ERSPAN needs both a source and a destination IP.");
      }
      const d = numField("DSCP", dscp, 0, 63);
      if (d === undefined) return;
      const t = numField("TTL", ttl, 1, 255);
      if (t === undefined) return;
      const q = numField("Queue", queue, 0, 63);
      if (q === undefined) return;
      erspan = {
        src_ip: srcIp.trim(),
        dst_ip: dstIp.trim(),
        gre_type: greType.trim() || null,
        dscp: d,
        ttl: t,
        queue: q,
      };
    }

    setSaving(true);
    try {
      await updateMirrorSession(trimmed, {
        type,
        source_ports: sources,
        direction,
        dst_port: dst,
        erspan,
      });
      onSaved(`Saved mirror session ${trimmed}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save mirror session.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={isEdit ? "Edit Mirror Session" : "Create Mirror Session"}
        subtitle={isEdit ? initial!.name : "Copy port traffic to an analyzer"}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        {!isEdit && (
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Name <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="capture-uplink"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        )}

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "span" | "erspan")}
              className={`${inputCls} cursor-pointer`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="span">SPAN (local port)</option>
              <option value="erspan">ERSPAN (remote, GRE)</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Direction</label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as MirrorDirection)}
              className={`${inputCls} cursor-pointer`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="both">Both</option>
              <option value="rx">RX only</option>
              <option value="tx">TX only</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
            Source Ports <span style={{ color: "var(--qz-danger)" }}>*</span>
          </label>
          <PortMultiSelect
            candidates={[...ports, ...portChannels]}
            selected={sources}
            onChange={setSources}
          />
        </div>

        {type === "span" && (
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
              Destination Port <span style={{ color: "var(--qz-danger)" }}>*</span>
            </label>
            <select
              value={dstPort}
              onChange={(e) => setDstPort(e.target.value)}
              className={`${inputCls} cursor-pointer`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              {dstPort === "" && <option value="">Select…</option>}
              {ports
                .filter((p) => !sources.includes(p))
                .map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
            </select>
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[6px]">
              Mirrored copies egress this port — connect the capture host here.
            </p>
          </div>
        )}

        {type === "erspan" && (
          <>
            <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
                  Source IP <span style={{ color: "var(--qz-danger)" }}>*</span>
                </label>
                <input
                  value={srcIp}
                  onChange={(e) => setSrcIp(e.target.value)}
                  placeholder="10.0.0.1"
                  className={inputCls}
                  style={monoSt}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />
              </div>
              <div>
                <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
                  Destination IP <span style={{ color: "var(--qz-danger)" }}>*</span>
                </label>
                <input
                  value={dstIp}
                  onChange={(e) => setDstIp(e.target.value)}
                  placeholder="10.9.0.50"
                  className={inputCls}
                  style={monoSt}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />
              </div>
            </div>
            <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
              <div>
                <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">GRE Type</label>
                <input
                  value={greType}
                  onChange={(e) => setGreType(e.target.value)}
                  placeholder="0x88be"
                  className={inputCls}
                  style={monoSt}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />
              </div>
              <div>
                <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">DSCP</label>
                <input
                  type="number"
                  min={0}
                  max={63}
                  value={dscp}
                  onChange={(e) => setDscp(e.target.value)}
                  placeholder="Default"
                  className={inputCls}
                  style={monoSt}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />
              </div>
              <div>
                <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">TTL</label>
                <input
                  type="number"
                  min={1}
                  max={255}
                  value={ttl}
                  onChange={(e) => setTtl(e.target.value)}
                  placeholder="Default"
                  className={inputCls}
                  style={monoSt}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />
              </div>
              <div>
                <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Queue</label>
                <input
                  type="number"
                  min={0}
                  max={63}
                  value={queue}
                  onChange={(e) => setQueue(e.target.value)}
                  placeholder="Default"
                  className={inputCls}
                  style={monoSt}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />
              </div>
            </div>
          </>
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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create session"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
