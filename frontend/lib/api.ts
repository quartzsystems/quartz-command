// User realm client — the /login + /cloud console.

import { createAuthClient, type AuthUserInfo, ApiError } from "./authClient";

export { ApiError };
export type { AuthUserInfo };

const client = createAuthClient({
  authBase: "/api/auth",
  userKey: "quartz-command-user",
  loginPath: "/login",
});

export const { login, logout, fetchMe, getCurrentUser, clearSession, apiFetch } = client;

/** An organization as returned by /api/orgs, including the caller's role. */
export interface MemberOrganization {
  id: string;
  name: string;
  slug: string;
  role: string;
  created_at: string;
}

/** Organizations the signed-in user belongs to. */
export function listOrganizations(): Promise<MemberOrganization[]> {
  return apiFetch<MemberOrganization[]>("/orgs");
}

/** One organization by guid (403 if the user is not a member). */
export function getOrganization(guid: string): Promise<MemberOrganization> {
  return apiFetch<MemberOrganization>(`/orgs/${guid}`);
}

/** A sub-organization nested under a parent org (no per-caller role — access
 *  derives from membership in the parent). */
export interface SubOrganization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

/** Sub-organizations under an organization the user belongs to. */
export function listSubOrganizations(guid: string): Promise<SubOrganization[]> {
  return apiFetch<SubOrganization[]>(`/orgs/${guid}/subs`);
}

