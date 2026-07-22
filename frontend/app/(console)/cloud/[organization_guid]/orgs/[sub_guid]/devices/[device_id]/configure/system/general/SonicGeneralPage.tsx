"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureReadOnlyNotice, FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import {
  SystemGeneralDoc,
  SyslogServer,
  fetchSystemGeneral,
  updateSystemGeneral,
} from "@/lib/device/sonic-system";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

interface SyslogDraft {
  address: string;
  port: string;
}

export function SonicGeneralPage() {
  const [doc, setDoc] = useState<SystemGeneralDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");

  // Form state, seeded from the loaded doc.
  const [hostname, setHostname] = useState("");
  const [timezone, setTimezone] = useState("");
  const [ntpServers, setNtpServers] = useState<string[]>([]);
  const [syslogServers, setSyslogServers] = useState<SyslogDraft[]>([]);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      const d = await fetchSystemGeneral();
      setDoc(d);
      setHostname(d.hostname);
      setTimezone(d.timezone);
      setNtpServers(d.ntp_servers);
      setSyslogServers(
        d.syslog_servers.map((s) => ({ address: s.address, port: s.port != null ? String(s.port) : "" })),
      );
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load system settings.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setFormError("");
    const name = hostname.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(name)) {
      return setFormError("Hostname must be 1-63 letters, digits, or dashes and start with a letter or digit.");
    }
    const ntp = ntpServers.map((s) => s.trim()).filter(Boolean);
    const syslog: SyslogServer[] = [];
    for (const [i, s] of syslogServers.entries()) {
      if (!s.address.trim()) continue;
      let port: number | null = null;
      if (s.port.trim()) {
        port = Number(s.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return setFormError(`Syslog server ${i + 1}: port must be between 1 and 65535.`);
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
      setToast("Saved system settings.");
      await load("refresh");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save system settings.");
    } finally {
      setSaving(false);
    }
  };

  const editable = doc?.capability.supported && !doc.capability.read_only;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          General
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Hostname, timezone, NTP time sources, and remote syslog collectors
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading system settings…</div>
        )}
        {status === "error" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[13px] text-[var(--qz-danger)]">
              <AlertTriangle size={15} />
              {errorMsg}
            </div>
            <div>
              <Button kind="secondary" icon={RotateCw} onClick={load}>Retry</Button>
            </div>
          </div>
        )}
        {status === "ready" && doc && !doc.capability.supported && (
          <FeatureUnavailable feature="System settings" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5 max-w-[640px]">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <div
              className="rounded-xl p-6 flex flex-col gap-4"
              style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
            >
              <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
                    Hostname <span style={{ color: "var(--qz-danger)" }}>*</span>
                  </label>
                  <input
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                    disabled={!editable}
                    className={`${inputCls} disabled:opacity-60`}
                    style={monoSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Timezone</label>
                  {doc.timezones.length ? (
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      disabled={!editable}
                      className={`${inputCls} disabled:opacity-60`}
                      style={inputSt}
                      onFocus={focusBorder}
                      onBlur={blurBorder}
                    >
                      {doc.timezones.map((tz) => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder="Etc/UTC"
                      disabled={!editable}
                      className={`${inputCls} disabled:opacity-60`}
                      style={monoSt}
                      onFocus={focusBorder}
                      onBlur={blurBorder}
                    />
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-[6px]">
                  <label className="text-[12px] text-[var(--qz-fg-3)]">NTP servers</label>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => setNtpServers((p) => [...p, ""])}
                      className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--qz-accent)] bg-transparent border-0 cursor-pointer p-0"
                    >
                      <Plus size={13} /> Add server
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {ntpServers.length === 0 && (
                    <p className="text-[12px] text-[var(--qz-fg-4)] m-0">No NTP servers configured.</p>
                  )}
                  {ntpServers.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={s}
                        onChange={(e) =>
                          setNtpServers((p) => p.map((v, j) => (j === i ? e.target.value : v)))
                        }
                        placeholder="pool.ntp.org"
                        disabled={!editable}
                        className={`${inputCls} disabled:opacity-60`}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                      {editable && (
                        <button
                          type="button"
                          onClick={() => setNtpServers((p) => p.filter((_, j) => j !== i))}
                          title="Remove server"
                          className="flex-shrink-0 p-2 rounded-md bg-transparent border-0 cursor-pointer text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)]"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-[6px]">
                  <label className="text-[12px] text-[var(--qz-fg-3)]">Syslog servers</label>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => setSyslogServers((p) => [...p, { address: "", port: "" }])}
                      className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--qz-accent)] bg-transparent border-0 cursor-pointer p-0"
                    >
                      <Plus size={13} /> Add server
                    </button>
                  )}
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
                        disabled={!editable}
                        className={`${inputCls} disabled:opacity-60`}
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
                        disabled={!editable}
                        className={`${inputCls} disabled:opacity-60`}
                        style={{ ...monoSt, width: 100, flexShrink: 0 }}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                      {editable && (
                        <button
                          type="button"
                          onClick={() => setSyslogServers((p) => p.filter((_, j) => j !== i))}
                          title="Remove server"
                          className="flex-shrink-0 p-2 rounded-md bg-transparent border-0 cursor-pointer text-[var(--qz-fg-4)] hover:text-[var(--qz-danger)]"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {formError && (
                <p className="text-[12px] m-0" style={{ color: "var(--qz-danger)" }}>
                  {formError}
                </p>
              )}

              {editable && (
                <div className="flex justify-end">
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
              )}
            </div>
          </div>
        )}
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
