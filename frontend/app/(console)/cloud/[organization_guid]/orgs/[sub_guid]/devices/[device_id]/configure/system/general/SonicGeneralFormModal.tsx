"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import {
  SystemGeneralDoc,
  SyslogServer,
  updateSystemGeneral,
} from "@/lib/device/sonic-system";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-[var(--qz-fg-4)] m-0 mt-[5px]">{hint}</p>}
    </div>
  );
}

interface SyslogDraft {
  address: string;
  port: string;
}

/// Edit hostname, timezone, NTP, and syslog collectors. The agent diffs the
/// full desired state against CONFIG_DB and applies immediately.
export function SonicGeneralFormModal({
  live,
  onClose,
  onSaved,
}: {
  live: SystemGeneralDoc;
  onClose: () => void;
  /** Called after a successful apply with a toast-able summary. */
  onSaved: (message: string) => void;
}) {
  const [hostname, setHostname] = useState(live.hostname);
  const [timezone, setTimezone] = useState(live.timezone);
  const [ntpText, setNtpText] = useState(live.ntp_servers.join("\n"));
  const [syslogServers, setSyslogServers] = useState<SyslogDraft[]>(
    live.syslog_servers.map((s) => ({ address: s.address, port: s.port != null ? String(s.port) : "" })),
  );

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const name = hostname.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(name)) {
      return setError("Hostname must be 1-63 letters, digits, or dashes and start with a letter or digit.");
    }
    const ntp = ntpText.split("\n").map((s) => s.trim()).filter(Boolean);
    const syslog: SyslogServer[] = [];
    for (const [i, s] of syslogServers.entries()) {
      if (!s.address.trim()) continue;
      let port: number | null = null;
      if (s.port.trim()) {
        port = Number(s.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return setError(`Syslog server ${i + 1}: port must be between 1 and 65535.`);
        }
      }
      syslog.push({ address: s.address.trim(), port });
    }

    setSaving(true);
    try {
      await updateSystemGeneral({
        hostname: name,
        timezone: timezone.trim(),
        ntp_servers: ntp,
        syslog_servers: syslog,
      });
      onSaved("Saved system settings.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save system settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={560}>
      <ModalHeader
        title="Edit System Settings"
        subtitle="Identity, time, and logging of the switch itself"
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Field label="Hostname">
            <input
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="switch-01"
              className={inputCls}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </Field>
          <Field label="Timezone">
            {live.timezones.length ? (
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className={inputCls}
                style={inputSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              >
                {live.timezones.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            ) : (
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Etc/UTC"
                className={inputCls}
                style={monoSt}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            )}
          </Field>
        </div>

        <Field label="NTP Servers" hint="One server per line. Clearing the list disables NTP.">
          <textarea
            value={ntpText}
            onChange={(e) => setNtpText(e.target.value)}
            placeholder={"pool.ntp.org"}
            rows={3}
            className={`${inputCls} resize-y`}
            style={monoSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </Field>

        <div>
          <div className="flex items-center justify-between mb-[6px]">
            <label className="text-[12px] text-[var(--qz-fg-3)]">Syslog Servers</label>
            <button
              type="button"
              onClick={() => setSyslogServers((p) => [...p, { address: "", port: "" }])}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--qz-accent)] bg-transparent border-0 cursor-pointer p-0"
            >
              <Plus size={13} /> Add server
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {syslogServers.length === 0 && (
              <p className="text-[12px] text-[var(--qz-fg-4)] m-0">No syslog servers configured.</p>
            )}
            {syslogServers.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={s.address}
                  onChange={(e) =>
                    setSyslogServers((p) =>
                      p.map((v, j) => (j === i ? { ...v, address: e.target.value } : v)),
                    )
                  }
                  placeholder="10.0.0.50"
                  className={inputCls}
                  style={monoSt}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />
                <input
                  value={s.port}
                  onChange={(e) =>
                    setSyslogServers((p) =>
                      p.map((v, j) => (j === i ? { ...v, port: e.target.value } : v)),
                    )
                  }
                  placeholder="514"
                  className={inputCls}
                  style={{ ...monoSt, width: 100, flexShrink: 0 }}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />
                <button
                  type="button"
                  onClick={() => setSyslogServers((p) => p.filter((_, j) => j !== i))}
                  title="Remove server"
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
