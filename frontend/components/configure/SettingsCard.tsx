"use client";

import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";

/// The canonical read-only settings card (QuartzFire style): a titled section
/// of label/value rows with an "Edit settings" button that opens the page's
/// form modal. Extracted from the VyOS System > General page so the SONiC
/// settings pages render identically.
export function SettingsCard({
  title,
  onEdit,
  editLabel = "Edit settings",
  children,
}: {
  title: string;
  /** Omit to render the card without an edit affordance (read-only feature). */
  onEdit?: () => void;
  editLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-lg px-5 pt-2 pb-3"
      style={{ background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" }}
    >
      <div className="flex items-center justify-between py-2">
        <h2 className="text-[15px] font-semibold text-[var(--qz-fg-1)] m-0">{title}</h2>
        {onEdit && (
          <Button kind="secondary" size="sm" icon={Pencil} onClick={onEdit}>
            {editLabel}
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

/// One label/value line of the settings card.
export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-[9px]" style={{ borderBottom: "1px solid var(--qz-border)" }}>
      <span className="text-[12px] text-[var(--qz-fg-4)] w-[200px] flex-shrink-0 pt-[1px]">{label}</span>
      <span className="text-[13px] text-[var(--qz-fg-1)] min-w-0">{children}</span>
    </div>
  );
}

export function MonoList({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-[var(--qz-fg-4)]">—</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1" style={{ fontFamily: "var(--qz-font-mono)" }}>
      {items.map((v) => (
        <span key={v}>{v}</span>
      ))}
    </span>
  );
}

export function MonoValue({ value, fallback = "—" }: { value: string | null; fallback?: string }) {
  if (value === null || value === "") return <span className="text-[var(--qz-fg-4)]">{fallback}</span>;
  return <span style={{ fontFamily: "var(--qz-font-mono)" }}>{value}</span>;
}
