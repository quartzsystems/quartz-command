"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  getServerSettings,
  updateServerSettings,
  type ServerSettings,
} from "@/lib/adminApi";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = {
  background: "var(--qz-input-bg)",
  border: "1px solid var(--qz-border)",
  fontFamily: "var(--qz-font-mono)",
} as const;

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:|$)/i;

/// Settings → Server: the instance-wide gateway address devices dial. Stored
/// server-side (it overrides QC_GATEWAY_ADDR) so a bad install-time default
/// can be corrected from the console.
export function ServerSettingsTab({
  onSaved,
}: {
  /** Toast hook for save confirmations. */
  onSaved: (message: string) => void;
}) {
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const s = await getServerSettings();
      setSettings(s);
      setValue(s.gateway_addr);
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load server settings.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const apply = async (next: string | null) => {
    setFormError("");
    setSaving(true);
    try {
      const s = await updateServerSettings(next);
      setSettings(s);
      setValue(s.gateway_addr);
      onSaved(
        next === null
          ? `Gateway address reset to the server default (${s.gateway_addr}).`
          : `Gateway address set to ${s.gateway_addr}.`,
      );
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not save the gateway address.");
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const addr = value.trim();
    if (!addr) {
      setFormError("Enter a host:port, e.g. command.example.com:8443.");
      return;
    }
    // Saving the default verbatim is a reset, not an override.
    apply(addr === settings?.gateway_addr_default ? null : addr);
  };

  if (status === "loading") {
    return <div className="text-[13px] text-[var(--qz-fg-4)]">Loading server settings…</div>;
  }
  if (status === "error" || !settings) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[13px] text-[var(--qz-danger)]">
          <AlertTriangle size={15} />
          {errorMsg}
        </div>
        <div>
          <Button kind="secondary" icon={RotateCw} onClick={load}>Retry</Button>
        </div>
      </div>
    );
  }

  const loopback = LOOPBACK.test(value.trim());

  return (
    <div
      className="rounded-lg p-5 max-w-[640px]"
      style={{ background: "var(--qz-bg-2)", border: "1px solid var(--qz-border)" }}
    >
      <h2 className="text-[15px] font-semibold text-[var(--qz-fg-1)] m-0">Device gateway address</h2>
      <p className="text-[12px] text-[var(--qz-fg-4)] mt-1 mb-4">
        The public <span style={{ fontFamily: "var(--qz-font-mono)" }}>host:port</span> devices
        dial for enrollment and their control channel. It is embedded in every enrollment token,
        so it must be reachable from the device network — new tokens pick a change up immediately,
        already-issued tokens keep the old address.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="command.example.com:8443"
            spellCheck={false}
            autoComplete="off"
            className={inputCls}
            style={inputSt}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--qz-accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--qz-border)")}
          />
          <Button kind="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>

        {loopback && (
          <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--qz-warn, #d9a545)" }}>
            <AlertTriangle size={14} />
            A loopback address only works for devices running on this host itself.
          </div>
        )}
        {formError && (
          <p className="text-[12px] m-0" style={{ color: "var(--qz-danger)" }}>{formError}</p>
        )}

        <div className="text-[12px] text-[var(--qz-fg-4)]">
          {settings.gateway_addr_override !== null ? (
            <>
              Overriding the server default{" "}
              <span style={{ fontFamily: "var(--qz-font-mono)" }}>{settings.gateway_addr_default}</span>
              {" — "}
              <button
                type="button"
                onClick={() => apply(null)}
                disabled={saving}
                className="p-0 border-0 bg-transparent cursor-pointer underline text-[12px] text-[var(--qz-fg-3)]"
              >
                reset to default
              </button>
            </>
          ) : (
            <>Currently the server default (QC_GATEWAY_ADDR in /etc/quartz-command/backend.env).</>
          )}
        </div>

        <p className="text-[11px] text-[var(--qz-fg-4)] m-0">
          The gateway&apos;s TLS certificate is issued for this host at backend startup — after
          changing it, restart the backend (systemctl restart quartz-command-backend) so the
          certificate matches.
        </p>
      </form>
    </div>
  );
}
