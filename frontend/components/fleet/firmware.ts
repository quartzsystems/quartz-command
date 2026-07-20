"use client";

import { useCallback, useEffect, useState } from "react";
import type { Device } from "@/lib/api";

// The latest QuartzFire release, read straight from GitHub. The repo is public
// and api.github.com serves CORS for public repos, so the browser can fetch it
// directly. Cached module-side with a short TTL so navigating between the
// Dashboard and Monitor views doesn't refetch on every mount.
const GITHUB_LATEST =
  "https://api.github.com/repos/quartzsystems/quartz-fire/releases/latest";
const FIRMWARE_TTL_MS = 10 * 60 * 1000;
let firmwareCache: { version: string | null; at: number } | null = null;

async function fetchLatestFirmware(): Promise<string | null> {
  try {
    const res = await fetch(GITHUB_LATEST, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: unknown };
    return typeof data.tag_name === "string" ? data.tag_name : null;
  } catch {
    return null;
  }
}

export type Version = [number, number, number];

/// Parse the leading `X.Y[.Z]` out of a version string ("v0.4.2", "0.4.1",
/// "QuartzFire 0.4.1" all work); null when there's no version-looking token.
export function parseVersion(s: string | null | undefined): Version | null {
  if (!s) return null;
  const m = s.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

export function versionLt(a: Version, b: Version): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/// A device is upgradeable when its reported version parses and is behind the
/// latest release. Unknown/unparseable versions are never counted.
export function isUpgradeable(device: Device, latest: Version | null): boolean {
  if (!latest) return false;
  const v = parseVersion(device.qf_version);
  return v != null && versionLt(v, latest);
}

/// How many of the given (already-scoped) devices are behind the latest release.
export function upgradeableCount(devices: Device[], latest: Version | null): number {
  return devices.filter((d) => isUpgradeable(d, latest)).length;
}

/// The latest release tag plus its parsed form, and a `reload` for the refresh
/// controls. Fetches once (respecting the module cache) on mount.
export function useLatestFirmware(): {
  latest: string | null;
  latestVer: Version | null;
  reload: (force?: boolean) => void;
} {
  const [latest, setLatest] = useState<string | null>(firmwareCache?.version ?? null);

  const reload = useCallback(async (force = false) => {
    if (!force && firmwareCache && Date.now() - firmwareCache.at < FIRMWARE_TTL_MS) {
      setLatest(firmwareCache.version);
      return;
    }
    const version = await fetchLatestFirmware();
    firmwareCache = { version, at: Date.now() };
    setLatest(version);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { latest, latestVer: parseVersion(latest), reload };
}
