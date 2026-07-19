//! Organization endpoints for the cloud console. All routes sit behind
//! `auth::require_auth`, so `Extension<Claims>` is always present and carries
//! the authenticated user's id in `sub`.

use axum::{extract::Path, extract::State, Extension, Json};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    models::{MemberOrganization, SubOrganization},
    security::Claims,
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

    let sub = sqlx::query_as::<_, SubOrganization>(
        "SELECT id, name, slug, created_at FROM organizations \
         WHERE id = $1 AND parent_organization_id = $2",
    )
    .bind(sub_guid)
    .bind(organization_guid)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("no such sub-organization".into()))?;

    Ok(Json(sub))
}
