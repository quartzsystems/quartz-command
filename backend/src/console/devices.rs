//! Device endpoints for the cloud console's Inventory section. Org-scoped,
//! behind `auth::require_auth`; revoking a device requires owner/admin.

use axum::{extract::Path, extract::Query, extract::State, Extension, Json};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    audit,
    console::organizations::{member_org, require_folder, require_sub_org},
    error::{AppError, Result},
    models::{
        Device, DeviceSecurityTelemetry, DeviceStats, DeviceStatsResponse, DeviceStatsSample,
        FleetDeviceStats, FleetStatsResponse, FleetStatsSample, TrafficPoint,
    },
    security::Claims,
    AppState,
};

fn caller_id(claims: &Claims) -> Result<Uuid> {
    claims.sub.parse().map_err(|_| AppError::Unauthorized)
}

/// GET /api/orgs/:organization_guid/devices — any member.
pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(organization_guid): Path<Uuid>,
) -> Result<Json<Vec<Device>>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;

    let mut devices = sqlx::query_as::<_, Device>(
        "SELECT d.device_id, d.state, d.product, d.hostname, d.qf_version, d.cert_serial, d.cert_not_after, \
                d.enrolled_at, d.enrolled_via_token, d.last_seen_at, d.last_seen_ip, \
                d.sub_org_id, s.name AS sub_org_name, \
                d.folder_id, f.name AS folder_name \
         FROM devices d \
         LEFT JOIN organizations s ON s.id = d.sub_org_id \
         LEFT JOIN device_folders f ON f.id = d.folder_id \
         WHERE d.org_id = $1 ORDER BY d.enrolled_at DESC NULLS LAST, d.device_id",
    )
    .bind(organization_guid)
    .fetch_all(&state.db)
    .await?;

    // Mark live connectivity from the gateway's in-memory stream registry — the
    // ground-truth online/offline signal (a device is "online" only while it
    // holds an active control stream), taken as one snapshot.
    let online = state.device_registry.online_ids();
    for d in &mut devices {
        d.connected = online.contains(&d.device_id);
    }

    Ok(Json(devices))
}

/// GET /api/orgs/:organization_guid/security-telemetry — any member. The latest
/// pushed security-service snapshot for every device in the org that has ever
/// reported. Carries `sub_org_id` so the Monitor → Summary can scope and
/// aggregate per sub-organization (or per device) client-side.
pub async fn security_telemetry(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(organization_guid): Path<Uuid>,
) -> Result<Json<Vec<DeviceSecurityTelemetry>>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;

    let rows = sqlx::query_as::<_, DeviceSecurityTelemetry>(
        "SELECT t.device_id, d.sub_org_id, t.time_unix, \
                t.ips_enabled, t.ips_prevented, t.ips_detected, t.ips_scans, t.ips_scans_available, \
                t.ac_enabled, t.ac_blocked, t.ac_detected, t.ac_total_requests, \
                t.geo_enabled, t.geo_blocked, t.geo_connections, t.geo_countries_blocked, \
                t.cf_enabled, t.cf_blocked, t.cf_allowed, t.cf_total_requests, t.received_at \
         FROM device_security_telemetry t \
         JOIN devices d ON d.device_id = t.device_id \
         WHERE d.org_id = $1",
    )
    .bind(organization_guid)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

/// GET /api/orgs/:organization_guid/devices/:device_id/stats — any member. The
/// device Monitor overview payload: the latest health & stats snapshot plus a
/// short window of utilization samples (oldest first) for the sparklines. The
/// device must belong to this org; an unreported device yields a null latest
/// and an empty sample list.
pub async fn device_stats(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, device_id)): Path<(Uuid, String)>,
) -> Result<Json<DeviceStatsResponse>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;

    // Scope to a device that belongs to this org (a bare id from another org
    // must not read across the tenant boundary).
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT device_id FROM devices WHERE device_id = $1 AND org_id = $2")
            .bind(&device_id)
            .bind(organization_guid)
            .fetch_optional(&state.db)
            .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("no such device".into()));
    }

    let latest = sqlx::query_as::<_, DeviceStats>(
        "SELECT device_id, time_unix, cpu_pct, mem_pct, disk_pct, uptime_secs, \
                public_ip, mem_used_bytes, mem_total_bytes, disk_used_bytes, \
                disk_total_bytes, top_policies, received_at \
         FROM device_stats WHERE device_id = $1",
    )
    .bind(&device_id)
    .fetch_optional(&state.db)
    .await?;

    // Newest-first from the DB (bounded by the index), reversed to oldest-first
    // so the console can plot left-to-right without re-sorting.
    let mut samples = sqlx::query_as::<_, DeviceStatsSample>(
        "SELECT cpu_pct, mem_pct, disk_pct, received_at \
         FROM device_stats_samples WHERE device_id = $1 \
         ORDER BY received_at DESC LIMIT 240",
    )
    .bind(&device_id)
    .fetch_all(&state.db)
    .await?;
    samples.reverse();

    Ok(Json(DeviceStatsResponse { latest, samples }))
}

