"use client";

import { Info } from "lucide-react";
import { FeatureCapability } from "@/lib/device/sonic-features";

/// Notice card shown when the routed switch's SONiC image doesn't support a
/// feature (capability.supported === false): explains why instead of
/// rendering an editor whose writes would sit inert on the device.
export function FeatureUnavailable({
  feature,
  capability,
}: {
  /** Display name, e.g. "IGMP snooping". */
  feature: string;
  capability: FeatureCapability;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg px-4 py-[14px] max-w-[640px]"
      style={{ background: "var(--qz-info-soft)", border: "1px solid var(--qz-border)" }}
    >
      <Info size={16} className="flex-shrink-0 mt-[1px] text-[var(--qz-info)]" />
      <div>
        <p className="text-[13px] font-semibold text-[var(--qz-fg-1)] m-0">
          {feature} is not available on this switch
        </p>
        <p className="text-[13px] text-[var(--qz-fg-3)] m-0 mt-[3px]">
          {capability.reason ??
            `The switch's SONiC image does not support ${feature.toLowerCase()}.`}
        </p>
      </div>
    </div>
  );
}

/// Slim banner variant for features that are visible but read-only on this
/// image (capability.read_only === true).
export function FeatureReadOnlyNotice({
  capability,
}: {
  capability: FeatureCapability;
}) {
  if (!capability.read_only || !capability.supported) return null;
  return (
    <div
      className="flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px] text-[var(--qz-fg-2)] max-w-[640px]"
      style={{ background: "var(--qz-info-soft)", border: "1px solid var(--qz-border)" }}
    >
      <Info size={14} className="flex-shrink-0 text-[var(--qz-info)]" />
      {capability.reason ?? "This switch's image only allows viewing this feature."}
    </div>
  );
}
