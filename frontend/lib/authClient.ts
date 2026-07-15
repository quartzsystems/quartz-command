// Shared session client for both realms. Auth is an httpOnly cookie set by the
// backend after it verifies credentials; the browser calls /api on its OWN
// origin (Next.js rewrites proxy to the Rust API), so the cookie is first-party
// and sent automatically. JS can't read the token; the only client-side session
// state is a non-sensitive cached user (for display). The server is the real
// enforcement — every protected /api route requires a valid session.

/// Error carrying the HTTP status so callers can tell an invalid session (401)
/// apart from a backend that is down/restarting (5xx / network failure = 0).
/// Only a 401 means "sign in again".
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface AuthUserInfo {
  id: string;
  email: string;
  full_name?: string | null;
}

/// One realm's client: user (`/api/auth`, `/login`) or admin
/// (`/api/admin/auth`, `/admin/login`). Each keeps its own cached-user key so
/// the two sessions never bleed into one another.
export interface AuthClient {
  login(email: string, password: string): Promise<AuthUserInfo>;
  logout(): Promise<void>;
  fetchMe(): Promise<AuthUserInfo>;
  getCurrentUser(): AuthUserInfo | null;
  clearSession(): void;
  apiFetch<T>(path: string, init?: RequestInit): Promise<T>;
}

interface RealmConfig {
  /** Base path for this realm's auth endpoints, e.g. "/api/auth". */
  authBase: string;
  /** localStorage key for the cached display user. */
  userKey: string;
  /** Where to send an unauthenticated visitor, e.g. "/login". */
  loginPath: string;
}

export function createAuthClient({ authBase, userKey, loginPath }: RealmConfig): AuthClient {
  const setUser = (user: AuthUserInfo): void => {
    if (typeof window === "undefined") return;
    localStorage.setItem(userKey, JSON.stringify(user));
  };

  const getCurrentUser = (): AuthUserInfo | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(userKey);
      return raw ? (JSON.parse(raw) as AuthUserInfo) : null;
    } catch {
      return null;
    }
  };

  const clearSession = (): void => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(userKey);
  };

  const redirectToLogin = (): void => {
    if (typeof window !== "undefined" && window.location.pathname !== loginPath) {
      window.location.href = loginPath;
    }
  };

  const login = async (email: string, password: string): Promise<AuthUserInfo> => {
    const res = await fetch(`${authBase}/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      let message = "Invalid email or password.";
      if (res.status !== 401) {
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {}
      }
      throw new Error(message);
    }
    // Session is set via httpOnly cookie; the body is the user (for display).
    const user = (await res.json()) as AuthUserInfo;
    setUser(user);
    return user;
  };

  const apiFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`/api${path}`, {
        ...init,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...init?.headers },
      });
    } catch {
      throw new ApiError("Could not reach the server.", 0);
    }

    if (res.status === 401) {
      clearSession();
      redirectToLogin();
      throw new ApiError("Session expired. Please sign in again.", 401);
    }

    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {}
      throw new ApiError(message, res.status);
    }

    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };

  /// Confirm the session with the backend (cookie is invisible to JS) and
  /// refresh the cached user. Rejects when there is no valid session.
  const fetchMe = async (): Promise<AuthUserInfo> => {
    const user = await apiFetch<AuthUserInfo>(`${authBase.replace(/^\/api/, "")}/me`);
    setUser(user);
    return user;
  };

  const logout = async (): Promise<void> => {
    try {
      await fetch(`${authBase}/logout`, { method: "POST", credentials: "include" });
    } catch {}
    clearSession();
  };

  return { login, logout, fetchMe, getCurrentUser, clearSession, apiFetch };
}
