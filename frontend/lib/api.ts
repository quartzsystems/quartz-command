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
