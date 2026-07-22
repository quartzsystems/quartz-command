"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureReadOnlyNotice, FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import { useDeviceProduct } from "@/components/device/useDeviceProduct";
import {
  SnmpAccess,
  SystemSnmpDoc,
  fetchSystemSnmp,
  updateSystemSnmp,
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

interface CommunityDraft {
  name: string;
  access: SnmpAccess;
}

function SonicSnmpPage() {
  const [doc, setDoc] = useState<SystemSnmpDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");

  const [enabled, setEnabled] = useState(false);
  const [location, setLocation] = useState("");
  const [contact, setContact] = useState("");
  const [communities, setCommunities] = useState<CommunityDraft[]>([]);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      const d = await fetchSystemSnmp();
      setDoc(d);
      setEnabled(d.enabled);
      setLocation(d.location ?? "");
      setContact(d.contact ?? "");
      setCommunities(d.communities.map((c) => ({ ...c })));
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load SNMP settings.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setFormError("");
    const parsed: CommunityDraft[] = [];
    const seen = new Set<string>();
    for (const [i, c] of communities.entries()) {
      const name = c.name.trim();
      if (!name) continue;
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        return setFormError(`Community ${i + 1}: only letters, digits, dash, and underscore.`);
      }
      if (seen.has(name)) return setFormError(`Community "${name}" is listed twice.`);
      seen.add(name);
      parsed.push({ name, access: c.access });
    }
    if (enabled && parsed.length === 0) {
      return setFormError("Add at least one community, or disable SNMP.");
    }
    setSaving(true);
    try {
      await updateSystemSnmp({
        enabled,
        location: location.trim() || null,
        contact: contact.trim() || null,
        communities: parsed,
      });
      setToast("Saved SNMP settings.");
      await load("refresh");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save SNMP settings.");
    } finally {
      setSaving(false);
    }
  };

  const editable = doc?.capability.supported && !doc.capability.read_only;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          SNMP
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          SNMP agent, v2c communities, and system location / contact strings
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading SNMP settings…</div>
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
          <FeatureUnavailable feature="SNMP" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5 max-w-[640px]">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <div
              className="rounded-xl p-6 flex flex-col gap-4"
              style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">SNMP enabled</p>
                  <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
                    Run the SNMP agent and answer polls from monitoring systems
                  </p>
                </div>
                <Switch on={enabled} onChange={editable ? setEnabled : () => {}} />
              </div>

              <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Location</label>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Rack A4, HQ closet"
                    disabled={!editable}
                    className={`${inputCls} disabled:opacity-60`}
                    style={inputSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Contact</label>
                  <input
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="netops@example.com"
                    disabled={!editable}
                    className={`${inputCls} disabled:opacity-60`}
                    style={inputSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-[6px]">
                  <label className="text-[12px] text-[var(--qz-fg-3)]">v2c communities</label>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => setCommunities((p) => [...p, { name: "", access: "ro" }])}
                      className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--qz-accent)] bg-transparent border-0 cursor-pointer p-0"
                    >
                      <Plus size={13} /> Add community
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {communities.length === 0 && (
                    <p className="text-[12px] text-[var(--qz-fg-4)] m-0">No communities configured.</p>
                  )}
                  {communities.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={c.name}
                        onChange={(e) =>
                          setCommunities((p) =>
                            p.map((v, j) => (j === i ? { ...v, name: e.target.value } : v)),
                          )
                        }
                        placeholder="public"
                        disabled={!editable}
                        className={`${inputCls} disabled:opacity-60`}
                        style={monoSt}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      />
                      <select
                        value={c.access}
                        onChange={(e) =>
                          setCommunities((p) =>
                            p.map((v, j) =>
                              j === i ? { ...v, access: e.target.value as SnmpAccess } : v,
                            ),
                          )
                        }
                        disabled={!editable}
                        className={`${inputCls} disabled:opacity-60`}
                        style={{ ...inputSt, width: 140, flexShrink: 0 }}
                        onFocus={focusBorder}
                        onBlur={blurBorder}
                      >
                        <option value="ro">Read-only</option>
                        <option value="rw">Read-write</option>
                      </select>
                      {editable && (
                        <button
                          type="button"
                          onClick={() => setCommunities((p) => p.filter((_, j) => j !== i))}
                          title="Remove community"
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

/// /system/snmp only exists in the QuartzSONiC nav; render nothing for
/// other products.
export default function SnmpPage() {
  const product = useDeviceProduct();
  if (product === null) return null;
  return product === "quartzsonic" ? <SonicSnmpPage /> : null;
}
