//! Enrollment-token management for the cloud console ("Add device" flow).
//! Org-scoped REST endpoints behind `auth::require_auth`; creating and
//! revoking tokens additionally requires an owner/admin role in the org.
//!
//! The full `QC1|…` token string (containing the plaintext secret) is
//! returned exactly once, from the create call. Only the Argon2id hash of
//! the secret is stored, so it can never be retrieved again.

use axum::{extract::Path, extract::State, Extension, Json};
use rand::RngCore;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    audit,
    console::organizations::{member_org, require_sub_org},
    error::{AppError, Result},
    models::EnrollmentTokenMeta,
    security::{self, Claims},
    AppState,
};

/// Default token lifetime when the caller doesn't pick one.
const DEFAULT_EXPIRES_HOURS: i64 = 24;
/// Hard cap: one year.
const MAX_EXPIRES_HOURS: i64 = 8760;

/// Parse the authenticated user's id out of the session claims.
fn caller_id(claims: &Claims) -> Result<Uuid> {
    claims.sub.parse().map_err(|_| AppError::Unauthorized)
}

/// Owner/admin gate for mutating token/device state. Membership itself is
/// checked first (403 for non-members regardless of org existence).
async fn require_manager(
    state: &Arc<AppState>,
    organization_guid: Uuid,
    uid: Uuid,
) -> Result<()> {
    let org = member_org(state, organization_guid, uid).await?;
    if org.role == "owner" || org.role == "admin" {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// `tok_` + 12 URL-safe chars (lowercase alphanumerics, CSPRNG-chosen).
pub fn generate_token_id() -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let suffix: String = bytes
        .iter()
        .map(|b| ALPHABET[(*b as usize) % ALPHABET.len()] as char)
        .collect();
    format!("tok_{suffix}")
}

/// 32 CSPRNG bytes, base64url without padding — the plaintext secret half.
pub fn generate_secret() -> String {
    use base64::Engine;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Compose the full token string handed to the device:
/// `QC1|<gateway_host:port>|<org_id>|<token_id>.<secret>|sha256:<hex_ca_fp>`
pub fn compose_token_string(
    gateway: &str,
    org_id: Uuid,
    token_id: &str,
    secret: &str,
    ca_fingerprint_hex: &str,
) -> String {
    format!("QC1|{gateway}|{org_id}|{token_id}.{secret}|sha256:{ca_fingerprint_hex}")
}

#[derive(Deserialize)]
pub struct CreateTokenRequest {
    label: Option<String>,
    /// Lifetime in hours; defaults to 24.
    expires_hours: Option<i64>,
    /// Maximum number of enrollments; None = unlimited.
    max_uses: Option<i32>,
    /// Sub-organization devices enrolled via this token are allocated to;
    /// None enrolls into the parent org's unallocated pool.
    sub_org_id: Option<Uuid>,
}

/// POST /api/orgs/:organization_guid/enroll-tokens — owner/admin only.
/// The response's `token` field is shown exactly once.
pub async fn create(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(organization_guid): Path<Uuid>,
    Json(body): Json<CreateTokenRequest>,
) -> Result<Json<serde_json::Value>> {
    let uid = caller_id(&claims)?;
    require_manager(&state, organization_guid, uid).await?;

    let expires_hours = body.expires_hours.unwrap_or(DEFAULT_EXPIRES_HOURS);
    if !(1..=MAX_EXPIRES_HOURS).contains(&expires_hours) {
        return Err(AppError::BadRequest(format!(
            "expires_hours must be between 1 and {MAX_EXPIRES_HOURS}"
        )));
    }
    if body.max_uses.is_some_and(|m| m < 1) {
        return Err(AppError::BadRequest("max_uses must be at least 1".into()));
    }
    let label = body.label.as_deref().map(str::trim).filter(|l| !l.is_empty());
    if let Some(sub) = body.sub_org_id {
        require_sub_org(&state, organization_guid, sub).await?;
    }

    let token_id = generate_token_id();
    let secret = generate_secret();
    let secret_for_hash = secret.clone();
    let secret_hash = tokio::task::spawn_blocking(move || security::hash_password(&secret_for_hash))
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("hash task failed: {e}")))?
        .map_err(AppError::Internal)?;

    let meta: EnrollmentTokenMeta = sqlx::query_as(
        "INSERT INTO enrollment_tokens \
           (token_id, org_id, secret_hash, created_by, expires_at, max_uses, label, sub_org_id) \
         VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5), $6, $7, $8) \
         RETURNING token_id, label, created_at, expires_at, max_uses, use_count, revoked_at, \
                   (SELECT email FROM users WHERE id = created_by) AS created_by_email, \
                   sub_org_id, \
                   (SELECT name FROM organizations WHERE id = sub_org_id) AS sub_org_name",
    )
    .bind(&token_id)
    .bind(organization_guid)
    .bind(&secret_hash)
    .bind(uid)
    .bind(expires_hours as i32)
    .bind(body.max_uses)
    .bind(label)
    .bind(body.sub_org_id)
    .fetch_one(&state.db)
    .await?;

    let token = compose_token_string(
        &state.gateway_addr,
        organization_guid,
        &token_id,
        &secret,
        &state.gateway_ca_fingerprint_hex,
    );

    audit::record(
        &state.db,
        Some(organization_guid),
        &format!("user:{uid}"),
        "token.created",
        json!({ "token_id": token_id, "label": label,
                "expires_hours": expires_hours, "max_uses": body.max_uses,
                "sub_org_id": body.sub_org_id }),
    )
    .await;
    tracing::info!(%token_id, org = %organization_guid, "enrollment token created");

    let mut out = serde_json::to_value(&meta).map_err(|e| AppError::Internal(e.into()))?;
    out["token"] = json!(token); // the one and only disclosure of the secret
    Ok(Json(out))
}

/// GET /api/orgs/:organization_guid/enroll-tokens — metadata only, any member.
pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(organization_guid): Path<Uuid>,
) -> Result<Json<Vec<EnrollmentTokenMeta>>> {
    let uid = caller_id(&claims)?;
    member_org(&state, organization_guid, uid).await?;

    let tokens = sqlx::query_as::<_, EnrollmentTokenMeta>(
        "SELECT t.token_id, t.label, t.created_at, t.expires_at, t.max_uses, t.use_count, \
                t.revoked_at, u.email AS created_by_email, t.sub_org_id, s.name AS sub_org_name \
         FROM enrollment_tokens t \
         LEFT JOIN users u ON u.id = t.created_by \
         LEFT JOIN organizations s ON s.id = t.sub_org_id \
         WHERE t.org_id = $1 ORDER BY t.created_at DESC",
    )
    .bind(organization_guid)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(tokens))
}

/// POST /api/orgs/:organization_guid/enroll-tokens/:token_id/revoke —
/// owner/admin only. Revocation is immediate and permanent.
pub async fn revoke(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((organization_guid, token_id)): Path<(Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    let uid = caller_id(&claims)?;
    require_manager(&state, organization_guid, uid).await?;

    let updated = sqlx::query(
        "UPDATE enrollment_tokens SET revoked_at = now() \
         WHERE token_id = $1 AND org_id = $2 AND revoked_at IS NULL",
    )
    .bind(&token_id)
    .bind(organization_guid)
    .execute(&state.db)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("no such active token".into()));
    }

    audit::record(
        &state.db,
        Some(organization_guid),
        &format!("user:{uid}"),
        "token.revoked",
        json!({ "token_id": token_id }),
    )
    .await;
    tracing::info!(%token_id, org = %organization_guid, "enrollment token revoked");

    Ok(Json(json!({ "ok": true })))
}
