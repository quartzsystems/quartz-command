//! Device endpoints for the cloud console's Inventory section. Org-scoped,
//! behind `auth::require_auth`; revoking a device requires owner/admin.

use axum::{extract::Path, extract::State, Extension, Json};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    audit,
    console::organizations::{member_org, require_sub_org},
    error::{AppError, Result},
    models::Device,
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

    let devices = sqlx::query_as::<_, Device>(
        "SELECT d.device_id, d.state, d.hostname, d.qf_version, d.cert_serial, d.cert_not_after, \
                d.enrolled_at, d.enrolled_via_token, d.last_seen_at, d.last_seen_ip, \
                d.sub_org_id, s.name AS sub_org_name \
         FROM devices d LEFT JOIN organizations s ON s.id = d.sub_org_id \
         WHERE d.org_id = $1 ORDER BY d.enrolled_at DESC NULLS LAST, d.device_id",
    )
    .bind(organization_guid)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(devices))
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

    let updated = sqlx::query(
        "UPDATE devices SET sub_org_id = $3 WHERE device_id = $1 AND org_id = $2",
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
