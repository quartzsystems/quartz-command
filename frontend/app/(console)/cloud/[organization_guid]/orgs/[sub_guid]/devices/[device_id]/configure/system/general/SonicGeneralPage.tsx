"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureReadOnlyNotice, FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import { InfoRow, MonoList, MonoValue, SettingsCard } from "@/components/configure/SettingsCard";
import { SystemGeneralDoc, fetchSystemGeneral } from "@/lib/device/sonic-system";
import { SonicGeneralFormModal } from "./SonicGeneralFormModal";

/// SONiC System > General, in the canonical settings style: a read-only card
/// of the live values with an Edit-settings modal (mirrors the VyOS variant
/// of this page).
export function SonicGeneralPage() {
  const [doc, setDoc] = useState<SystemGeneralDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchSystemGeneral());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load system settings.");
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
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <SettingsCard
              title="System Settings"
              onEdit={editable ? () => setModal(true) : undefined}
            >
              <InfoRow label="Hostname"><MonoValue value={doc.hostname} /></InfoRow>
              <InfoRow label="Time Zone"><MonoValue value={doc.timezone} fallback="Etc/UTC (default)" /></InfoRow>
              <InfoRow label="NTP Servers"><MonoList items={doc.ntp_servers} /></InfoRow>
              <InfoRow label="Syslog Servers">
                <MonoList
                  items={doc.syslog_servers.map((s) =>
                    s.port != null ? `${s.address}:${s.port}` : s.address,
                  )}
                />
              </InfoRow>
            </SettingsCard>
          </div>
        )}
      </div>

      {modal && doc && (
        <SonicGeneralFormModal
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