/** Create a sub-organization; the slug is derived server-side from the name. */
export function createSubOrganization(guid: string, name: string): Promise<SubOrganization> {
  return apiFetch<SubOrganization>(`/orgs/${guid}/subs`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** One sub-organization under the given parent (404 if not nested there). */
export function getSubOrganization(guid: string, subGuid: string): Promise<SubOrganization> {
  return apiFetch<SubOrganization>(`/orgs/${guid}/subs/${subGuid}`);
}

/** Delete a sub-organization (owner/admin of the parent). Its members lose
 *  access and its devices return to the parent's unallocated pool. */
export function deleteSubOrganization(guid: string, subGuid: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/orgs/${guid}/subs/${subGuid}`, { method: "DELETE" });
}

// ── Sub-organization members ────────────────────────────────────────────────

/** A user's membership in a sub-organization. */
export interface SubOrgMember {
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  joined_at: string;
}

/** Members of a sub-organization (any member of the parent). */
export function listSubOrgMembers(guid: string, subGuid: string): Promise<SubOrgMember[]> {
  return apiFetch<SubOrgMember[]>(`/orgs/${guid}/subs/${subGuid}/members`);
}

export interface AddSubOrgMemberInput {
  email: string;
  full_name?: string;
  /** Required when the email doesn't match an existing user (min 8 chars). */
  password?: string;
  role?: string;
}

/** Add a user to a sub-organization, creating the account if the email is new
 *  (owner/admin of the parent only). */
export function addSubOrgMember(
  guid: string,
  subGuid: string,
  input: AddSubOrgMemberInput,
): Promise<SubOrgMember> {
  return apiFetch<SubOrgMember>(`/orgs/${guid}/subs/${subGuid}/members`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Remove a user from a sub-organization (the account itself is kept). */
export function removeSubOrgMember(
  guid: string,
  subGuid: string,
  userId: string,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/orgs/${guid}/subs/${subGuid}/members/${userId}`, {
    method: "DELETE",
  });
}

// ── Device enrollment ───────────────────────────────────────────────────────

/** Enrollment-token metadata; the secret only ever appears in the create
 *  response's `token` field, exactly once. */
export interface EnrollmentToken {
  token_id: string;
  label: string | null;
  created_at: string;
  expires_at: string;
  max_uses: number | null;
  use_count: number;
  revoked_at: string | null;
  created_by_email: string | null;
  /** Sub-organization devices enrolled via this token are allocated to. */
  sub_org_id: string | null;
  sub_org_name: string | null;
}

/** Create response: metadata plus the full QC1|… token string (shown once,
 *  never retrievable again). */
export interface CreatedEnrollmentToken extends EnrollmentToken {
  token: string;
}

export interface CreateEnrollmentTokenInput {
  label?: string;
  /** Lifetime in hours (server default 24). */
  expires_hours?: number;
  /** Maximum enrollments; omit for unlimited. */
  max_uses?: number;
  /** Allocate enrolled devices to this sub-organization. */
  sub_org_id?: string;
}

/** Enrollment tokens of an organization (metadata only). */
export function listEnrollmentTokens(guid: string): Promise<EnrollmentToken[]> {
  return apiFetch<EnrollmentToken[]>(`/orgs/${guid}/enroll-tokens`);
}

/** Create an enrollment token (owner/admin only). */
export function createEnrollmentToken(
  guid: string,
  input: CreateEnrollmentTokenInput,
): Promise<CreatedEnrollmentToken> {
  return apiFetch<CreatedEnrollmentToken>(`/orgs/${guid}/enroll-tokens`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Revoke an enrollment token (owner/admin only). */
export function revokeEnrollmentToken(guid: string, tokenId: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/orgs/${guid}/enroll-tokens/${tokenId}/revoke`, {
    method: "POST",
  });
}

/** A QuartzFire device enrolled to (or revoked from) the organization. */
export interface Device {
  device_id: string;
  state: "pending" | "adopted" | "revoked";
  hostname: string | null;
  qf_version: string | null;
  cert_serial: string | null;
  cert_not_after: string | null;
  enrolled_at: string | null;
  enrolled_via_token: string | null;
  last_seen_at: string | null;
  last_seen_ip: string | null;
  /** Sub-organization the device is allocated to; null = unallocated. */
  sub_org_id: string | null;
  sub_org_name: string | null;
  /** Folder within the sub-organization the device is grouped into; null =
   *  ungrouped. Always belongs to sub_org_id. */
  folder_id: string | null;
  folder_name: string | null;
  /** Live connectivity: true while the device holds an active control stream to
   *  the gateway (the ground-truth online/offline signal). */
  connected: boolean;
}

/** Devices of an organization. */
export function listDevices(guid: string): Promise<Device[]> {
  return apiFetch<Device[]>(`/orgs/${guid}/devices`);
}

/** Revoke a device's access (owner/admin only) — it can no longer renew its
 *  certificate; re-enrolling it later with a fresh token is allowed. */
export function revokeDevice(guid: string, deviceId: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/orgs/${guid}/devices/${deviceId}/revoke`, {
    method: "POST",
  });
}

/** The latest security-service telemetry snapshot a firewall pushed over its
 *  control stream. Counters are cumulative (Prometheus-counter semantics —
 *  compute deltas, tolerate resets). One row per reporting device. */
export interface DeviceSecurityTelemetry {
  device_id: string;
  /** Sub-organization the device is allocated to; null = unallocated. */
  sub_org_id: string | null;
  /** Device wall-clock of the snapshot (epoch seconds). */
  time_unix: number;

  ips_enabled: boolean;
  ips_prevented: number;
  ips_detected: number;
  ips_scans: number;
  ips_scans_available: boolean;

  ac_enabled: boolean;
  ac_blocked: number;
  ac_detected: number;
  ac_total_requests: number;

  geo_enabled: boolean;
  geo_blocked: number;
  geo_connections: number;
  geo_countries_blocked: number;

  cf_enabled: boolean;
  cf_blocked: number;
  cf_allowed: number;
  cf_total_requests: number;

  /** When the controller received this snapshot (ISO 8601). */
  received_at: string;
}

/** Latest security telemetry for every reporting device in the organization. */
export function listSecurityTelemetry(guid: string): Promise<DeviceSecurityTelemetry[]> {
  return apiFetch<DeviceSecurityTelemetry[]>(`/orgs/${guid}/security-telemetry`);
}

/** One firewall policy/rule's cumulative traffic counters (Most Active
 *  Policies on the device Monitor overview). */
export interface PolicyStat {
  name: string;
  bytes: number;
  hits: number;
}

/** The latest device health & stats snapshot a firewall pushed over its control
 *  stream. Utilization gauges are instantaneous 0–100 percentages; the
 *  top-policy counters are cumulative. */
export interface DeviceStats {
  device_id: string;
  /** Device wall-clock of the snapshot (epoch seconds). */
  time_unix: number;
  cpu_pct: number;
  mem_pct: number;
  disk_pct: number;
  uptime_secs: number;
  /** Public/WAN IP as the device sees itself ("" when undetermined). */
  public_ip: string;
  /** Top firewall policies by traffic (already sorted desc, capped). */
  top_policies: PolicyStat[];
  received_at: string;
}

/** One point in a device's rolling utilization history, driving the sparklines. */
export interface DeviceStatsSample {
  cpu_pct: number;
  mem_pct: number;
  disk_pct: number;
  received_at: string;
}

/** The device Monitor overview payload: latest snapshot (null until the device
 *  first reports) plus its recent utilization samples, oldest first. */
export interface DeviceStatsResponse {
  latest: DeviceStats | null;
  samples: DeviceStatsSample[];
}

/** Health & stats for a single device (device Monitor overview). */
export function getDeviceStats(guid: string, deviceId: string): Promise<DeviceStatsResponse> {
  return apiFetch<DeviceStatsResponse>(`/orgs/${guid}/devices/${deviceId}/stats`);
}

/** Reboot a firewall (owner/admin). Travels through the device proxy to the
 *  device's local management API, which performs the reboot. Resolves once the
 *  device acknowledges the command; the control stream then drops as it
 *  restarts. */
export async function rebootDevice(guid: string, deviceId: string): Promise<void> {
  const res = await apiFetch<{ success?: boolean; error?: string } | null>(
    `/orgs/${guid}/devices/${deviceId}/proxy`,
    {
      method: "POST",
      body: JSON.stringify({ method: "POST", path: "/api/system/reboot" }),
    },
  );
  // The device wraps failures in a { success:false, error } body even on 200.
  if (res && res.success === false) {
    throw new ApiError(res.error ?? "Reboot failed.", 502);
  }
}

/** Allocate a device to a sub-organization, move it between sub-organizations,
 *  or deallocate it (null) back to the top-level pool. Owner/admin only. */
export function allocateDevice(
  guid: string,
  deviceId: string,
  subOrgId: string | null,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/orgs/${guid}/devices/${deviceId}/allocate`, {
    method: "POST",
    body: JSON.stringify({ sub_org_id: subOrgId }),
  });
}

// ── Folders ─────────────────────────────────────────────────────────────────

/** A folder grouping firewalls within a sub-organization (by location/branch). */
export interface DeviceFolder {
  id: string;
  sub_org_id: string;
  name: string;
  created_at: string;
}

/** Every folder across the organization's sub-organizations (one fetch backs
 *  the sidebar tree and the sub-org inventory view). */
export function listFolders(guid: string): Promise<DeviceFolder[]> {
  return apiFetch<DeviceFolder[]>(`/orgs/${guid}/folders`);
}

/** Create a folder in a sub-organization (owner/admin only). */
export function createFolder(
  guid: string,
  subGuid: string,
  name: string,
): Promise<DeviceFolder> {
  return apiFetch<DeviceFolder>(`/orgs/${guid}/subs/${subGuid}/folders`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** Rename a folder (owner/admin only). */
export function renameFolder(
  guid: string,
  subGuid: string,
  folderId: string,
  name: string,
): Promise<DeviceFolder> {
  return apiFetch<DeviceFolder>(`/orgs/${guid}/subs/${subGuid}/folders/${folderId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/** Delete a folder (owner/admin only). Its firewalls return to the sub-org's
 *  ungrouped pool. */
export function deleteFolder(
  guid: string,
  subGuid: string,
  folderId: string,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/orgs/${guid}/subs/${subGuid}/folders/${folderId}`, {
    method: "DELETE",
  });
}

/** Move an allocated device into a folder of its sub-organization, or (null)
 *  remove it from any folder. Owner/admin only. */
export function setDeviceFolder(
  guid: string,
  deviceId: string,
  folderId: string | null,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/orgs/${guid}/devices/${deviceId}/folder`, {
    method: "POST",
    body: JSON.stringify({ folder_id: folderId }),
  });
}
