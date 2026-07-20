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
    /// Sub-organization the token enrolls devices into (NULL = parent org).
    pub sub_org_id: Option<Uuid>,
    pub sub_org_name: Option<String>,
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
    /// Sub-organization the device is allocated to (NULL = unallocated, i.e.
    /// sitting in the parent organization's pool).
    pub sub_org_id: Option<Uuid>,
    pub sub_org_name: Option<String>,
    /// Folder within the sub-organization the device is grouped into (NULL =
    /// ungrouped). Always belongs to `sub_org_id`; cleared on allocation change.
    pub folder_id: Option<Uuid>,
    pub folder_name: Option<String>,
    /// Whether the device has a live control stream to the gateway right now.
    /// Not a DB column — the list handler fills it from the in-memory device
    /// registry, so it defaults to false when absent from the row.
    #[sqlx(default)]
    pub connected: bool,
}

/// A folder that groups firewalls within a single sub-organization (e.g. by
/// location or branch). Purely organizational — it never changes a device's
/// allocation. Access derives from membership in the parent organization.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct DeviceFolder {
    pub id: Uuid,
    pub sub_org_id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

/// The latest security-service telemetry snapshot a device pushed over its
/// control stream. Counters are cumulative (Prometheus-counter semantics);
/// `sub_org_id` (from the device row) lets the console scope/aggregate per
/// sub-organization. Serialized to the Monitor → Summary security cards.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct DeviceSecurityTelemetry {
    pub device_id: String,
    pub sub_org_id: Option<Uuid>,
    /// Device wall-clock of the snapshot (epoch seconds).
    pub time_unix: i64,

    pub ips_enabled: bool,
    pub ips_prevented: i64,
    pub ips_detected: i64,
    pub ips_scans: i64,
    pub ips_scans_available: bool,

    pub ac_enabled: bool,
    pub ac_blocked: i64,
    pub ac_detected: i64,
    pub ac_total_requests: i64,

    pub geo_enabled: bool,
    pub geo_blocked: i64,
    pub geo_connections: i64,
    pub geo_countries_blocked: i32,

    pub cf_enabled: bool,
    pub cf_blocked: i64,
    pub cf_allowed: i64,
    pub cf_total_requests: i64,

    pub received_at: DateTime<Utc>,
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
