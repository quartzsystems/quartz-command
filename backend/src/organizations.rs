//! Organization endpoints for the cloud console. All routes sit behind
//! `auth::require_auth`, so `Extension<Claims>` is always present and carries
//! the authenticated user's id in `sub`.

use axum::{extract::Path, extract::State, Extension, Json};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    models::MemberOrganization,
    security::Claims,
    AppState,
};

/// Parse the authenticated user's id out of the session claims.
fn caller_id(claims: &Claims) -> Result<Uuid> {
    claims.sub.parse().map_err(|_| AppError::Unauthorized)
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

/// GET /api/orgs/:organization_guid — one organization, but only if the caller
/// is a member. A non-member gets 403 (real tenant isolation on the server),
/// never a leak of whether the org exists.
pub async fn get_one(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(organization_guid): Path<Uuid>,
) -> Result<Json<MemberOrganization>> {
    let uid = caller_id(&claims)?;
    let org = sqlx::query_as::<_, MemberOrganization>(
        "SELECT o.id, o.name, o.slug, m.role, o.created_at \
         FROM organizations o \
         JOIN memberships m ON m.organization_id = o.id \
         WHERE o.id = $1 AND m.user_id = $2",
    )
    .bind(organization_guid)
    .bind(uid)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Forbidden)?;

    Ok(Json(org))
}
