//! Database row types shared across handlers.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

/// A cloud-console user (the `/login` realm). `password_hash` is an Argon2id
/// PHC string and is never serialized to the client.
#[derive(Debug, Clone, FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub full_name: Option<String>,
    pub password_hash: String,
    pub is_active: bool,
    // Mapped from the row for completeness; not read yet.
    #[allow(dead_code)]
    pub created_at: DateTime<Utc>,
    #[allow(dead_code)]
    pub updated_at: DateTime<Utc>,
}

/// A platform administrator (the `/admin/login` realm) — a separate table so
/// admin credentials never live alongside customer users.
#[derive(Debug, Clone, FromRow)]
pub struct Admin {
    pub id: Uuid,
    pub email: String,
    pub full_name: Option<String>,
    pub password_hash: String,
    pub is_active: bool,
    #[allow(dead_code)]
    pub created_at: DateTime<Utc>,
}

/// An admin account as listed in the admin console's Settings → Users tab.
/// The serializable subset of `Admin` — no password hash.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct AdminAccount {
    pub id: Uuid,
    pub email: String,
    pub full_name: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

/// An organization through the admin lens — every organization, with its
/// member headcount. Returned by the /api/admin/orgs endpoints.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct AdminOrganization {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub member_count: i64,
    pub created_at: DateTime<Utc>,
}

/// One user's membership in an organization, as shown in the admin console's
/// member list (user identity + their role in that org).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct OrganizationMember {
    pub user_id: Uuid,
    pub email: String,
    pub full_name: Option<String>,
    pub role: String,
    pub is_active: bool,
    pub joined_at: DateTime<Utc>,
}

/// One organization as seen through a member's lens — the org (whose `id` is the
/// `organization_guid` in `/cloud/{organization_guid}`) plus the caller's role
/// within it. Returned by the org-listing endpoints.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct MemberOrganization {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
}

/// Enrollment-token metadata as listed in the console. Never carries the
/// secret — only its Argon2id hash exists server-side, and the full token
/// string is disclosed exactly once at creation.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct EnrollmentTokenMeta {
    pub token_id: String,
    pub label: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub max_uses: Option<i32>,
    pub use_count: i32,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_by_email: Option<String>,
}

/// An enrolled QuartzFire device as shown in the Inventory section. The raw
/// public key stays server-side; the device_id already commits to it.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Device {
    pub device_id: String,
    pub state: String,
    pub hostname: Option<String>,
    pub qf_version: Option<String>,
    pub cert_serial: Option<String>,
    pub cert_not_after: Option<DateTime<Utc>>,
    pub enrolled_at: Option<DateTime<Utc>>,
    pub enrolled_via_token: Option<String>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub last_seen_ip: Option<String>,
}

/// A sub-organization nested under a parent organization (cloud console's
/// Organization Manager). Access derives from membership in the parent, so
/// there is no per-caller role here.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct SubOrganization {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub created_at: DateTime<Utc>,
}
