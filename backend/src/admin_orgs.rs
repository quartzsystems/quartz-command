//! Organization + user management for the admin console. All routes sit
//! behind `admin_auth::require_admin`, so callers are platform administrators;
//! there is no tenant scoping here — admins see every organization.

use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    models::{AdminOrganization, OrganizationMember},
    security,
    slug::{on_conflict, unique_slug},
    AppState,
};

/// Roles an admin can assign within an organization. The column is free text
/// (the seed CLI accepts anything), but the console keeps to a known set.
const ROLES: &[&str] = &["owner", "admin", "member"];

fn validate_role(role: &str) -> Result<()> {
    if ROLES.contains(&role) {
        return Ok(());
    }
    Err(AppError::BadRequest(format!(
        "role must be one of: {}",
        ROLES.join(", ")
    )))
}

/// Hash a password off the async runtime (Argon2id is deliberately slow).
async fn hash_password_blocking(password: String) -> Result<String> {
    tokio::task::spawn_blocking(move || security::hash_password(&password))
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("hash task failed: {e}")))?
        .map_err(AppError::Internal)
}

// ── Overview ────────────────────────────────────────────────────────────────

/// GET /api/admin/overview — platform-wide counts for the dashboard tiles.
pub async fn overview(State(state): State<Arc<AppState>>) -> Result<Json<Value>> {
    let (organizations, users, admins): (i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM organizations), \
                (SELECT count(*) FROM users), \
                (SELECT count(*) FROM admins)",
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "organizations": organizations,
        "users": users,
        "admins": admins,
    })))
}

// ── Organizations ───────────────────────────────────────────────────────────

/// GET /api/admin/orgs — every organization with its member count.
pub async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Vec<AdminOrganization>>> {
    let orgs = sqlx::query_as::<_, AdminOrganization>(
        "SELECT o.id, o.name, o.slug, count(m.user_id) AS member_count, o.created_at \
         FROM organizations o \
         LEFT JOIN memberships m ON m.organization_id = o.id \
         GROUP BY o.id \
         ORDER BY o.name",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(orgs))
}

#[derive(Deserialize)]
pub struct CreateOrgRequest {
    name: String,
}

/// POST /api/admin/orgs — create an organization. The slug is derived from the
/// name (suffixed if taken), never supplied by the caller.
pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateOrgRequest>,
) -> Result<Json<AdminOrganization>> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    let slug = unique_slug(&state.db, name, None).await?;

    let org = sqlx::query_as::<_, AdminOrganization>(
        "INSERT INTO organizations (name, slug) VALUES ($1, $2) \
         RETURNING id, name, slug, 0::bigint AS member_count, created_at",
    )
    .bind(name)
    .bind(&slug)
    .fetch_one(&state.db)
    .await
    .map_err(|e| on_conflict(e, "an organization with that slug already exists"))?;

    tracing::info!(slug = %org.slug, "admin created organization");
    Ok(Json(org))
}

/// GET /api/admin/orgs/:organization_guid — one organization plus its members.
pub async fn get_one(
    State(state): State<Arc<AppState>>,
    Path(organization_guid): Path<Uuid>,
) -> Result<Json<Value>> {
    let org = sqlx::query_as::<_, AdminOrganization>(
        "SELECT o.id, o.name, o.slug, count(m.user_id) AS member_count, o.created_at \
         FROM organizations o \
         LEFT JOIN memberships m ON m.organization_id = o.id \
         WHERE o.id = $1 \
         GROUP BY o.id",
    )
    .bind(organization_guid)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("no such organization".into()))?;

    let members = sqlx::query_as::<_, OrganizationMember>(
        "SELECT m.user_id, u.email, u.full_name, m.role, u.is_active, m.created_at AS joined_at \
         FROM memberships m \
         JOIN users u ON u.id = m.user_id \
         WHERE m.organization_id = $1 \
         ORDER BY u.email",
    )
    .bind(organization_guid)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "organization": org, "members": members })))
}

#[derive(Deserialize)]
pub struct UpdateOrgRequest {
    name: String,
}

/// PATCH /api/admin/orgs/:organization_guid — rename. The slug follows the
/// new name automatically (suffixed if the plain form is taken by another org).
pub async fn update(
    State(state): State<Arc<AppState>>,
    Path(organization_guid): Path<Uuid>,
    Json(body): Json<UpdateOrgRequest>,
) -> Result<Json<AdminOrganization>> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name must not be empty".into()));
    }
    let slug = unique_slug(&state.db, name, Some(organization_guid)).await?;

    let org = sqlx::query_as::<_, AdminOrganization>(
        "UPDATE organizations SET name = $2, slug = $3 \
         WHERE id = $1 \
         RETURNING id, name, slug, \
             (SELECT count(*) FROM memberships m WHERE m.organization_id = id) AS member_count, \
             created_at",
    )
    .bind(organization_guid)
    .bind(name)
    .bind(&slug)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| on_conflict(e, "an organization with that slug already exists"))?
    .ok_or_else(|| AppError::NotFound("no such organization".into()))?;

    Ok(Json(org))
}

/// DELETE /api/admin/orgs/:organization_guid — delete an organization. Its
/// memberships cascade away (schema FK); user accounts are untouched.
pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(organization_guid): Path<Uuid>,
) -> Result<Json<Value>> {
    let deleted = sqlx::query("DELETE FROM organizations WHERE id = $1")
        .bind(organization_guid)
        .execute(&state.db)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("no such organization".into()));
    }
    tracing::info!(%organization_guid, "admin deleted organization");
    Ok(Json(json!({ "ok": true })))
}

