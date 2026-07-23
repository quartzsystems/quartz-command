// Cloud replacement for the QuartzFire web UI's lib/api.ts. The ported data
// layer (lib/device/*) imports the same names it always did — API, ApiError,
// apiFetch, vyosApi — but every call travels through Quartz Command's
// per-device proxy endpoint and down the device's control stream, instead of
// the device's own origin. The device replays the request against its local
// management API and the response comes back verbatim, so the data layer
// can't tell the difference.
//
// The active device comes from module scope, set by the device Configure
// layout during render (one device page is ever mounted at a time).

export const API = "/api"; // compatibility export (download-URL constants)

/// Error carrying the HTTP status, mirroring the web UI's ApiError contract:
/// only a 401 means "sign in again" (to the cloud console, here).
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let scope: { orgGuid: string; deviceId: string } | null = null;

/// Point the transport at a device. Called by the device Configure layout on
/// every render, so it is always current before any page effect fetches.
export function setDeviceScope(orgGuid: string, deviceId: string): void {
  scope = { orgGuid, deviceId };
}

/// Send one proxied call. The console session cookie authenticates us to the
/// cloud; the device authenticates the replayed call locally itself.
async function proxyRawTo(
  target: { orgGuid: string; deviceId: string },
  method: string,
  path: string,
  contentType?: string,
  body?: string,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`/api/orgs/${target.orgGuid}/devices/${target.deviceId}/proxy`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, path, content_type: contentType, body }),
    });
  } catch {
    throw new ApiError("Could not reach the server.", 0);
  }
  if (res.status === 401) {
    // The cloud session expired (the device never 401s the agent).
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new ApiError("Session expired. Please sign in again.", 401);
  }
  return res;
}

async function proxyRaw(
  method: string,
  path: string,
  contentType?: string,
  body?: string,
): Promise<Response> {
  if (!scope) throw new ApiError("No device selected.", 0);
  return proxyRawTo(scope, method, path, contentType, body);
}

/// fetch()-shaped helper for the few call sites that need the raw Response
/// (the guard's apply call inspects status codes itself).
export async function proxyFetch(path: string, init?: RequestInit): Promise<Response> {
  const body = typeof init?.body === "string" ? init.body : undefined;
  return proxyRaw(
    init?.method ?? "GET",
    `${API}${path}`,
    body != null ? "application/json" : undefined,
    body,
  );
}

/// Authenticated JSON fetch against the device's backend — same contract as
/// the web UI's apiFetch.
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await proxyFetch(path, init);
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
}

/// apiFetch against an explicitly named device, ignoring the module-scoped
/// one. Used by pages that talk to several devices at once — the sub-org
/// High Availability section configures both switches of an MCLAG/VRRP pair
/// from a single page, where no single device scope exists.
export async function deviceApiFetch<T>(
  orgGuid: string,
  deviceId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const body = typeof init?.body === "string" ? init.body : undefined;
  const res = await proxyRawTo(
    { orgGuid, deviceId },
    init?.method ?? "GET",
    `${API}${path}`,
    body != null ? "application/json" : undefined,
    body,
  );
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const parsed = await res.json();
      if (parsed?.error) message = parsed.error;
    } catch {}
    throw new ApiError(message, res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/// Call a VyOS HTTP API endpoint through the device's authenticated proxy —
/// same contract as the web UI's vyosApi (the device injects the API key).
export async function vyosApi<T = unknown>(endpoint: string, data: unknown): Promise<T> {
  const body = new URLSearchParams();
  body.set("data", JSON.stringify(data));
  const res = await proxyRaw(
    "POST",
    `${API}/${endpoint.replace(/^\//, "")}`,
    "application/x-www-form-urlencoded",
    body.toString(),
  );
  if (!res.ok) {
    // VyOS reports op failures as 400 with a JSON {success, error} body —
    // hand that to the caller so it can surface the real error message.
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error(`${res.status} ${res.statusText}`);
    }
  }
  return res.json() as Promise<T>;
}
