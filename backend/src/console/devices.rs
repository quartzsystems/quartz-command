//! Device endpoints for the cloud console's Inventory section. Org-scoped,
//! behind `auth::require_auth`; revoking a device requires owner/admin.

use axum::{extract::Path, extract::State, Extension, Json};
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    audit,
    console::organizations::member_org,
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
        "SELECT device_id, state, hostname, qf_version, cert_serial, cert_not_after, \
                enrolled_at, enrolled_via_token, last_seen_at, last_seen_ip \
         FROM devices WHERE org_id = $1 ORDER BY enrolled_at DESC NULLS LAST, device_id",
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
