//! Read endpoints for the dashboard's event feed and Recent Activity card:
//! org events (`org_events`) and the audit trail (`audit_log`). Org-scoped,
//! any member, newest first. Both tables were previously write-only.

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    console::organizations::member_org,
    error::{AppError, Result},
    models::{AuditEntry, OrgEvent},
    security::Claims,
    AppState,
};

fn caller_id(claims: &Claims) -> Result<Uuid> {
    claims.sub.parse().map_err(|_| AppError::Unauthorized)
}

#[derive(Deserialize)]
pub struct FeedQuery {
    /// Max rows to return; default 50, capped at 200.
    pub limit: Option<i64>,
}

fn cap(limit: Option<i64>) -> i64 {
    limit.unwrap_or(50).clamp(1, 200)
}

/// GET /api/orgs/:organization_guid/events — any member. The org's operational
/// events (device online/offline, clone warnings, …), newest first.
pub async fn list_events(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(organization_guid): Path<Uuid>,
    Query(q): Query<FeedQuery>,
) -> Result<Json<Vec<OrgEvent>>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;

    let rows = sqlx::query_as::<_, OrgEvent>(
        "SELECT id, severity, title, details, created_at \
         FROM org_events WHERE org_id = $1 \
         ORDER BY created_at DESC LIMIT $2",
    )
    .bind(organization_guid)
    .bind(cap(q.limit))
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

/// GET /api/orgs/:organization_guid/audit — any member. The org's audit trail
/// (who did what: enrollments, revocations, tokens, …), newest first.
pub async fn list_audit(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(organization_guid): Path<Uuid>,
    Query(q): Query<FeedQuery>,
) -> Result<Json<Vec<AuditEntry>>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;

    let rows = sqlx::query_as::<_, AuditEntry>(
        "SELECT id, actor, action, details, created_at \
         FROM audit_log WHERE org_id = $1 \
         ORDER BY created_at DESC LIMIT $2",
    )
    .bind(organization_guid)
    .bind(cap(q.limit))
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}
