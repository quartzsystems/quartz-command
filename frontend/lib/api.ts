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