// ── Members ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AddMemberRequest {
    email: String,
    full_name: Option<String>,
    /// Required only when the email does not match an existing user (the user
    /// is then created with this password).
    password: Option<String>,
    #[serde(default = "default_role")]
    role: String,
}

fn default_role() -> String {
    "member".into()
}

/// POST /api/admin/orgs/:organization_guid/members — add a user to the
/// organization. An unknown email creates the user first (password required);
/// a known email just gains the membership (any supplied password is ignored,
/// so this can never silently reset someone's credentials).
pub async fn add_member(
    State(state): State<Arc<AppState>>,
    Path(organization_guid): Path<Uuid>,
    Json(body): Json<AddMemberRequest>,
) -> Result<Json<OrganizationMember>> {
    let email = body.email.trim().to_string();
    if email.is_empty() || !email.contains('@') {
        return Err(AppError::BadRequest("a valid email is required".into()));
    }
    validate_role(&body.role)?;

    let org_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM organizations WHERE id = $1)")
        .bind(organization_guid)
        .fetch_one(&state.db)
        .await?;
    if !org_exists {
        return Err(AppError::NotFound("no such organization".into()));
    }

    let existing: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE lower(email) = lower($1)")
            .bind(&email)
            .fetch_optional(&state.db)
            .await?;

    let user_id = match existing {
        Some(id) => id,
        None => {
            let password = body.password.as_deref().unwrap_or("");
            if password.len() < 8 {
                return Err(AppError::BadRequest(
                    "no user with that email exists — provide a password (min 8 characters) to create them"
                        .into(),
                ));
            }
            let hash = hash_password_blocking(password.to_string()).await?;
            let id: Uuid = sqlx::query_scalar(
                "INSERT INTO users (email, full_name, password_hash) VALUES ($1, $2, $3) RETURNING id",
            )
            .bind(&email)
            .bind(body.full_name.as_deref())
            .bind(hash)
            .fetch_one(&state.db)
            .await
            .map_err(|e| on_conflict(e, "a user with that email already exists"))?;
            tracing::info!(%email, "admin created user");
            id
        }
    };

    sqlx::query(
        "INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3) \
         ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role",
    )
    .bind(user_id)
    .bind(organization_guid)
    .bind(&body.role)
    .execute(&state.db)
    .await?;

    let member = fetch_member(&state, organization_guid, user_id).await?;
    Ok(Json(member))
}

#[derive(Deserialize)]
pub struct UpdateMemberRequest {
    role: Option<String>,
    full_name: Option<String>,
    /// When set, resets the user's password.
    password: Option<String>,
    is_active: Option<bool>,
}

/// PATCH /api/admin/orgs/:organization_guid/members/:user_id — edit a member:
/// their role in this org, and/or their user account (display name, password
/// reset, active flag). Only the supplied fields change.
pub async fn update_member(
    State(state): State<Arc<AppState>>,
    Path((organization_guid, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateMemberRequest>,
) -> Result<Json<OrganizationMember>> {
    // Confirm the membership up front so a bad id can't edit an unrelated user.
    fetch_member(&state, organization_guid, user_id).await?;

    if let Some(role) = body.role.as_deref() {
        validate_role(role)?;
        sqlx::query("UPDATE memberships SET role = $3 WHERE organization_id = $1 AND user_id = $2")
            .bind(organization_guid)
            .bind(user_id)
            .bind(role)
            .execute(&state.db)
            .await?;
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
    let full_name = body
        .full_name
        .as_deref()
        .map(|n| n.trim().to_string());

    sqlx::query(
        "UPDATE users SET \
             full_name = CASE WHEN $2::text IS NULL THEN full_name \
                              WHEN $2 = '' THEN NULL ELSE $2 END, \
             password_hash = COALESCE($3, password_hash), \
             is_active = COALESCE($4, is_active), \
             updated_at = now() \
         WHERE id = $1",
    )
    .bind(user_id)
    .bind(full_name)
    .bind(password_hash)
    .bind(body.is_active)
    .execute(&state.db)
    .await?;

    let member = fetch_member(&state, organization_guid, user_id).await?;
    Ok(Json(member))
}

/// DELETE /api/admin/orgs/:organization_guid/members/:user_id — remove a user
/// from the organization (the user account itself is untouched).
pub async fn remove_member(
    State(state): State<Arc<AppState>>,
    Path((organization_guid, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let deleted = sqlx::query("DELETE FROM memberships WHERE organization_id = $1 AND user_id = $2")
        .bind(organization_guid)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("no such membership".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

/// One member row (used as the response of the member mutations).
async fn fetch_member(
    state: &Arc<AppState>,
    organization_guid: Uuid,
    user_id: Uuid,
) -> Result<OrganizationMember> {
    let member = sqlx::query_as::<_, OrganizationMember>(
        "SELECT m.user_id, u.email, u.full_name, m.role, u.is_active, m.created_at AS joined_at \
         FROM memberships m \
         JOIN users u ON u.id = m.user_id \
         WHERE m.organization_id = $1 AND m.user_id = $2",
    )
    .bind(organization_guid)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("no such membership".into()))?;
    Ok(member)
}
