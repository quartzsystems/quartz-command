"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureReadOnlyNotice, FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import { InfoRow, MonoList, MonoValue, SettingsCard } from "@/components/configure/SettingsCard";
import { useDeviceProduct } from "@/components/device/useDeviceProduct";
import { SystemSnmpDoc, fetchSystemSnmp } from "@/lib/device/sonic-system";
import { SnmpFormModal } from "./SnmpFormModal";

/// SONiC System > SNMP, in the canonical settings style: a read-only card of
/// the live agent state with an Edit-settings modal.
function SonicSnmpPage() {
  const [doc, setDoc] = useState<SystemSnmpDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchSystemSnmp());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load SNMP settings.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <SettingsCard
              title="SNMP Settings"
              onEdit={editable ? () => setModal(true) : undefined}
            >
              <InfoRow label="SNMP Agent">
                {doc.enabled ? (
                  <span className="badge badge-ok">Enabled</span>
                ) : (
                  <span className="badge badge-muted">Disabled</span>
                )}
              </InfoRow>
              <InfoRow label="Location"><MonoValue value={doc.location} /></InfoRow>
              <InfoRow label="Contact"><MonoValue value={doc.contact} /></InfoRow>
              <InfoRow label="v2c Communities">
                <MonoList
                  items={doc.communities.map(
                    (c) => `${c.name} (${c.access === "ro" ? "read-only" : "read-write"})`,
                  )}
                />
              </InfoRow>
            </SettingsCard>
          </div>
        )}
      </div>

      {modal && doc && (
        <SnmpFormModal
          live={doc}
          onClose={() => setModal(false)}
          onSaved={(msg) => {
            setModal(false);
            setToast(msg);
            load("refresh");
          }}
        />
      )}
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