/// GET /api/orgs/:organization_guid/fleet-stats — any member. The latest
/// health gauges for every reporting device in the org plus a short per-device
/// utilization history (oldest first), powering the dashboard's Fleet Health
/// card without a per-device round-trip. Rows carry `sub_org_id` so the
/// console scopes per sub-organization client-side, like security-telemetry.
pub async fn fleet_stats(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(organization_guid): Path<Uuid>,
) -> Result<Json<FleetStatsResponse>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;

    let stats = sqlx::query_as::<_, FleetDeviceStats>(
        "SELECT t.device_id, d.sub_org_id, t.cpu_pct, t.mem_pct, t.disk_pct, \
                t.uptime_secs, t.received_at \
         FROM device_stats t \
         JOIN devices d ON d.device_id = t.device_id \
         WHERE d.org_id = $1",
    )
    .bind(organization_guid)
    .fetch_all(&state.db)
    .await?;

    // The newest 48 samples per device (~24 min at the 30 s cadence) — enough
    // for a card-sized sparkline. Oldest first so the console plots
    // left-to-right without re-sorting.
    let samples = sqlx::query_as::<_, FleetStatsSample>(
        "SELECT device_id, cpu_pct, mem_pct, disk_pct, received_at FROM ( \
            SELECT s.device_id, s.cpu_pct, s.mem_pct, s.disk_pct, s.received_at, \
                   row_number() OVER (PARTITION BY s.device_id ORDER BY s.received_at DESC) AS rn \
            FROM device_stats_samples s \
            JOIN devices d ON d.device_id = s.device_id \
            WHERE d.org_id = $1 \
         ) ranked WHERE rn <= 48 ORDER BY received_at",
    )
    .bind(organization_guid)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(FleetStatsResponse { stats, samples }))
}

#[derive(Deserialize)]
pub struct TrafficQuery {
    /// Scope to one sub-organization (must belong to the org).
    pub sub: Option<Uuid>,
    /// Window in minutes; default 60, capped to the 24 h sample retention.
    pub minutes: Option<i64>,
}

/// GET /api/orgs/:organization_guid/traffic — any member. Minute-bucketed WAN
/// throughput for the scope (bits/sec): each device's samples are averaged
/// within the bucket, then summed across devices, oldest first. Devices whose
/// agents don't report throughput simply contribute nothing.
pub async fn org_traffic(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(organization_guid): Path<Uuid>,
    Query(q): Query<TrafficQuery>,
) -> Result<Json<Vec<TrafficPoint>>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;
    if let Some(sub) = q.sub {
        require_sub_org(&state, organization_guid, sub).await?;
    }
    let minutes = i32::try_from(q.minutes.unwrap_or(60).clamp(5, 24 * 60)).unwrap_or(60);

    let rows = sqlx::query_as::<_, TrafficPoint>(
        "SELECT bucket, sum(rx)::bigint AS rx_bps, sum(tx)::bigint AS tx_bps FROM ( \
            SELECT s.device_id, date_trunc('minute', s.received_at) AS bucket, \
                   avg(s.rx_bps) AS rx, avg(s.tx_bps) AS tx \
            FROM device_traffic_samples s \
            JOIN devices d ON d.device_id = s.device_id \
            WHERE d.org_id = $1 AND ($2::uuid IS NULL OR d.sub_org_id = $2) \
              AND s.received_at > now() - make_interval(mins => $3) \
            GROUP BY s.device_id, date_trunc('minute', s.received_at) \
         ) per_device GROUP BY bucket ORDER BY bucket",
    )
    .bind(organization_guid)
    .bind(q.sub)
    .bind(minutes)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

