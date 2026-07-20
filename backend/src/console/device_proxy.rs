//! Per-device management-API proxy for the cloud console. A request here
//! travels: browser → this endpoint → the device's live control stream
//! (gRPC) → the device's local quartzfire-webui backend (which fronts the
//! VyOS HTTP API plus the device's own endpoints) — and the response comes
//! back the same way, status and body passed through verbatim. That keeps the
//! cloud's device Configure pages byte-compatible with the local web UI's
//! data layer.

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

use crate::{
    audit,
    console::organizations::member_org,
    error::{AppError, Result},
    gateway::control::ProxyError,
    security::Claims,
    AppState,
};

/// Commit + boot-save (and guard applies) can take a while on a busy device;
/// reads are quick.
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const WRITE_TIMEOUT: Duration = Duration::from_secs(120);

fn caller_id(claims: &Claims) -> Result<Uuid> {
    claims.sub.parse().map_err(|_| AppError::Unauthorized)
}

#[derive(Deserialize)]
pub struct DeviceProxyBody {
    /// GET | POST | PUT | DELETE.
    method: String,
    /// Path (plus optional query) on the device, always under /api/.
    path: String,
    /// Request body content type; omit for body-less requests.
    #[serde(default)]
    content_type: Option<String>,
    /// Request body as text (JSON or form-encoded — the device APIs use both).
    #[serde(default)]
    body: Option<String>,
}

/// An error body in the VyOS response shape, so the frontend's normal error
/// surface applies to transport failures too.
fn proxy_error(status: StatusCode, message: &str) -> Response {
    (
        status,
        Json(json!({ "success": false, "error": message, "data": null })),
    )
        .into_response()
}

/// Read calls any member may make; everything else needs owner/admin. The
/// VyOS API is POST-based, so the read set is method GET plus the two
/// read-only VyOS endpoints.
fn is_read(method: &str, path: &str) -> bool {
    if method == "GET" {
        return true;
    }
    method == "POST" && (path == "/api/retrieve" || path == "/api/show")
}

/// POST /api/orgs/:organization_guid/devices/:device_id/proxy
pub async fn forward(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, device_id)): Path<(Uuid, String)>,
    Json(body): Json<DeviceProxyBody>,
) -> Result<Response> {
    let uid = caller_id(&claims)?;
    let org = member_org(&state, organization_guid, uid).await?;

    let method = body.method.to_ascii_uppercase();
    if !matches!(method.as_str(), "GET" | "POST" | "PUT" | "DELETE") {
        return Err(AppError::BadRequest("unsupported method".into()));
    }
    // Only the device's /api surface is reachable, and never its session
    // management (cloud callers are authenticated by the cloud, not the
    // device; the agent injects its own local credentials).
    let path_only = body.path.split('?').next().unwrap_or("");
    if !body.path.starts_with("/api/") || path_only.starts_with("/api/auth") {
        return Err(AppError::BadRequest("path must be under /api/".into()));
    }

    let read = is_read(&method, path_only);
    if !read && org.role != "owner" && org.role != "admin" {
        return Err(AppError::Forbidden);
    }

    // The device must exist in this org and be adopted (revoked devices keep
    // their row but lose the control surface).
    let device_state: Option<(String,)> =
        sqlx::query_as("SELECT state FROM devices WHERE device_id = $1 AND org_id = $2")
            .bind(&device_id)
            .bind(organization_guid)
            .fetch_optional(&state.db)
            .await?;
    match device_state {
        None => return Err(AppError::NotFound("no such device".into())),
        Some((st,)) if st != "adopted" => {
            return Ok(proxy_error(
                StatusCode::CONFLICT,
                "This device is not adopted — re-enroll it before managing it.",
            ))
        }
        _ => {}
    }

    let timeout = if read { READ_TIMEOUT } else { WRITE_TIMEOUT };
    let outcome = state
        .device_registry
        .proxy(
            &device_id,
            organization_guid,
            &method,
            &body.path,
            body.content_type.as_deref().unwrap_or(""),
            body.body.unwrap_or_default().into_bytes(),
            timeout,
        )
        .await;

    if !read {
        audit::record(
            &state.db,
            Some(organization_guid),
            &format!("user:{uid}"),
            "device.config_change",
            json!({
                "device_id": device_id,
                "method": method,
                "path": path_only,
                "ok": outcome.is_ok(),
            }),
        )
        .await;
    }

    let resp = match outcome {
        Ok(r) => r,
        Err(ProxyError::Offline) => {
            return Ok(proxy_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Device is offline — it has no active connection to Quartz Command.",
            ))
        }
        Err(ProxyError::Timeout) => {
            return Ok(proxy_error(
                StatusCode::GATEWAY_TIMEOUT,
                "The device did not answer in time.",
            ))
        }
        Err(ProxyError::Disconnected) => {
            return Ok(proxy_error(
                StatusCode::BAD_GATEWAY,
                "The device disconnected while handling the request.",
            ))
        }
    };

    // Transport-level failure on the device (local API unreachable).
    if !resp.error.is_empty() {
        return Ok(proxy_error(StatusCode::BAD_GATEWAY, &resp.error));
    }

    // Pass the device's response through: same status, type, and body.
    let status =
        StatusCode::from_u16(resp.http_status as u16).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = if resp.content_type.is_empty() {
        "application/json".to_string()
    } else {
        resp.content_type
    };
    Ok((status, [(header::CONTENT_TYPE, content_type)], resp.body).into_response())
}
