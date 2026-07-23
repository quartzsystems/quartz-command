// Data layer for the MAC forwarding database on QuartzSONiC switches,
// fetched live through the device proxy against the agent's management API
// (quartz-sonic src/mgmtapi.rs). Config side: FDB aging time (CONFIG_DB
// SWITCH table) and static MAC entries (CONFIG_DB FDB table). Read side:
// the learned table assembled from ASIC/STATE_DB (what `show mac` prints),
// rendered by the Monitor → Switching → MAC Table page. Keep these shapes
// in step with quartz-sonic — the agent is the source of truth for the
// contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

// ── Config: aging + static entries ─────────────────────────────────────────

export interface StaticFdbEntry {
  vlan_id: number;
  /** Colon-separated lowercase MAC, e.g. "00:11:22:33:44:55". */
  mac: string;
  /** Port or port channel the MAC is pinned to. */
  port: string;
}

export interface FdbConfigDoc {
  capability: FeatureCapability;
  /** Seconds; null = image default (the agent reports the default in
   *  aging_time_default so the UI can show it as a placeholder). */
  aging_time_seconds: number | null;
  aging_time_default: number | null;
  static_entries: StaticFdbEntry[];
}

export async function fetchFdbConfig(): Promise<FdbConfigDoc> {
  return apiFetch<FdbConfigDoc>("/switching/fdb");
}

export async function updateFdbSettings(agingTimeSeconds: number | null): Promise<void> {
  await apiFetch("/switching/fdb/settings", {
    method: "PUT",
    body: JSON.stringify({ aging_time_seconds: agingTimeSeconds }),
  });
}

/** Upsert one static entry (keyed by vlan+mac in the path). */
export async function putStaticFdbEntry(entry: StaticFdbEntry): Promise<void> {
  await apiFetch(
    `/switching/fdb/static/${entry.vlan_id}/${encodeURIComponent(entry.mac)}`,
    { method: "PUT", body: JSON.stringify({ port: entry.port }) },
  );
}

export async function deleteStaticFdbEntry(vlanId: number, mac: string): Promise<void> {
  await apiFetch(`/switching/fdb/static/${vlanId}/${encodeURIComponent(mac)}`, {
    method: "DELETE",
  });
}

// ── Read side: the learned table ────────────────────────────────────────────

export interface FdbTableEntry {
  vlan_id: number;
  mac: string;
  port: string;
  origin: "dynamic" | "static";
}

export interface FdbTableDoc {
  capability: FeatureCapability;
  entries: FdbTableEntry[];
}

export async function fetchFdbTable(): Promise<FdbTableDoc> {
  return apiFetch<FdbTableDoc>("/switching/fdb/table");
}

/** Loose MAC validation for form inputs; the canonical form the agent
 *  expects is colon-separated lowercase. */
export function normalizeMac(input: string): string | null {
  const hex = input.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)!.join(":");
}
