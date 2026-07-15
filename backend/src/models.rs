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
