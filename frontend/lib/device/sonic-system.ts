// Data layer for system settings on QuartzSONiC switches — General
// (hostname / timezone / NTP / syslog), Management interface, local Users,
// SNMP, and Maintenance (images, config save/backup, reboot). Fetched live
// through the device proxy against the agent's management API (quartz-sonic
// src/mgmtapi.rs). The agent maps these onto CONFIG_DB tables
// (DEVICE_METADATA, NTP_SERVER, SYSLOG_SERVER, MGMT_INTERFACE,
// MGMT_VRF_CONFIG, SNMP / SNMP_COMMUNITY) and host commands (useradd,
// sonic-installer, config save). Keep these shapes in step with
// quartz-sonic — the agent is the source of truth for the contract.

import { apiFetch, proxyFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

// ── General ─────────────────────────────────────────────────────────────────

export interface SyslogServer {
  /** IP or hostname of the remote syslog collector. */
  address: string;
  /** UDP port; null = 514. */
  port: number | null;
}

export interface SystemGeneralDoc {
  capability: FeatureCapability;
  hostname: string;
  /** IANA timezone name, e.g. "America/New_York". */
  timezone: string;
  /** IANA names the image accepts, for the picker; empty = free-form. */
  timezones: string[];
  /** NTP server IPs/hostnames. */
  ntp_servers: string[];
  syslog_servers: SyslogServer[];
}

export async function fetchSystemGeneral(): Promise<SystemGeneralDoc> {
  return apiFetch<SystemGeneralDoc>("/system/general");
}

export interface SystemGeneralInput {
  hostname: string;
  timezone: string;
  ntp_servers: string[];
  syslog_servers: SyslogServer[];
}

/** Full desired state — the agent diffs each list against CONFIG_DB. */
export async function updateSystemGeneral(input: SystemGeneralInput): Promise<void> {
  await apiFetch("/system/general", { method: "PUT", body: JSON.stringify(input) });
}

// ── Management interface ────────────────────────────────────────────────────

export interface SystemManagementDoc {
  capability: FeatureCapability;
  /** Management port name, normally "eth0". */
  interface_name: string;
  /** True when eth0 has no MGMT_INTERFACE row (DHCP / zeroconf). */
  dhcp: boolean;
  /** Static CIDR, e.g. "10.0.10.5/24"; null when dhcp. */
  ip_address: string | null;
  /** Static default gateway; null when dhcp. */
  gateway: string | null;
  /** Mirror of the toggle on the VRFs page, shown read-only here. */
  mgmt_vrf_enabled: boolean;
  /** Current MAC / oper state for display. */
  mac_address: string | null;
  oper_status: "up" | "down" | "unknown";
}

export async function fetchSystemManagement(): Promise<SystemManagementDoc> {
  return apiFetch<SystemManagementDoc>("/system/management");
}

export interface SystemManagementInput {
  dhcp: boolean;
  /** Required when dhcp is false. */
  ip_address: string | null;
  gateway: string | null;
}

/** Reconfiguring the management IP can drop this very session — the agent
 *  applies it and the cloud tunnel reconnects from the new address. */
export async function updateSystemManagement(input: SystemManagementInput): Promise<void> {
  await apiFetch("/system/management", { method: "PUT", body: JSON.stringify(input) });
}

// ── Local users ─────────────────────────────────────────────────────────────

export type SonicUserRole = "admin" | "operator";

export interface SonicUser {
  name: string;
  role: SonicUserRole;
  /** Built-in accounts (e.g. "admin") can't be deleted. */
  builtin: boolean;
}

export interface SystemUsersDoc {
  capability: FeatureCapability;
  users: SonicUser[];
}

export async function fetchSystemUsers(): Promise<SystemUsersDoc> {
  return apiFetch<SystemUsersDoc>("/system/users");
}

export async function createSystemUser(
  name: string,
  role: SonicUserRole,
  password: string,
): Promise<void> {
  await apiFetch("/system/users", {
    method: "POST",
    body: JSON.stringify({ name, role, password }),
  });
}

/** password null = leave unchanged. */
export async function updateSystemUser(
  name: string,
  role: SonicUserRole,
  password: string | null,
): Promise<void> {
  await apiFetch(`/system/users/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify({ role, password }),
  });
}

export async function deleteSystemUser(name: string): Promise<void> {
  await apiFetch(`/system/users/${encodeURIComponent(name)}`, { method: "DELETE" });
}

// ── SNMP ────────────────────────────────────────────────────────────────────

export type SnmpAccess = "ro" | "rw";

export interface SnmpCommunity {
  name: string;
  access: SnmpAccess;
}

export interface SystemSnmpDoc {
  capability: FeatureCapability;
  enabled: boolean;
  location: string | null;
  contact: string | null;
  communities: SnmpCommunity[];
}

export async function fetchSystemSnmp(): Promise<SystemSnmpDoc> {
  return apiFetch<SystemSnmpDoc>("/system/snmp");
}

export interface SystemSnmpInput {
  enabled: boolean;
  location: string | null;
  contact: string | null;
  /** Full desired set — the agent diffs against SNMP_COMMUNITY. */
  communities: SnmpCommunity[];
}

export async function updateSystemSnmp(input: SystemSnmpInput): Promise<void> {
  await apiFetch("/system/snmp", { method: "PUT", body: JSON.stringify(input) });
}

// ── Maintenance ─────────────────────────────────────────────────────────────

export interface SystemMaintenanceDoc {
  capability: FeatureCapability;
  /** SONiC image currently booted, e.g. "SONiC-OS-202411-...". */
  current_image: string;
  /** Image sonic-installer will boot next. */
  next_image: string;
  /** All installed images. */
  available_images: string[];
  /** RFC3339 mtime of /etc/sonic/config_db.json; null if never saved. */
  last_config_save: string | null;
  uptime_seconds: number | null;
}

export async function fetchSystemMaintenance(): Promise<SystemMaintenanceDoc> {
  return apiFetch<SystemMaintenanceDoc>("/system/maintenance");
}

/** `config save -y` — persist CONFIG_DB to /etc/sonic/config_db.json. */
export async function saveRunningConfig(): Promise<void> {
  await apiFetch("/system/maintenance/save-config", { method: "POST" });
}

/** `sonic-installer set-next-boot <image>`. */
export async function setNextBootImage(image: string): Promise<void> {
  await apiFetch("/system/maintenance/set-next-image", {
    method: "POST",
    body: JSON.stringify({ image }),
  });
}

/** `sonic-installer install <url>` — the switch downloads the image itself.
 *  Long-running; the agent streams progress into the response. */
export async function installImage(url: string): Promise<void> {
  await apiFetch("/system/maintenance/install-image", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export async function rebootSwitch(): Promise<void> {
  await apiFetch("/system/maintenance/reboot", { method: "POST" });
}

/** Download the saved startup config (config_db.json) as a blob for a
 *  client-side download link. */
export async function downloadConfigBackup(): Promise<Blob> {
  const res = await proxyFetch("/system/maintenance/backup");
  if (!res.ok) throw new Error(`Backup failed (${res.status}).`);
  return res.blob();
}

/** Restore a config_db.json (parsed client-side so bad JSON never reaches
 *  the switch) via `config reload`. Disruptive: services restart. */
export async function restoreConfigBackup(configDb: unknown): Promise<void> {
  await apiFetch("/system/maintenance/restore", {
    method: "POST",
    body: JSON.stringify({ config: configDb }),
  });
}
