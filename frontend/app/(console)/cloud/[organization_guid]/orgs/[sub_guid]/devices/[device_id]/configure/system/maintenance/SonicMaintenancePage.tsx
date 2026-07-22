"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  FileDown,
  FileUp,
  HardDriveDownload,
  Power,
  RotateCw,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureReadOnlyNotice, FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import {
  SystemMaintenanceDoc,
  downloadConfigBackup,
  fetchSystemMaintenance,
  installImage,
  rebootSwitch,
  restoreConfigBackup,
  saveRunningConfig,
  setNextBootImage,
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

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-6 flex flex-col gap-4"
      style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
    >
      <div>
        <p className="text-[14px] font-semibold text-[var(--qz-fg-1)] m-0">{title}</p>
        <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

/// Confirm-to-reboot dialog: reboot interrupts forwarding, so it arms only
/// after the user types the word.
function RebootModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const [text, setText] = useState("");
  const armed = text.trim().toLowerCase() === "reboot";
  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title="Reboot switch"
        subtitle="All traffic through this switch stops until it finishes booting"
        onClose={onClose}
      />
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-[var(--qz-fg-2)] m-0">
          Unsaved CONFIG_DB changes are lost on reboot — save the configuration first. Type{" "}
          <span style={{ fontFamily: "var(--qz-font-mono)" }}>reboot</span> to confirm.
        </p>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="reboot"
          className={inputCls}
          style={monoSt}
          onFocus={focusBorder}
          onBlur={blurBorder}
        />
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-[9px] rounded-md text-[13px] font-medium cursor-pointer"
            style={{ background: "transparent", border: "1px solid var(--qz-border)", color: "var(--qz-fg-2)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!armed}
            onClick={onConfirm}
            className="px-4 py-[9px] rounded-md text-[13px] font-semibold cursor-pointer border-0 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--qz-danger)", color: "white" }}
          >
            Reboot now
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export function SonicMaintenancePage() {
  const [doc, setDoc] = useState<SystemMaintenanceDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");

  const [savingConfig, setSavingConfig] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [installing, setInstalling] = useState(false);
  const [settingNext, setSettingNext] = useState("");
  const [rebootModal, setRebootModal] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      setDoc(await fetchSystemMaintenance());
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load maintenance state.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await saveRunningConfig();
      setToast("Saved running configuration to startup.");
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to save configuration.");
    } finally {
      setSavingConfig(false);
    }
  };

  const backup = async () => {
    try {
      const blob = await downloadConfigBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "config_db.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to download backup.");
    }
  };

  const restore = async (file: File) => {
    setRestoring(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("That file isn't valid JSON.");
      }
      await restoreConfigBackup(parsed);
      setToast("Restored configuration — the switch is reloading services.");
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to restore backup.");
    } finally {
      setRestoring(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const install = async () => {
    const url = imageUrl.trim();
    if (!/^https?:\/\//.test(url)) {
      setToast("Image URL must start with http:// or https://.");
      return;
    }
    setInstalling(true);
    try {
      await installImage(url);
      setToast("Image installed. Set it as next boot and reboot to switch over.");
      setImageUrl("");
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to install image.");
    } finally {
      setInstalling(false);
    }
  };

  const setNext = async (image: string) => {
    setSettingNext(image);
    try {
      await setNextBootImage(image);
      setToast(`${image} will boot next.`);
      await load("refresh");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to set next boot image.");
    } finally {
      setSettingNext("");
    }
  };

  const reboot = async () => {
    setRebootModal(false);
    try {
      await rebootSwitch();
      setToast("Reboot requested — the switch will drop offline until it's back up.");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to reboot.");
    }
  };

  const editable = doc?.capability.supported && !doc.capability.read_only;

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Maintenance
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          SONiC images, configuration save / backup / restore, and reboot
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading maintenance state…</div>
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
          <FeatureUnavailable feature="Maintenance" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5 max-w-[720px]">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <Card
              title="Configuration"
              subtitle={
                doc.last_config_save
                  ? `Startup config last saved ${new Date(doc.last_config_save).toLocaleString()}`
                  : "Running configuration has never been saved to startup"
              }
            >
              <div className="flex flex-wrap gap-2">
                {editable && (
                  <Button size="sm" icon={Save} onClick={saveConfig} disabled={savingConfig}>
                    {savingConfig ? "Saving…" : "Save running config"}
                  </Button>
                )}
                <Button kind="secondary" size="sm" icon={FileDown} onClick={backup}>
                  Download backup
                </Button>
                {editable && (
                  <>
                    <Button
                      kind="secondary"
                      size="sm"
                      icon={FileUp}
                      onClick={() => fileInput.current?.click()}
                      disabled={restoring}
                    >
                      {restoring ? "Restoring…" : "Restore backup"}
                    </Button>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) restore(f);
                      }}
                    />
                  </>
                )}
              </div>
            </Card>

            <Card title="SONiC images" subtitle="Installed images and the next boot selection">
              <div className="flex flex-col">
                {doc.available_images.map((img) => {
                  const isCurrent = img === doc.current_image;
                  const isNext = img === doc.next_image;
                  return (
                    <div
                      key={img}
                      className="flex items-center gap-3 py-[10px]"
                      style={{ borderBottom: "1px solid var(--qz-border)" }}
                    >
                      <span
                        className="flex-1 min-w-0 text-[13px] text-[var(--qz-fg-1)] truncate"
                        style={{ fontFamily: "var(--qz-font-mono)" }}
                        title={img}
                      >
                        {img}
                      </span>
                      {isCurrent && <span className="badge badge-ok">Running</span>}
                      {isNext && <span className="badge badge-info">Next boot</span>}
                      {editable && !isNext && (
                        <Button
                          kind="secondary"
                          size="sm"
                          onClick={() => setNext(img)}
                          disabled={settingNext === img}
                        >
                          {settingNext === img ? "Setting…" : "Boot next"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>

              {editable && (
                <div className="flex items-center gap-2">
                  <input
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://…/sonic-broadcom.bin"
                    className={inputCls}
                    style={monoSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  />
                  <Button size="sm" icon={HardDriveDownload} onClick={install} disabled={installing}>
                    {installing ? "Installing…" : "Install from URL"}
                  </Button>
                </div>
              )}
            </Card>

            <Card
              title="Power"
              subtitle={
                doc.uptime_seconds != null
                  ? `Up ${formatUptime(doc.uptime_seconds)}`
                  : "Reboot the switch"
              }
            >
              <div>
                <Button
                  kind="secondary"
                  size="sm"
                  icon={Power}
                  onClick={() => setRebootModal(true)}
                >
                  Reboot…
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {rebootModal && <RebootModal onClose={() => setRebootModal(false)} onConfirm={reboot} />}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}
