"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { SystemManagementDoc, updateSystemManagement } from "@/lib/device/sonic-system";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

/// Edit the out-of-band management addressing (DHCP vs. static). Applying a
/// new address can briefly drop the switch's cloud connection.
export function ManagementFormModal({
  live,
  onClose,
  onSaved,
}: {
  live: SystemManagementDoc;
  onClose: () => void;
  /** Called after a successful apply with a toast-able summary. */
  onSaved: (message: string) => void;
}) {
  const [dhcp, setDhcp] = useState(live.dhcp);
  const [ipAddress, setIpAddress] = useState(live.ip_address ?? "");
  const [gateway, setGateway] = useState(live.gateway ?? "");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (!dhcp) {
      if (!/^.+\/\d{1,3}$/.test(ipAddress.trim())) {
        return setError('Static address must be a CIDR, e.g. "10.0.10.5/24".');
      }
      if (!gateway.trim()) {
        return setError("Enter a default gateway for the static address.");
      }
    }
    setSaving(true);
    try {
      await updateSystemManagement({
        dhcp,
        ip_address: dhcp ? null : ipAddress.trim(),
        gateway: dhcp ? null : gateway.trim(),
      });
      onSaved("Saved management settings. The switch may briefly reconnect.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save management settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={520}>
      <ModalHeader
        title="Edit Management Settings"
        subtitle={`Addressing of the ${live.interface_name} management interface`}
        onClose={onClose}
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">DHCP</p>
            <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
              Get the management address automatically
            </p>
          </div>
          <Switch on={dhcp} onChange={setDhcp} />
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
                className={inputCls}
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
                className={inputCls}
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
