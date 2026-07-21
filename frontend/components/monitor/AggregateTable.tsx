"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ChevronRight, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { FanoutItem } from "@/lib/device/fanout";

/// Load an aggregate once on mount (plus manual refresh). Aggregates fan out to
/// every firewall in the sub-org, so they don't auto-poll — the Refresh button
/// re-runs the same loader.
export function useAggregate<T>(loader: () => Promise<FanoutItem<T>[]>) {
  const [items, setItems] = useState<FanoutItem<T>[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const reload = useCallback(
    async (mode: "load" | "refresh" = "load") => {
      if (mode === "load") setStatus("loading");
      try {
        const r = await loader();
        setItems(r);
        setLastUpdated(new Date());
        setStatus("ready");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Failed to load.");
        setStatus("error");
      }
    },
    [loader],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return { items, status, errorMsg, lastUpdated, reload };
}

export interface AggregateColumn<T> {
  key: string;
  header: string;
  render: (data: T) => React.ReactNode;
  align?: "left" | "right";
  width?: number;
}

/// The device-scoped Monitor path for a firewall in this sub-org, so each
/// aggregate row can deep-link to that firewall's full live status. `suffix`
/// is the section path, e.g. "/routing/ospf".
export function useDeviceMonitorHref(suffix: string) {
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  return (deviceId: string) =>
    `/cloud/${params.organization_guid}/orgs/${params.sub_guid}/devices/${deviceId}/monitor${suffix}`;
}

/// One-row-per-firewall aggregate: the section's key metrics for firewalls that
/// answered, a muted reason for those that didn't, and a link into each one's
/// device-scope view for the full detail. Presentational — the caller owns the
/// fan-out via `useAggregate`.
export function AggregateTable<T>({
  items,
  status,
  errorMsg,
  lastUpdated,
  columns,
  deviceHref,
  onRefresh,
  emptyMessage = "No firewalls in this sub-organization.",
}: {
  items: FanoutItem<T>[];
  status: "loading" | "ready" | "error";
  errorMsg?: string;
  lastUpdated: Date | null;
  columns: AggregateColumn<T>[];
  deviceHref: (deviceId: string) => string;
  onRefresh: () => void;
  emptyMessage?: string;
}) {
  if (status === "loading") {
    return <div className="text-[13px] text-[var(--qz-fg-4)]">Loading aggregate…</div>;
  }
  if (status === "error") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[13px] text-[var(--qz-danger)]">
          <AlertTriangle size={15} /> {errorMsg}
        </div>
        <div>
          <Button kind="secondary" icon={RotateCw} onClick={onRefresh}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-3">
        {lastUpdated && (
          <span className="text-[12px] text-[var(--qz-fg-4)]">
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
        <Button kind="secondary" size="sm" icon={RotateCw} onClick={onRefresh}>
          Refresh
        </Button>
      </div>
      <div className="rounded-md overflow-x-auto" style={{ border: "1px solid var(--qz-border)" }}>
        <table className="qz-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ width: 200 }}>Firewall</th>
              {columns.map((c) => (
                <th key={c.key} className={c.align === "right" ? "text-right" : undefined} style={c.width ? { width: c.width } : undefined}>
                  {c.header}
                </th>
              ))}
              <th style={{ width: 70 }} className="text-right">
                View
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="text-center text-[var(--qz-fg-4)]" style={{ cursor: "default" }}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.deviceId}>
                  <td>
                    <span className="inline-flex items-center gap-[7px]">
                      <span
                        className="w-[8px] h-[8px] rounded-full flex-shrink-0"
                        style={{ background: it.connected ? "var(--qz-success)" : "var(--qz-fg-4)" }}
                      />
                      <span className="uppercase font-medium text-[var(--qz-fg-1)]">
                        {it.hostname ?? it.deviceId}
                      </span>
                    </span>
                  </td>
                  {it.data != null ? (
                    columns.map((c) => (
                      <td key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                        {c.render(it.data as T)}
                      </td>
                    ))
                  ) : (
                    <td colSpan={columns.length} className="text-[var(--qz-fg-4)]">
                      {it.error ?? "no data"}
                    </td>
                  )}
                  <td className="text-right">
                    <Link
                      href={deviceHref(it.deviceId)}
                      className="inline-flex items-center text-[var(--qz-fg-3)] hover:text-[var(--qz-accent)] no-underline"
                      title="Open this firewall's Monitor"
                    >
                      <ChevronRight size={16} />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
