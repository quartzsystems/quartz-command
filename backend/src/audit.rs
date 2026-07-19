//! Audit trail + org event helpers for the enrollment/PKI surface.
//!
//! Audit writes are best-effort: a failed insert is logged loudly but never
//! fails the operation being audited (an enrollment must not break because
//! the audit table hiccuped).

use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

/// Append an audit entry. `actor` is `"user:<uuid>"`, `"device:<id>"`, or
/// `"system"`; `org_id` is None when the event can't be tied to an org (e.g.
/// enrollment against an unknown token).
pub async fn record(db: &PgPool, org_id: Option<Uuid>, actor: &str, action: &str, details: Value) {
    let res = sqlx::query(
        "INSERT INTO audit_log (org_id, actor, action, details) VALUES ($1, $2, $3, $4)",
    )
    .bind(org_id)
    .bind(actor)
    .bind(action)
    .bind(&details)
    .execute(db)
    .await;
    if let Err(e) = res {
        tracing::error!(action, ?details, "audit write failed: {e}");
    }
}

/// Raise an org-visible event (first pass of a notification system).
/// `severity` is one of `info` / `warning` / `critical` (schema-enforced).
pub async fn raise_event(db: &PgPool, org_id: Uuid, severity: &str, title: &str, details: Value) {
    let res = sqlx::query(
        "INSERT INTO org_events (org_id, severity, title, details) VALUES ($1, $2, $3, $4)",
    )
    .bind(org_id)
    .bind(severity)
    .bind(title)
    .bind(&details)
    .execute(db)
    .await;
    if let Err(e) = res {
        tracing::error!(title, %org_id, "org event write failed: {e}");
    }
}
