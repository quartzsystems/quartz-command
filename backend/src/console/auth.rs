//! User realm authentication (`/api/auth/*`) — the `/login` + `/cloud` console.
//!
//! Verifies credentials against the `users` table and issues a session in the
//! `qc_session` httpOnly cookie. See `security.rs` for the shared model.

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
    models::User,
    security::{
        self, clear_cookie, decode_token, encode_token, extract_token, session_cookie, Claims,
    },
    AppState,
};

pub const COOKIE_NAME: &str = "qc_session";
pub const REALM: &str = "user";

#[derive(Deserialize)]
pub struct LoginRequest {
    email: String,
    password: String,
}

/// The user object returned to the SPA (never includes the password hash).
fn user_body(user: &User) -> Value {
    serde_json::json!({
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
    })
}

/// Look up a user by email and verify the password. Uniform `Unauthorized` for
/// unknown users, inactive accounts, and wrong passwords; the unknown-user path
/// still runs a dummy Argon2 verify (in `verify_password`) to equalize timing.
async fn verify_user(state: &Arc<AppState>, email: &str, password: &str) -> Result<User> {
    let user: Option<User> = sqlx::query_as::<_, User>(
        "SELECT id, email, full_name, password_hash, is_active, created_at, updated_at \
         FROM users WHERE lower(email) = lower($1)",
    )
    .bind(email)
    .fetch_optional(&state.db)
    .await?;

    // Only verify against a real hash for an active account; otherwise pass
    // `None` so a dummy hash is used and the result is forced to false.
    let stored = user
        .as_ref()
        .filter(|u| u.is_active)
        .map(|u| u.password_hash.clone());
    let password = password.to_string();
    let ok = tokio::task::spawn_blocking(move || {
        security::verify_password(&password, stored.as_deref())
    })
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("verify task failed: {e}")))?;

    match user {
        Some(u) if ok => Ok(u),
        Some(u) if !u.is_active => {
            tracing::warn!(%email, "login failed: account inactive");
            Err(AppError::Unauthorized)
        }
        Some(_) => {
            tracing::warn!(%email, "login failed: bad password");
            Err(AppError::Unauthorized)
        }
        None => {
            tracing::warn!(%email, "login failed: no such user");
            Err(AppError::Unauthorized)
        }
    }
}

/// POST /api/auth/login — public.
pub async fn login(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<LoginRequest>,
) -> Result<Response> {
    if body.email.is_empty() || body.password.is_empty() {
        return Err(AppError::BadRequest("email and password are required".into()));
    }

    let user = verify_user(&state, &body.email, &body.password).await?;
    tracing::info!(user = %user.email, "login ok");

    let claims = Claims::new(&user.id.to_string(), REALM, state.config.session_hours);
    let token = encode_token(&claims, &state.jwt_secret).map_err(AppError::Internal)?;
    let cookie = session_cookie(
        COOKIE_NAME,
        &token,
        state.config.cookie_secure,
        state.config.session_hours * 3600,
    );

    Ok(([(SET_COOKIE, cookie)], axum::Json(user_body(&user))).into_response())
}

/// POST /api/auth/logout — public (clearing a cookie needs no session).
pub async fn logout(State(state): State<Arc<AppState>>) -> Response {
    (
        [(SET_COOKIE, clear_cookie(COOKIE_NAME, state.config.cookie_secure))],
        axum::Json(serde_json::json!({ "ok": true })),
    )
        .into_response()
}

/// GET /api/auth/me — behind `require_auth`. The cookie is httpOnly, so this is
/// how the SPA learns whether (and as whom) it is logged in.
pub async fn me(State(state): State<Arc<AppState>>, req: Request) -> Result<axum::Json<Value>> {
    let claims = req
        .extensions()
        .get::<Claims>()
        .ok_or(AppError::Unauthorized)?
        .clone();
    let id: Uuid = claims.sub.parse().map_err(|_| AppError::Unauthorized)?;

    let user: User = sqlx::query_as::<_, User>(
        "SELECT id, email, full_name, password_hash, is_active, created_at, updated_at \
         FROM users WHERE id = $1 AND is_active = true",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    Ok(axum::Json(user_body(&user)))
}

/// Requires a valid **user** session (cookie or Bearer). Inserts `Claims` into
/// the request extensions for downstream handlers.
pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    mut req: Request,
    next: Next,
) -> Result<Response> {
    let token = extract_token(req.headers(), COOKIE_NAME).ok_or(AppError::Unauthorized)?;
    let claims =
        decode_token(&token, &state.jwt_secret, REALM).ok_or(AppError::Unauthorized)?;
    req.extensions_mut().insert(claims);
    Ok(next.run(req).await)
}