/// POST /api/orgs/:organization_guid/devices/:device_id/revoke — owner/admin.
/// A revoked device can no longer renew its certificate; re-enrollment with a
/// fresh token (same key) is allowed and re-adopts it.
pub async fn revoke(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, device_id)): Path<(Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    let uid = caller_id(&claims)?;
    let org = member_org(&state, organization_guid, uid).await?;
    if org.role != "owner" && org.role != "admin" {
        return Err(AppError::Forbidden);
    }

    let updated = sqlx::query(
        "UPDATE devices SET state = 'revoked' \
         WHERE device_id = $1 AND org_id = $2 AND state <> 'revoked'",
    )
    .bind(&device_id)
    .bind(organization_guid)
    .execute(&state.db)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("no such active device".into()));
    }

    audit::record(
        &state.db,
        Some(organization_guid),
        &format!("user:{uid}"),
        "device.revoked",
        json!({ "device_id": device_id }),
    )
    .await;
    audit::raise_event(
        &state.db,
        organization_guid,
        "warning",
        "Device revoked",
        json!({ "device_id": device_id }),
    )
    .await;
    tracing::info!(device = %device_id, org = %organization_guid, "device revoked");

    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct AllocateRequest {
    /// Sub-organization to allocate the device to; None returns it to the
    /// parent organization's unallocated pool.
    pub sub_org_id: Option<Uuid>,
}

/// POST /api/orgs/:organization_guid/devices/:device_id/allocate — owner/admin.
/// Allocates the device to a sub-organization, moves it between
/// sub-organizations, or (with a null sub_org_id) deallocates it back to the
/// top-level pool.
pub async fn allocate(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, device_id)): Path<(Uuid, String)>,
    Json(body): Json<AllocateRequest>,
) -> Result<Json<serde_json::Value>> {
    let uid = caller_id(&claims)?;
    let org = member_org(&state, organization_guid, uid).await?;
    if org.role != "owner" && org.role != "admin" {
        return Err(AppError::Forbidden);
    }
    if let Some(sub) = body.sub_org_id {
        require_sub_org(&state, organization_guid, sub).await?;
    }

    // Folders belong to a specific sub-org, so any allocation change drops the
    // device out of its folder back to the destination's ungrouped pool.
    let updated = sqlx::query(
        "UPDATE devices SET sub_org_id = $3, folder_id = NULL \
         WHERE device_id = $1 AND org_id = $2",
    )
    .bind(&device_id)
    .bind(organization_guid)
    .bind(body.sub_org_id)
    .execute(&state.db)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("no such device".into()));
    }

    audit::record(
        &state.db,
        Some(organization_guid),
        &format!("user:{uid}"),
        if body.sub_org_id.is_some() { "device.allocated" } else { "device.deallocated" },
        json!({ "device_id": device_id, "sub_org_id": body.sub_org_id }),
    )
    .await;
    tracing::info!(device = %device_id, org = %organization_guid,
                   sub_org = ?body.sub_org_id, "device allocation changed");

    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct SetFolderRequest {
    /// Folder to move the device into; None removes it from any folder (back to
    /// the sub-organization's ungrouped pool).
    pub folder_id: Option<Uuid>,
}

/// POST /api/orgs/:organization_guid/devices/:device_id/folder — owner/admin.
/// Groups an allocated device into a folder of its sub-organization, or (with a
/// null folder_id) removes it from its folder. The device must already be
/// allocated to a sub-organization, and the folder must belong to that same
/// sub-organization.
pub async fn set_folder(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, device_id)): Path<(Uuid, String)>,
    Json(body): Json<SetFolderRequest>,
) -> Result<Json<serde_json::Value>> {
    let uid = caller_id(&claims)?;
    let org = member_org(&state, organization_guid, uid).await?;
    if org.role != "owner" && org.role != "admin" {
        return Err(AppError::Forbidden);
    }

    // A device must be allocated to a sub-org before it can go in a folder.
    let device_sub_org: Option<Uuid> = sqlx::query_scalar(
        "SELECT sub_org_id FROM devices WHERE device_id = $1 AND org_id = $2",
    )
    .bind(&device_id)
    .bind(organization_guid)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("no such device".into()))?;

    let sub_org_id = device_sub_org.ok_or_else(|| {
        AppError::BadRequest("device is not allocated to a sub-organization".into())
    })?;

    // The folder must belong to the device's sub-org — keeps the invariant that
    // folder_id always points to a folder of the device's current sub-org.
    if let Some(folder_id) = body.folder_id {
        require_folder(&state, sub_org_id, folder_id).await?;
    }

    sqlx::query("UPDATE devices SET folder_id = $3 WHERE device_id = $1 AND org_id = $2")
        .bind(&device_id)
        .bind(organization_guid)
        .bind(body.folder_id)
        .execute(&state.db)
        .await?;

    audit::record(
        &state.db,
        Some(organization_guid),
        &format!("user:{uid}"),
        if body.folder_id.is_some() { "device.foldered" } else { "device.unfoldered" },
        json!({ "device_id": device_id, "folder_id": body.folder_id }),
    )
    .await;
    tracing::info!(device = %device_id, org = %organization_guid,
                   folder = ?body.folder_id, "device folder changed");

    Ok(Json(json!({ "ok": true })))
}
