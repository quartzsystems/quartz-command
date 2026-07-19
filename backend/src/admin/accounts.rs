//! Admin-account management for the admin console's Settings → Users tab.
//! All routes sit behind `admin::auth::require_admin`. Two guards keep the
//! console from locking itself out: an admin can never delete or deactivate
//! their own account, and the last active admin can never be removed.

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    models::AdminAccount,
    security::{self, Claims},
    AppState,
};

const COLUMNS: &str = "id, email, full_name, is_active, created_at";

fn caller_id(claims: &Claims) -> Result<Uuid> {
    claims.sub.parse().map_err(|_| AppError::Unauthorized)
}

/// Map a unique-constraint violation (Postgres 23505) onto a friendly 400.
fn on_conflict(e: sqlx::Error, msg: &str) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        if db.code().as_deref() == Some("23505") {
            return AppError::BadRequest(msg.into());
        }
    }
    e.into()
}

/// Hash a password off the async runtime (Argon2id is deliberately slow).
async fn hash_password_blocking(password: String) -> Result<String> {
    tokio::task::spawn_blocking(move || security::hash_password(&password))
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("hash task failed: {e}")))?
        .map_err(AppError::Internal)
}

/// True when `admin_id` is the only active admin left.
async fn is_last_active_admin(state: &Arc<AppState>, admin_id: Uuid) -> Result<bool> {
    let others: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM admins WHERE is_active = true AND id <> $1",
    )
    .bind(admin_id)
    .fetch_one(&state.db)
    .await?;
    Ok(others == 0)
}

/// GET /api/admin/admins — every admin account.
pub async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Vec<AdminAccount>>> {
    let admins = sqlx::query_as::<_, AdminAccount>(&format!(
        "SELECT {COLUMNS} FROM admins ORDER BY email"
    ))
    .fetch_all(&state.db)
    .await?;
    Ok(Json(admins))
}

#[derive(Deserialize)]
pub struct CreateAdminRequest {
    email: String,
    full_name: Option<String>,
    password: String,
}

/// POST /api/admin/admins — create an admin account.
pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateAdminRequest>,
) -> Result<Json<AdminAccount>> {
    let email = body.email.trim().to_string();
    if email.is_empty() || !email.contains('@') {
        return Err(AppError::BadRequest("a valid email is required".into()));
    }
    if body.password.len() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }

    let hash = hash_password_blocking(body.password).await?;
    let admin = sqlx::query_as::<_, AdminAccount>(&format!(
        "INSERT INTO admins (email, full_name, password_hash) VALUES ($1, $2, $3) \
         RETURNING {COLUMNS}"
    ))
    .bind(&email)
    .bind(body.full_name.as_deref().map(str::trim).filter(|n| !n.is_empty()))
    .bind(hash)
    .fetch_one(&state.db)
    .await
    .map_err(|e| on_conflict(e, "an admin with that email already exists"))?;

    tracing::info!(%email, "created admin account");
    Ok(Json(admin))
}

#[derive(Deserialize)]
pub struct UpdateAdminRequest {
    full_name: Option<String>,
    /// When set, resets the admin's password.
    password: Option<String>,
    is_active: Option<bool>,
}

/// PATCH /api/admin/admins/:admin_id — edit an admin account. Only the
/// supplied fields change.
pub async fn update(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(admin_id): Path<Uuid>,
    Json(body): Json<UpdateAdminRequest>,
) -> Result<Json<AdminAccount>> {
    if body.is_active == Some(false) {
        if admin_id == caller_id(&claims)? {
            return Err(AppError::BadRequest(
                "you can't deactivate the account you're signed in as".into(),
            ));
        }
        if is_last_active_admin(&state, admin_id).await? {
            return Err(AppError::BadRequest(
                "the last active admin can't be deactivated".into(),
            ));
        }
    }

    let password_hash = match body.password.as_deref() {
        Some(pw) if pw.len() < 8 => {
            return Err(AppError::BadRequest(
                "password must be at least 8 characters".into(),
            ))
        }
        Some(pw) => Some(hash_password_blocking(pw.to_string()).await?),
        None => None,
    };

    // Trimmed-empty full_name clears the display name.
    let full_name = body.full_name.as_deref().map(|n| n.trim().to_string());

    let admin = sqlx::query_as::<_, AdminAccount>(&format!(
        "UPDATE admins SET \
             full_name = CASE WHEN $2::text IS NULL THEN full_name \
                              WHEN $2 = '' THEN NULL ELSE $2 END, \
             password_hash = COALESCE($3, password_hash), \
             is_active = COALESCE($4, is_active) \
         WHERE id = $1 \
         RETURNING {COLUMNS}"
    ))
    .bind(admin_id)
    .bind(full_name)
    .bind(password_hash)
    .bind(body.is_active)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("no such admin".into()))?;

    Ok(Json(admin))
}

/// DELETE /api/admin/admins/:admin_id — delete an admin account.
pub async fn delete(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(admin_id): Path<Uuid>,
) -> Result<Json<Value>> {
    if admin_id == caller_id(&claims)? {
        return Err(AppError::BadRequest(
            "you can't delete the account you're signed in as".into(),
        ));
    }
    if is_last_active_admin(&state, admin_id).await? {
        return Err(AppError::BadRequest(
            "the last active admin can't be deleted".into(),
        ));
    }

    let deleted = sqlx::query("DELETE FROM admins WHERE id = $1")
        .bind(admin_id)
        .execute(&state.db)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("no such admin".into()));
    }
    tracing::info!(%admin_id, "deleted admin account");
    Ok(Json(json!({ "ok": true })))
}
