"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureReadOnlyNotice, FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import { useDeviceProduct } from "@/components/device/useDeviceProduct";
import {
  SystemManagementDoc,
  fetchSystemManagement,
  updateSystemManagement,
} from "@/lib/device/sonic-system";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

function SonicManagementPage() {
  const [doc, setDoc] = useState<SystemManagementDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");

  const [dhcp, setDhcp] = useState(true);
  const [ipAddress, setIpAddress] = useState("");
  const [gateway, setGateway] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      const d = await fetchSystemManagement();
      setDoc(d);
      setDhcp(d.dhcp);
      setIpAddress(d.ip_address ?? "");
      setGateway(d.gateway ?? "");
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load management settings.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setFormError("");
    if (!dhcp) {
      if (!/^.+\/\d{1,3}$/.test(ipAddress.trim())) {
        return setFormError('Static address must be a CIDR, e.g. "10.0.10.5/24".');
      }
      if (!gateway.trim()) {
        return setFormError("Enter a default gateway for the static address.");
      }
    }
    setSaving(true);
    try {
      await updateSystemManagement({
        dhcp,
        ip_address: dhcp ? null : ipAddress.trim(),
        gateway: dhcp ? null : gateway.trim(),
      });
      setToast("Saved management settings. The switch may briefly reconnect.");
      await load("refresh");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save management settings.");
    } finally {
      setSaving(false);
    }
  };

  const editable = doc?.capability.supported && !doc.capability.read_only;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Management
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Out-of-band management interface addressing
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading management settings…</div>
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
          <FeatureUnavailable feature="Management interface" capability={doc.capability} />
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
                  <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">
                    {doc.interface_name}
                  </p>
                  <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]" style={{ fontFamily: "var(--qz-font-mono)" }}>
                    {doc.mac_address ?? "unknown MAC"} ·{" "}
                    <span className={doc.oper_status === "up" ? "text-[var(--qz-success)]" : ""}>
                      {doc.oper_status}
                    </span>
                    {doc.mgmt_vrf_enabled ? " · mgmt VRF" : ""}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">DHCP</p>
                  <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
                    Get the management address automatically
                  </p>
                </div>
                <Switch on={dhcp} onChange={editable ? setDhcp : () => {}} />
              </div>

              {!dhcp && (
                <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
                      Static address <span style={{ color: "var(--qz-danger)" }}>*</span>
                    </label>
                    <input
                      value={ipAddress}
                      onChange={(e) => setIpAddress(e.target.value)}
                      placeholder="10.0.10.5/24"
                      disabled={!editable}
                      className={`${inputCls} disabled:opacity-60`}
                      style={monoSt}
                      onFocus={focusBorder}
                      onBlur={blurBorder}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
                      Gateway <span style={{ color: "var(--qz-danger)" }}>*</span>
                    </label>
                    <input
                      value={gateway}
                      onChange={(e) => setGateway(e.target.value)}
                      placeholder="10.0.10.1"
                      disabled={!editable}
                      className={`${inputCls} disabled:opacity-60`}
                      style={monoSt}
                      onFocus={focusBorder}
                      onBlur={blurBorder}
                    />
                  </div>
                </div>
              )}

              <p className="text-[12px] text-[var(--qz-fg-4)] m-0">
                Changing the management address can briefly drop the switch&apos;s cloud connection
                while it reconnects from the new address.
              </p>

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

/// /system/management only exists in the QuartzSONiC nav; render nothing for
/// other products (QuartzFire manages addressing under Interfaces).
export default function ManagementPage() {
  const product = useDeviceProduct();
  if (product === null) return null;
  return product === "quartzsonic" ? <SonicManagementPage /> : null;
}
