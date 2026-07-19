//! Admin realm authentication (`/api/admin/auth/*`) — the `/admin/login` +
//! `/admin` console.
//!
//! Structurally identical to `console/auth.rs` but verifies against the separate
//! `admins` table, uses its own cookie (`qc_admin_session`) and its own JWT
//! signing secret. Both the distinct secret and the `realm` claim ensure a user
//! session can never satisfy admin auth (and vice versa).

use axum::{
    extract::{Request, State},
    http::header::SET_COOKIE,
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    models::Admin,
    security::{
        self, clear_cookie, decode_token, encode_token, extract_token, session_cookie, Claims,
    },
    AppState,
};

pub const COOKIE_NAME: &str = "qc_admin_session";
pub const REALM: &str = "admin";

#[derive(Deserialize)]
pub struct LoginRequest {
    email: String,
    password: String,
}

fn admin_body(admin: &Admin) -> Value {
    serde_json::json!({
        "id": admin.id,
        "email": admin.email,
        "full_name": admin.full_name,
    })
}

/// Look up an admin by email and verify the password. Same uniform-401 +
/// dummy-verify timing guarantees as the user realm.
async fn verify_admin(state: &Arc<AppState>, email: &str, password: &str) -> Result<Admin> {
    let admin: Option<Admin> = sqlx::query_as::<_, Admin>(
        "SELECT id, email, full_name, password_hash, is_active, created_at \
         FROM admins WHERE lower(email) = lower($1)",
    )
    .bind(email)
    .fetch_optional(&state.db)
    .await?;

    let stored = admin
        .as_ref()
        .filter(|a| a.is_active)
        .map(|a| a.password_hash.clone());
    let password = password.to_string();
    let ok = tokio::task::spawn_blocking(move || {
        security::verify_password(&password, stored.as_deref())
    })
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("verify task failed: {e}")))?;

    match admin {
        Some(a) if ok => Ok(a),
        Some(_) => {
            tracing::warn!(%email, "admin login failed: inactive or bad password");
            Err(AppError::Unauthorized)
        }
        None => {
            tracing::warn!(%email, "admin login failed: no such admin");
            Err(AppError::Unauthorized)
        }
    }
}

/// POST /api/admin/auth/login — public.
pub async fn login(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<LoginRequest>,
) -> Result<Response> {
    if body.email.is_empty() || body.password.is_empty() {
        return Err(AppError::BadRequest("email and password are required".into()));
    }

    let admin = verify_admin(&state, &body.email, &body.password).await?;
    tracing::info!(admin = %admin.email, "admin login ok");

    let claims = Claims::new(&admin.id.to_string(), REALM, state.config.session_hours);
    let token = encode_token(&claims, &state.admin_jwt_secret).map_err(AppError::Internal)?;
    let cookie = session_cookie(
        COOKIE_NAME,
        &token,
        state.config.cookie_secure,
        state.config.session_hours * 3600,
    );

    Ok(([(SET_COOKIE, cookie)], axum::Json(admin_body(&admin))).into_response())
}

/// POST /api/admin/auth/logout — public.
pub async fn logout(State(state): State<Arc<AppState>>) -> Response {
    (
        [(SET_COOKIE, clear_cookie(COOKIE_NAME, state.config.cookie_secure))],
        axum::Json(serde_json::json!({ "ok": true })),
    )
        .into_response()
}

/// GET /api/admin/auth/me — behind `require_admin`.
pub async fn me(State(state): State<Arc<AppState>>, req: Request) -> Result<axum::Json<Value>> {
    let claims = req
        .extensions()
        .get::<Claims>()
        .ok_or(AppError::Unauthorized)?
        .clone();
    let id: Uuid = claims.sub.parse().map_err(|_| AppError::Unauthorized)?;

    let admin: Admin = sqlx::query_as::<_, Admin>(
        "SELECT id, email, full_name, password_hash, is_active, created_at \
         FROM admins WHERE id = $1 AND is_active = true",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    Ok(axum::Json(admin_body(&admin)))
}

/// Requires a valid **admin** session (cookie or Bearer).
pub async fn require_admin(
    State(state): State<Arc<AppState>>,
    mut req: Request,
    next: Next,
) -> Result<Response> {
    let token = extract_token(req.headers(), COOKIE_NAME).ok_or(AppError::Unauthorized)?;
    let claims =
        decode_token(&token, &state.admin_jwt_secret, REALM).ok_or(AppError::Unauthorized)?;
    req.extensions_mut().insert(claims);
    Ok(next.run(req).await)
}
