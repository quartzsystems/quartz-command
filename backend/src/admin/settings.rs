//! Server settings for the admin console (Settings → Server). Sits behind
//! `admin::auth::require_admin`. Each setting is returned as its effective
//! value plus the override/default pair so the UI can show where a value
//! comes from and offer a reset.

use axum::{extract::State, Extension, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;

use crate::{
    audit,
    error::{AppError, Result},
    security::Claims,
    settings, AppState,
};

#[derive(Serialize)]
pub struct ServerSettings {
    /// Effective public gateway address (override, else default).
    pub gateway_addr: String,
    /// Admin-set override, if any.
    pub gateway_addr_override: Option<String>,
    /// Env-derived fallback (`QC_GATEWAY_ADDR`, else `QC_GRPC_LISTEN`).
    pub gateway_addr_default: String,
}

async fn current(state: &Arc<AppState>) -> Result<ServerSettings> {
    let over = settings::get(&state.db, settings::GATEWAY_ADDR).await?;
    let default = state.config.gateway_addr.clone();
    Ok(ServerSettings {
        gateway_addr: over.clone().unwrap_or_else(|| default.clone()),
        gateway_addr_override: over,
        gateway_addr_default: default,
    })
}

/// GET /api/admin/settings
pub async fn get_settings(State(state): State<Arc<AppState>>) -> Result<Json<ServerSettings>> {
    Ok(Json(current(&state).await?))
}

/// The address ends up in the pipe-delimited `QC1|…` token and is dialed by
/// devices, so it must be a plain `host:port` — no scheme, path, spaces, or
/// `|`, and the host a DNS name or IP literal.
fn validate_gateway_addr(s: &str) -> Result<()> {
    let err = |msg: &str| Err(AppError::BadRequest(format!("gateway address: {msg}")));

    if let Ok(sock) = s.parse::<std::net::SocketAddr>() {
        // IP literal (v4 or bracketed v6) with port
        return if sock.port() == 0 { err("port must be 1-65535") } else { Ok(()) };
    }
    let Some((host, port)) = s.rsplit_once(':') else {
        return err("must be host:port (e.g. gw.example.com:8443)");
    };
    if port.parse::<u16>().map(|p| p == 0).unwrap_or(true) {
        return err("port must be 1-65535");
    }
    if host.is_empty() {
        return err("host must not be empty");
    }
    let dns_ok = host
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        && !host.starts_with(['-', '.'])
        && !host.ends_with(['-', '.']);
    if !dns_ok {
        return err("host must be a DNS name or IP literal");
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct UpdateSettingsRequest {
    /// New override; `null` (or missing) clears it back to the default.
    pub gateway_addr: Option<String>,
}

/// PUT /api/admin/settings — applies to enrollment tokens and enrollment
/// responses immediately; the gateway's auto-issued TLS cert picks up a new
/// host on the next backend restart.
pub async fn update(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateSettingsRequest>,
) -> Result<Json<ServerSettings>> {
    let value = body.gateway_addr.as_deref().map(str::trim).filter(|v| !v.is_empty());
    match value {
        Some(addr) => {
            validate_gateway_addr(addr)?;
            settings::set(&state.db, settings::GATEWAY_ADDR, addr).await?;
        }
        None => settings::unset(&state.db, settings::GATEWAY_ADDR).await?,
    }

    audit::record(
        &state.db,
        None,
        &format!("admin:{}", claims.sub),
        "settings.updated",
        json!({ "gateway_addr": value }),
    )
    .await;
    tracing::info!(gateway_addr = ?value, "server settings updated");

    Ok(Json(current(&state).await?))
}
