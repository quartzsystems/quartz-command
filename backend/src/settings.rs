//! Instance-wide settings stored in `server_settings` and editable from the
//! admin console. Each key overrides an env-derived default from [`Config`],
//! so a packaged install works out of the box and an admin can correct the
//! values later without shelling into the host.

use sqlx::PgPool;

use crate::config::Config;

/// Public `host:port` devices reach the gRPC gateway at — embedded in
/// enrollment tokens and returned as `assigned_gateway`. Overrides
/// `QC_GATEWAY_ADDR`.
pub const GATEWAY_ADDR: &str = "gateway_addr";

pub async fn get(db: &PgPool, key: &str) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar("SELECT value FROM server_settings WHERE key = $1")
        .bind(key)
        .fetch_optional(db)
        .await
}

pub async fn set(db: &PgPool, key: &str, value: &str) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO server_settings (key, value) VALUES ($1, $2) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(key)
    .bind(value)
    .execute(db)
    .await?;
    Ok(())
}

/// Remove an override, falling back to the env-derived default.
pub async fn unset(db: &PgPool, key: &str) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM server_settings WHERE key = $1")
        .bind(key)
        .execute(db)
        .await?;
    Ok(())
}

/// Effective gateway address: the admin-set override, else the config value.
pub async fn gateway_addr(db: &PgPool, config: &Config) -> sqlx::Result<String> {
    Ok(get(db, GATEWAY_ADDR)
        .await?
        .unwrap_or_else(|| config.gateway_addr.clone()))
}
