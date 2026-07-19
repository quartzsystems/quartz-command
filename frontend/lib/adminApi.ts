// Admin realm client — the /admin/login + /admin console. Separate cached-user
// key and login path so it never shares session state with the user realm; the
// backend enforces the split via a distinct cookie and JWT secret.

import { createAuthClient, type AuthUserInfo, ApiError } from "./authClient";

export { ApiError };
export type { AuthUserInfo };

const client = createAuthClient({
  authBase: "/api/admin/auth",
  userKey: "quartz-command-admin",
  loginPath: "/admin/login",
});

export const { login, logout, fetchMe, getCurrentUser, clearSession, apiFetch } = client;

/** Platform-wide counts for the dashboard tiles. */
export interface AdminOverview {
  organizations: number;
  users: number;
  admins: number;
}

/** An organization as the admin console sees it (all orgs, with headcount). */
export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  member_count: number;
  created_at: string;
}

/** One user's membership within an organization. */
export interface OrganizationMember {
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  joined_at: string;
}

export interface OrganizationDetail {
  organization: AdminOrganization;
  members: OrganizationMember[];
}

/** Roles the console can assign (mirrored by the backend's validation). */
export const ORG_ROLES = ["owner", "admin", "member"] as const;

export function fetchOverview(): Promise<AdminOverview> {
  return apiFetch<AdminOverview>("/admin/overview");
}

export function listOrganizations(): Promise<AdminOrganization[]> {
  return apiFetch<AdminOrganization[]>("/admin/orgs");
}

/** Create an organization. The slug is derived server-side from the name. */
export function createOrganization(name: string): Promise<AdminOrganization> {
  return apiFetch<AdminOrganization>("/admin/orgs", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function getOrganization(guid: string): Promise<OrganizationDetail> {
  return apiFetch<OrganizationDetail>(`/admin/orgs/${guid}`);
}

/** Rename an organization. The slug follows the new name automatically. */
export function updateOrganization(guid: string, name: string): Promise<AdminOrganization> {
  return apiFetch<AdminOrganization>(`/admin/orgs/${guid}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/** Delete an organization. Memberships go with it; user accounts remain. */
export function deleteOrganization(guid: string): Promise<void> {
  return apiFetch<void>(`/admin/orgs/${guid}`, { method: "DELETE" });
}

/**
 * Add a user to an organization. An unknown email creates the user (password
 * required); a known email just gains the membership.
 */
export function addMember(
  guid: string,
  body: { email: string; full_name?: string; password?: string; role: string },
): Promise<OrganizationMember> {
  return apiFetch<OrganizationMember>(`/admin/orgs/${guid}/members`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Edit a member: their role in this org and/or their user account (display
 * name, password reset, active flag). Only the supplied fields change; an
 * empty-string full_name clears the display name.
 */
export function updateMember(
  guid: string,
  userId: string,
  patch: { role?: string; full_name?: string; password?: string; is_active?: boolean },
): Promise<OrganizationMember> {
  return apiFetch<OrganizationMember>(`/admin/orgs/${guid}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function removeMember(guid: string, userId: string): Promise<void> {
  return apiFetch<void>(`/admin/orgs/${guid}/members/${userId}`, { method: "DELETE" });
}

/** An admin-realm account (Settings → Users). */
export interface AdminAccount {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  created_at: string;
}

export function listAdmins(): Promise<AdminAccount[]> {
  return apiFetch<AdminAccount[]>("/admin/admins");
}

export function createAdmin(body: {
  email: string;
  full_name?: string;
  password: string;
}): Promise<AdminAccount> {
  return apiFetch<AdminAccount>("/admin/admins", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Edit an admin account. Only the supplied fields change; an empty-string
 * full_name clears the display name. The server refuses to deactivate your
 * own account or the last active admin.
 */
export function updateAdmin(
  adminId: string,
  patch: { full_name?: string; password?: string; is_active?: boolean },
): Promise<AdminAccount> {
  return apiFetch<AdminAccount>(`/admin/admins/${adminId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Delete an admin account (refused for yourself and for the last active admin). */
export function deleteAdmin(adminId: string): Promise<void> {
  return apiFetch<void>(`/admin/admins/${adminId}`, { method: "DELETE" });
}
