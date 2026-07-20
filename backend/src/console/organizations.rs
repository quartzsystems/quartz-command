//! Organization endpoints for the cloud console. All routes sit behind
//! `auth::require_auth`, so `Extension<Claims>` is always present and carries
//! the authenticated user's id in `sub`.

use axum::{extract::Path, extract::State, Extension, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    models::{DeviceFolder, MemberOrganization, OrganizationMember, SubOrganization},
    security::{self, Claims},
    slug, AppState,
};

/// Parse the authenticated user's id out of the session claims.
fn caller_id(claims: &Claims) -> Result<Uuid> {
    claims.sub.parse().map_err(|_| AppError::Unauthorized)
}

/// The organization, but only if `uid` is a member — the membership check every
/// sub-organization route hangs off. A non-member gets 403 (real tenant
/// isolation on the server), never a leak of whether the org exists.
/// pub(crate): the enrollment-token and device routes gate on it too.
pub(crate) async fn member_org(
    state: &Arc<AppState>,
    organization_guid: Uuid,
    uid: Uuid,
) -> Result<MemberOrganization> {
    sqlx::query_as::<_, MemberOrganization>(
        "SELECT o.id, o.name, o.slug, m.role, o.created_at \
         FROM organizations o \
         JOIN memberships m ON m.organization_id = o.id \
         WHERE o.id = $1 AND m.user_id = $2",
    )
    .bind(organization_guid)
    .bind(uid)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Forbidden)
}

/// Membership plus an owner/admin role — the gate for mutations (allocation,
/// sub-org administration). pub(crate): the device routes gate on it too.
pub(crate) async fn manager_org(
    state: &Arc<AppState>,
    organization_guid: Uuid,
    uid: Uuid,
) -> Result<MemberOrganization> {
    let org = member_org(state, organization_guid, uid).await?;
    if org.role != "owner" && org.role != "admin" {
        return Err(AppError::Forbidden);
    }
    Ok(org)
}

/// The sub-organization, but only if it is actually nested under the given
/// parent — 404 otherwise, so a guid from another tenant can't be used.
/// pub(crate): allocation and token routes validate targets through it.
pub(crate) async fn require_sub_org(
    state: &Arc<AppState>,
    organization_guid: Uuid,
    sub_guid: Uuid,
) -> Result<SubOrganization> {
    sqlx::query_as::<_, SubOrganization>(
        "SELECT id, name, slug, created_at FROM organizations \
         WHERE id = $1 AND parent_organization_id = $2",
    )
    .bind(sub_guid)
    .bind(organization_guid)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("no such sub-organization".into()))
}

/// The folder, but only if it belongs to the given sub-organization — 404
/// otherwise, so a folder id from another sub-org can't be used. The folder
/// analogue of `require_sub_org`. pub(crate): the device folder route uses it.
pub(crate) async fn require_folder(
    state: &Arc<AppState>,
    sub_guid: Uuid,
    folder_id: Uuid,
) -> Result<DeviceFolder> {
    sqlx::query_as::<_, DeviceFolder>(
        "SELECT id, sub_org_id, name, created_at FROM device_folders \
         WHERE id = $1 AND sub_org_id = $2",
    )
    .bind(folder_id)
    .bind(sub_guid)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("no such folder".into()))
}

/// GET /api/orgs — the organizations the caller is a member of, each with the
/// caller's role. Backs the `/cloud` org picker / redirect.
pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<MemberOrganization>>> {
    let uid = caller_id(&claims)?;
    let orgs = sqlx::query_as::<_, MemberOrganization>(
        "SELECT o.id, o.name, o.slug, m.role, o.created_at \
         FROM organizations o \
         JOIN memberships m ON m.organization_id = o.id \
         WHERE m.user_id = $1 \
         ORDER BY o.name",
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(orgs))
}

/// GET /api/orgs/:organization_guid — one organization, members only.
pub async fn get_one(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(organization_guid): Path<Uuid>,
) -> Result<Json<MemberOrganization>> {
    let uid = caller_id(&claims)?;
    let org = member_org(&state, organization_guid, uid).await?;
    Ok(Json(org))
}

// ── Sub-organizations ───────────────────────────────────────────────────────

/// GET /api/orgs/:organization_guid/subs — the sub-organizations under an
/// organization the caller belongs to. Backs the Organization Manager sidebar.
pub async fn list_subs(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(organization_guid): Path<Uuid>,
) -> Result<Json<Vec<SubOrganization>>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;

    let subs = sqlx::query_as::<_, SubOrganization>(
        "SELECT id, name, slug, created_at FROM organizations \
         WHERE parent_organization_id = $1 \
         ORDER BY name",
    )
    .bind(organization_guid)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(subs))
}

#[derive(Deserialize)]
pub struct CreateSubOrgRequest {
    name: String,
}

