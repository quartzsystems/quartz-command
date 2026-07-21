// Sub-organization fan-out transport for the Monitor section. One request to
// the console replays a read-only device-local API call against every adopted
// firewall in the sub-org and returns the per-device answers, so an aggregate
// view is built from a single round-trip instead of the browser fanning out.
// Mirrors lib/device/api.ts's contract (401 → cloud login) but is scoped to a
// sub-organization rather than a single device.

import { ApiError } from "./api";
import type { VyosResponse } from "./interfaces";

/// One firewall's slot in an aggregate. `data` is the parsed answer when the
/// device replied successfully; otherwise `error` explains why it dropped out
/// (offline, timed out, or an endpoint error), so the UI can show the gap.
export interface FanoutItem<T> {
  deviceId: string;
  hostname: string | null;
  connected: boolean;
  data: T | null;
  error?: string;
}

interface RawItem {
  device_id: string;
  hostname: string | null;
  connected: boolean;
  http_status?: number;
  body?: string;
  error?: string;
}

async function fanoutRaw(
  orgGuid: string,
  subGuid: string,
  payload: { method: string; path: string; content_type?: string; body?: string },
): Promise<RawItem[]> {
  let res: Response;
  try {
    res = await fetch(`/api/orgs/${orgGuid}/subs/${subGuid}/monitor/proxy-fanout`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError("Could not reach the server.", 0);
  }
  if (res.status === 401) {
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
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
  const parsed = (await res.json()) as { results?: RawItem[] };
  return parsed.results ?? [];
}

function tryJson<T>(text: string | undefined): T | null {
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/// Fan out a JSON GET (mirrors apiFetch): the same `path` you'd pass apiFetch,
/// e.g. "/ospf/summary". Each item's `data` is the parsed JSON body.
export async function fanoutApi<T>(
  orgGuid: string,
  subGuid: string,
  path: string,
): Promise<FanoutItem<T>[]> {
  const raw = await fanoutRaw(orgGuid, subGuid, { method: "GET", path: `/api${path}` });
  return raw.map((r) => {
    const httpErr = r.http_status != null && r.http_status >= 400;
    return {
      deviceId: r.device_id,
      hostname: r.hostname,
      connected: r.connected,
      data: r.error || httpErr ? null : tryJson<T>(r.body),
      error: r.error ?? (httpErr ? `HTTP ${r.http_status}` : undefined),
    };
  });
}

/// Fan out a VyOS op-mode `show` (mirrors vpn-status' runShow): each item's
/// `data` is the command's text output, or null when the device errored.
export async function fanoutShow(
  orgGuid: string,
  subGuid: string,
  showPath: string[],
): Promise<FanoutItem<string>[]> {
  const form = new URLSearchParams();
  form.set("data", JSON.stringify({ op: "show", path: showPath }));
  const raw = await fanoutRaw(orgGuid, subGuid, {
    method: "POST",
    path: "/api/show",
    content_type: "application/x-www-form-urlencoded",
    body: form.toString(),
  });
  return raw.map((r) => {
    if (r.error) {
      return { deviceId: r.device_id, hostname: r.hostname, connected: r.connected, data: null, error: r.error };
    }
    const resp = tryJson<VyosResponse<string | null>>(r.body);
    const ok = resp?.success ?? false;
    return {
      deviceId: r.device_id,
      hostname: r.hostname,
      connected: r.connected,
      data: ok ? (resp?.data ?? "") : null,
      error: ok ? undefined : (resp?.error || "command failed"),
    };
  });
}
