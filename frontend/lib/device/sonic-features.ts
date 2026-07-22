// Capability envelope shared by every QuartzSONiC feature document. SONiC
// images differ widely in what they actually ship (community releases lack
// IGMP snooping and IS-IS entirely; STP only exists from 202505 when built
// with INCLUDE_STP; enterprise forks add more), so the agent probes the
// device — FEATURE table, running dockers, DEVICE_METADATA flags — and every
// feature GET reports whether the feature is usable before the UI offers to
// edit it. Keep in step with quartz-sonic src/mgmtapi.rs.

/** How a feature is available on the routed device's SONiC image. */
export interface FeatureCapability {
  /** False when the image has no daemon/backend for the feature — writes
   *  would sit inert in CONFIG_DB, so the UI must not offer them. */
  supported: boolean;
  /** True when state can be shown but the image accepts no configuration
   *  (e.g. LLDP timers on community SONiC). */
  read_only: boolean;
  /** Human-readable explanation when unsupported or read-only, e.g.
   *  "IGMP snooping requires Enterprise SONiC." */
  reason: string | null;
}

export const FULLY_SUPPORTED: FeatureCapability = {
  supported: true,
  read_only: false,
  reason: null,
};
