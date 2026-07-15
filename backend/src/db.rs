use anyhow::{Context, Result};
use sqlx::postgres::{PgPool, PgPoolOptions};

/// Open a connection pool to PostgreSQL and run pending migrations.
///
/// Migrations are embedded at compile time from `./migrations`, so a fresh
/// database is brought up to schema on first boot without a separate step.
pub async fn init(database_url: &str) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
        .context("connecting to PostgreSQL (is DATABASE_URL correct and the server up?)")?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .context("running database migrations")?;

    Ok(pool)
}
