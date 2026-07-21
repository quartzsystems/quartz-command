"use client";

/// Shared page shell for the Monitor section's detail views — a titled header
/// over a scrollable body, matching the QuartzFire status pages' framing so the
/// device-scope panels and the sub-org aggregates read the same.
export function MonitorPageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1
          className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0"
          style={{ letterSpacing: "-0.015em" }}
        >
          {title}
        </h1>
        {subtitle && <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">{subtitle}</p>}
      </div>
      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">{children}</div>
    </div>
  );
}
