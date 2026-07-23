"use client";

import { useCallback, useEffect, useState } from "react";
import type { Device, Product } from "@/lib/api";

// The latest release per product line, read straight from GitHub. The repos
// are public and api.github.com serves CORS for public repos, so the browser
// can fetch them directly. Cached module-side with a short TTL so navigating
// between the Dashboard and Monitor views doesn't refetch on every mount. A
// missing/private repo simply yields null and the cards degrade to "Latest
// release unavailable".
const GITHUB_LATEST: Record<Product, string> = {
  quartzfire: "https://api.github.com/repos/quartzsystems/quartz-fire/releases/latest",
  quartzsonic: "https://api.github.com/repos/quartzsystems/quartz-sonic/releases/latest",
};
const FIRMWARE_TTL_MS = 10 * 60 * 1000;
const firmwareCache = new Map<Product, { version: string | null; at: number }>();

async function fetchLatestFirmware(product: Product): Promise<string | null> {
  try {
    const res = await fetch(GITHUB_LATEST[product], {
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

/// A short, human-facing version label from a device's raw report string —
/// "QuartzFire quartzfire-0.4.4 (qfagent…)" → "QuartzFire v0.4.4". The label
/// follows the device's product line (a QuartzSONiC switch reports the same
/// bare "0.1.0" shape but must not be branded QuartzFire); product defaults to
/// quartzfire for the firewall-only call sites. Falls back to the trimmed raw
/// string when there's no version-looking token, and to a dash when there's
/// nothing at all.
export function formatVersion(
  s: string | null | undefined,
  product: Product = "quartzfire",
): string {
  const v = parseVersion(s);
  if (!v) return s?.trim() || "—";
  const label = product === "quartzsonic" ? "QuartzSONiC" : "QuartzFire";
  return `${label} v${v[0]}.${v[1]}.${v[2]}`;
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
/// controls. Fetches once (respecting the module cache) on mount. Defaults to
/// QuartzFire for the firewall-only call sites.
export function useLatestFirmware(product: Product = "quartzfire"): {
  latest: string | null;
  latestVer: Version | null;
  reload: (force?: boolean) => void;
} {
  const [latest, setLatest] = useState<string | null>(
    firmwareCache.get(product)?.version ?? null,
  );

  const reload = useCallback(
    async (force = false) => {
      const cached = firmwareCache.get(product);
      if (!force && cached && Date.now() - cached.at < FIRMWARE_TTL_MS) {
        setLatest(cached.version);
        return;
      }
      const version = await fetchLatestFirmware(product);
      firmwareCache.set(product, { version, at: Date.now() });
      setLatest(version);
    },
    [product],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return { latest, latestVer: parseVersion(latest), reload };
}
