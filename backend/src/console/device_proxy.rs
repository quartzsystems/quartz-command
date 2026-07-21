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
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

use crate::{
    audit,
    console::organizations::{member_org, require_sub_org},
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

/// One firewall's answer in a fan-out. `connected` is the live-stream state;
/// when false the device was never contacted. `http_status`/`body` are present
/// when the device replied; `error` carries a transport/offline failure so the
/// console can show which firewalls dropped out of the aggregate.
#[derive(Serialize)]
struct FanoutItem {
    device_id: String,
    hostname: Option<String>,
    connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// POST /api/orgs/:organization_guid/subs/:sub_guid/monitor/proxy-fanout
///
/// Replays one read-only local-API call against every adopted firewall in the
/// sub-organization and returns the per-device answers, so the Monitor section
/// can build an aggregate summary from a single request instead of the browser
/// fanning out. Reads only — the same GET/`show`/`retrieve` set the per-device
/// proxy treats as read.
pub async fn fanout(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, sub_guid)): Path<(Uuid, Uuid)>,
    Json(body): Json<DeviceProxyBody>,
) -> Result<Json<serde_json::Value>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;
    require_sub_org(&state, organization_guid, sub_guid).await?;

    let method = body.method.to_ascii_uppercase();
    let path_only = body.path.split('?').next().unwrap_or("");
    if !body.path.starts_with("/api/") || path_only.starts_with("/api/auth") {
        return Err(AppError::BadRequest("path must be under /api/".into()));
    }
    if !is_read(&method, path_only) {
        return Err(AppError::BadRequest("fan-out is read-only".into()));
    }

    // Adopted firewalls in this sub-org; revoked/pending devices have no control
    // surface, so they never appear in the aggregate.
    let devices: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT device_id, hostname FROM devices \
         WHERE org_id = $1 AND sub_org_id = $2 AND state = 'adopted' \
         ORDER BY hostname NULLS LAST, device_id",
    )
    .bind(organization_guid)
    .bind(sub_guid)
    .fetch_all(&state.db)
    .await?;

    let online = state.device_registry.online_ids();
    let content_type = body.content_type.unwrap_or_default();
    let req_body = body.body.unwrap_or_default();

    let mut results: Vec<FanoutItem> = Vec::with_capacity(devices.len());
    for (device_id, hostname) in devices {
        if !online.contains(&device_id) {
            results.push(FanoutItem {
                device_id,
                hostname,
                connected: false,
                http_status: None,
                body: None,
                error: Some("offline".into()),
            });
            continue;
        }
        let outcome = state
            .device_registry
            .proxy(
                &device_id,
                organization_guid,
                &method,
                &body.path,
                &content_type,
                req_body.clone().into_bytes(),
                READ_TIMEOUT,
            )
            .await;
        let item = match outcome {
            Ok(resp) if resp.error.is_empty() => FanoutItem {
                device_id,
                hostname,
                connected: true,
                http_status: Some(resp.http_status as u16),
                body: Some(String::from_utf8_lossy(&resp.body).into_owned()),
                error: None,
            },
            Ok(resp) => FanoutItem {
                device_id,
                hostname,
                connected: true,
                http_status: None,
                body: None,
                error: Some(resp.error),
            },
            Err(e) => FanoutItem {
                device_id,
                hostname,
                connected: true,
                http_status: None,
                body: None,
                error: Some(match e {
                    ProxyError::Offline => "offline".into(),
                    ProxyError::Timeout => "timed out".into(),
                    ProxyError::Disconnected => "disconnected".into(),
                }),
            },
        };
        results.push(item);
    }

    Ok(Json(json!({ "results": results })))
}