/// POST /api/orgs/:organization_guid/subs — create a sub-organization under an
/// organization the caller belongs to. The slug is derived from the name
/// (suffixed if taken), never supplied by the caller.
pub async fn create_sub(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(organization_guid): Path<Uuid>,
    Json(body): Json<CreateSubOrgRequest>,
) -> Result<Json<SubOrganization>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;

    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    let sub_slug = slug::unique_slug(&state.db, name, None).await?;

    let sub = sqlx::query_as::<_, SubOrganization>(
        "INSERT INTO organizations (name, slug, parent_organization_id) VALUES ($1, $2, $3) \
         RETURNING id, name, slug, created_at",
    )
    .bind(name)
    .bind(&sub_slug)
    .bind(organization_guid)
    .fetch_one(&state.db)
    .await
    .map_err(|e| slug::on_conflict(e, "an organization with that slug already exists"))?;

    tracing::info!(slug = %sub.slug, parent = %organization_guid, "member created sub-organization");
    Ok(Json(sub))
}

/// GET /api/orgs/:organization_guid/subs/:sub_guid — one sub-organization,
/// gated on membership in the parent. 404 when the sub-org is not under this
/// parent.
pub async fn get_sub(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, sub_guid)): Path<(Uuid, Uuid)>,
) -> Result<Json<SubOrganization>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;
    let sub = require_sub_org(&state, organization_guid, sub_guid).await?;
    Ok(Json(sub))
}

/// DELETE /api/orgs/:organization_guid/subs/:sub_guid — owner/admin of the
/// parent. Memberships on the sub-org cascade away; devices allocated to it
/// return to the parent's unallocated pool (FK is ON DELETE SET NULL).
pub async fn delete_sub(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, sub_guid)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let uid = caller_id(&claims)?;
    manager_org(&state, organization_guid, uid).await?;
    let sub = require_sub_org(&state, organization_guid, sub_guid).await?;

    sqlx::query("DELETE FROM organizations WHERE id = $1 AND parent_organization_id = $2")
        .bind(sub_guid)
        .bind(organization_guid)
        .execute(&state.db)
        .await?;

    tracing::info!(slug = %sub.slug, parent = %organization_guid, "member deleted sub-organization");
    Ok(Json(json!({ "ok": true })))
}

// ── Sub-organization members ────────────────────────────────────────────────
//
// Sub-orgs are organizations rows, so memberships attach to them directly. A
// user whose only membership is a sub-org signs in and sees just that sub-org
// as their organization; managing these members requires owner/admin in the
// parent.

/// GET /api/orgs/:organization_guid/subs/:sub_guid/members — any parent member.
pub async fn list_sub_members(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, sub_guid)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<OrganizationMember>>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;
    require_sub_org(&state, organization_guid, sub_guid).await?;

    let members = sqlx::query_as::<_, OrganizationMember>(
        "SELECT m.user_id, u.email, u.full_name, m.role, u.is_active, m.created_at AS joined_at \
         FROM memberships m \
         JOIN users u ON u.id = m.user_id \
         WHERE m.organization_id = $1 \
         ORDER BY u.email",
    )
    .bind(sub_guid)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(members))
}

/// Roles assignable to a sub-organization member (same set the admin console
/// uses for parent organizations).
const SUB_ROLES: &[&str] = &["owner", "admin", "member"];

#[derive(Deserialize)]
pub struct AddSubMemberRequest {
    email: String,
    full_name: Option<String>,
    /// Required only when the email does not match an existing user (the user
    /// is then created with this password).
    password: Option<String>,
    #[serde(default = "default_member_role")]
    role: String,
}

fn default_member_role() -> String {
    "member".into()
}

/// POST /api/orgs/:organization_guid/subs/:sub_guid/members — owner/admin of
/// the parent. An unknown email creates the user first (password required); a
/// known email just gains the membership (any supplied password is ignored, so
/// this can never silently reset someone's credentials).
pub async fn add_sub_member(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, sub_guid)): Path<(Uuid, Uuid)>,
    Json(body): Json<AddSubMemberRequest>,
) -> Result<Json<OrganizationMember>> {
    let uid = caller_id(&claims)?;
    manager_org(&state, organization_guid, uid).await?;
    require_sub_org(&state, organization_guid, sub_guid).await?;

    let email = body.email.trim().to_string();
    if email.is_empty() || !email.contains('@') {
        return Err(AppError::BadRequest("a valid email is required".into()));
    }
    if !SUB_ROLES.contains(&body.role.as_str()) {
        return Err(AppError::BadRequest(format!(
            "role must be one of: {}",
            SUB_ROLES.join(", ")
        )));
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
            let password = password.to_string();
            let hash = tokio::task::spawn_blocking(move || security::hash_password(&password))
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("hash task failed: {e}")))?
                .map_err(AppError::Internal)?;
            let id: Uuid = sqlx::query_scalar(
                "INSERT INTO users (email, full_name, password_hash) VALUES ($1, $2, $3) RETURNING id",
            )
            .bind(&email)
            .bind(body.full_name.as_deref())
            .bind(hash)
            .fetch_one(&state.db)
            .await
            .map_err(|e| slug::on_conflict(e, "a user with that email already exists"))?;
            tracing::info!(%email, sub = %sub_guid, "member created user for sub-organization");
            id
        }
    };

    sqlx::query(
        "INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3) \
         ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role",
    )
    .bind(user_id)
    .bind(sub_guid)
    .bind(&body.role)
    .execute(&state.db)
    .await?;

    let member = sqlx::query_as::<_, OrganizationMember>(
        "SELECT m.user_id, u.email, u.full_name, m.role, u.is_active, m.created_at AS joined_at \
         FROM memberships m \
         JOIN users u ON u.id = m.user_id \
         WHERE m.organization_id = $1 AND m.user_id = $2",
    )
    .bind(sub_guid)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(member))
}

