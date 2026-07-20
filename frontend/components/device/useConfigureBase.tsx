"use client";

import { useParams } from "next/navigation";

/// Base path of the current device's Configure section — the ported
/// QuartzFire pages join their cross-page links (e.g. Rules ↔ Zones) onto
/// this instead of the local UI's absolute paths.
export function useConfigureBase(): string {
  const params = useParams<{
    organization_guid: string;
    sub_guid: string;
    device_id: string;
  }>();
  return `/cloud/${params.organization_guid}/orgs/${params.sub_guid}/devices/${params.device_id}/configure`;
}
