"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureReadOnlyNotice, FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import { InfoRow, MonoValue, SettingsCard } from "@/components/configure/SettingsCard";
import { useDeviceProduct } from "@/components/device/useDeviceProduct";
import { SystemManagementDoc, fetchSystemManagement } from "@/lib/device/sonic-system";
import { ManagementFormModal } from "./ManagementFormModal";

/// SONiC System > Management, in the canonical settings style: a read-only
/// card of the live management-interface state with an Edit-settings modal.
function SonicManagementPage() {
  const [doc, setDoc] = useState<SystemManagementDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchSystemManagement());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load management settings.");
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
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <SettingsCard
              title="Management Interface"
              onEdit={editable ? () => setModal(true) : undefined}
            >
              <InfoRow label="Interface"><MonoValue value={doc.interface_name} /></InfoRow>
              <InfoRow label="MAC Address"><MonoValue value={doc.mac_address} fallback="unknown" /></InfoRow>
              <InfoRow label="Link">
                <span
                  style={{ fontFamily: "var(--qz-font-mono)" }}
                  className={doc.oper_status === "up" ? "text-[var(--qz-success)]" : undefined}
                >
                  {doc.oper_status}
                </span>
              </InfoRow>
              <InfoRow label="Addressing">{doc.dhcp ? "DHCP" : "Static"}</InfoRow>
              {!doc.dhcp && (
                <>
                  <InfoRow label="Static Address"><MonoValue value={doc.ip_address} /></InfoRow>
                  <InfoRow label="Gateway"><MonoValue value={doc.gateway} /></InfoRow>
                </>
              )}
              <InfoRow label="Management VRF">{doc.mgmt_vrf_enabled ? "Enabled" : "Disabled"}</InfoRow>
            </SettingsCard>
          </div>
        )}
      </div>

      {modal && doc && (
        <ManagementFormModal
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

/// /system/management only exists in the QuartzSONiC nav; render nothing for
/// other products (QuartzFire manages addressing under Interfaces).
export default function ManagementPage() {
  const product = useDeviceProduct();
  if (product === null) return null;
  return product === "quartzsonic" ? <SonicManagementPage /> : null;
}
