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
