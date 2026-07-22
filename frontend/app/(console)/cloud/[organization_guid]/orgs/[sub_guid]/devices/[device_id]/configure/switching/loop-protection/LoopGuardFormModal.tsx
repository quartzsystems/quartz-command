"use client";

import { useState } from "react";
import { ModalShell, ModalHeader } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { LoopProtectionPort, updateLoopProtectionPort } from "@/lib/device/stp";

/// Per-port loop protection: the STP BPDU Guard / Root Guard toggles, shared
/// with the Spanning Tree page's port editor.
export function LoopGuardFormModal({
  port,
  onClose,
  onSaved,
}: {
  port: LoopProtectionPort;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [bpduGuard, setBpduGuard] = useState(port.bpdu_guard);
  const [bpduGuardShutdown, setBpduGuardShutdown] = useState(port.bpdu_guard_do_disable);
  const [rootGuard, setRootGuard] = useState(port.root_guard);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await updateLoopProtectionPort(port.name, {
        bpdu_guard: bpduGuard,
        bpdu_guard_do_disable: bpduGuardShutdown,
        root_guard: rootGuard,
      });
      onSaved(`Saved loop protection for ${port.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save loop protection settings.");
    } finally {
      setSaving(false);
    }
  };

  const toggleRow = (
    label: string,
    hint: string,
    on: boolean,
    onChange: (v: boolean) => void,
    disabled = false,
  ) => (
    <div className="flex items-center justify-between" style={{ opacity: disabled ? 0.5 : 1 }}>
      <div>
        <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">{label}</p>
        <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">{hint}</p>
      </div>
      <Switch on={on} onChange={disabled ? () => {} : onChange} />
    </div>
  );

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader title="Edit Loop Protection" subtitle={port.name} onClose={onClose} />

      <form onSubmit={submit} className="flex flex-col gap-4">
        {toggleRow(
          "BPDU Guard",
          "Trip when a BPDU arrives on this host-facing port",
          bpduGuard,
          setBpduGuard,
        )}
        {toggleRow(
          "Shutdown on violation",
          "Admin-shut the port when BPDU Guard trips (recover from the table)",
          bpduGuardShutdown,
          setBpduGuardShutdown,
          !bpduGuard,
        )}
        {toggleRow(
          "Root Guard",
          "Block superior BPDUs that would move the STP root",
          rootGuard,
          setRootGuard,
        )}

        {!port.stp_enabled && (
          <p className="text-[12px] m-0 text-[var(--qz-fg-4)]">
            Spanning tree is disabled on this interface — guards take effect once STP is enabled.
          </p>
        )}

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
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