/// DELETE /api/orgs/:organization_guid/subs/:sub_guid/members/:user_id —
/// owner/admin of the parent. Removes the membership only; the user account
/// itself is untouched.
pub async fn remove_sub_member(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, sub_guid, user_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let uid = caller_id(&claims)?;
    manager_org(&state, organization_guid, uid).await?;
    require_sub_org(&state, organization_guid, sub_guid).await?;

    let deleted = sqlx::query("DELETE FROM memberships WHERE organization_id = $1 AND user_id = $2")
        .bind(sub_guid)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("no such membership".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

// ── Device folders ──────────────────────────────────────────────────────────
//
// Folders group the firewalls allocated to a sub-organization (by location or
// branch). A folder belongs to one sub-org; assigning a device to it lives in
// the device routes. Listing is org-wide (one fetch backs the sidebar tree and
// the sub-org inventory view, which filters client-side); mutations are
// sub-scoped and require owner/admin in the parent, matching allocation.

/// GET /api/orgs/:organization_guid/folders — every folder across the org's
/// sub-organizations. Any parent member.
pub async fn list_folders(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(organization_guid): Path<Uuid>,
) -> Result<Json<Vec<DeviceFolder>>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;

    let folders = sqlx::query_as::<_, DeviceFolder>(
        "SELECT f.id, f.sub_org_id, f.name, f.created_at \
         FROM device_folders f \
         JOIN organizations s ON s.id = f.sub_org_id \
         WHERE s.parent_organization_id = $1 \
         ORDER BY f.name",
    )
    .bind(organization_guid)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(folders))
}

#[derive(Deserialize)]
pub struct FolderRequest {
    name: String,
}

/// POST /api/orgs/:organization_guid/subs/:sub_guid/folders — create a folder in
/// a sub-organization. Owner/admin of the parent.
pub async fn create_folder(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, sub_guid)): Path<(Uuid, Uuid)>,
    Json(body): Json<FolderRequest>,
) -> Result<Json<DeviceFolder>> {
    let uid = caller_id(&claims)?;
    manager_org(&state, organization_guid, uid).await?;
    require_sub_org(&state, organization_guid, sub_guid).await?;

    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }

    let folder = sqlx::query_as::<_, DeviceFolder>(
        "INSERT INTO device_folders (sub_org_id, name) VALUES ($1, $2) \
         RETURNING id, sub_org_id, name, created_at",
    )
    .bind(sub_guid)
    .bind(name)
    .fetch_one(&state.db)
    .await
    .map_err(|e| slug::on_conflict(e, "a folder with that name already exists"))?;

    tracing::info!(folder = %folder.id, sub = %sub_guid, "member created folder");
    Ok(Json(folder))
}

/// PATCH /api/orgs/:organization_guid/subs/:sub_guid/folders/:folder_id — rename
/// a folder. Owner/admin of the parent.
pub async fn rename_folder(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, sub_guid, folder_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<FolderRequest>,
) -> Result<Json<DeviceFolder>> {
    let uid = caller_id(&claims)?;
    manager_org(&state, organization_guid, uid).await?;
    require_sub_org(&state, organization_guid, sub_guid).await?;
    require_folder(&state, sub_guid, folder_id).await?;

    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }

    let folder = sqlx::query_as::<_, DeviceFolder>(
        "UPDATE device_folders SET name = $3 WHERE id = $1 AND sub_org_id = $2 \
         RETURNING id, sub_org_id, name, created_at",
    )
    .bind(folder_id)
    .bind(sub_guid)
    .bind(name)
    .fetch_one(&state.db)
    .await
    .map_err(|e| slug::on_conflict(e, "a folder with that name already exists"))?;

    Ok(Json(folder))
}

/// DELETE /api/orgs/:organization_guid/subs/:sub_guid/folders/:folder_id — delete
/// a folder. Owner/admin of the parent. Its devices return to the sub-org's
/// ungrouped pool (the devices.folder_id FK is ON DELETE SET NULL).
pub async fn delete_folder(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, sub_guid, folder_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let uid = caller_id(&claims)?;
    manager_org(&state, organization_guid, uid).await?;
    require_sub_org(&state, organization_guid, sub_guid).await?;

    let deleted = sqlx::query("DELETE FROM device_folders WHERE id = $1 AND sub_org_id = $2")
        .bind(folder_id)
        .bind(sub_guid)
        .execute(&state.db)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("no such folder".into()));
    }

    tracing::info!(folder = %folder_id, sub = %sub_guid, "member deleted folder");
    Ok(Json(json!({ "ok": true })))
}
