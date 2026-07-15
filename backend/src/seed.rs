//! Developer seeding subcommands so the auth scaffold is testable without a
//! signup flow. Passwords are read from the terminal with no echo and stored as
//! Argon2id hashes. Invoked as `quartz-command seed-user …`, etc.

use anyhow::{bail, Context, Result};
use sqlx::PgPool;
use uuid::Uuid;

use crate::security::hash_password;

/// Obtain a password for a seed command. Prefers `QC_SEED_PASSWORD` (for
/// scripting / CI) and otherwise prompts twice on the terminal (no echo).
fn prompt_password(label: &str) -> Result<String> {
    if let Ok(pw) = std::env::var("QC_SEED_PASSWORD") {
        if pw.is_empty() {
            bail!("QC_SEED_PASSWORD is set but empty");
        }
        return Ok(pw);
    }
    let pw = rpassword::prompt_password(format!("{label}: "))?;
    if pw.is_empty() {
        bail!("password must not be empty");
    }
    let again = rpassword::prompt_password("Confirm password: ")?;
    if pw != again {
        bail!("passwords did not match");
    }
    Ok(pw)
}

/// `seed-user <email> [full_name]` — create (or update the password of) a user.
pub async fn seed_user(pool: &PgPool, email: &str, full_name: Option<&str>) -> Result<()> {
    let password = prompt_password("New user password")?;
    let hash = hash_password(&password)?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, full_name, password_hash) VALUES ($1, $2, $3) \
         ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, \
             full_name = EXCLUDED.full_name, is_active = true, updated_at = now() \
         RETURNING id",
    )
    .bind(email)
    .bind(full_name)
    .bind(hash)
    .fetch_one(pool)
    .await
    .context("inserting user")?;
    println!("user ready: {email} ({id})");
    Ok(())
}

/// `seed-admin <email> [full_name]` — create (or update the password of) an admin.
pub async fn seed_admin(pool: &PgPool, email: &str, full_name: Option<&str>) -> Result<()> {
    let password = prompt_password("New admin password")?;
    let hash = hash_password(&password)?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO admins (email, full_name, password_hash) VALUES ($1, $2, $3) \
         ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, \
             full_name = EXCLUDED.full_name, is_active = true \
         RETURNING id",
    )
    .bind(email)
    .bind(full_name)
    .bind(hash)
    .fetch_one(pool)
    .await
    .context("inserting admin")?;
    println!("admin ready: {email} ({id})");
    Ok(())
}

/// Seed a default admin from config **only when the `admins` table is empty**,
/// so a fresh deploy has a usable `/admin/login` without a manual step. A no-op
/// once any admin exists (it never overwrites), and when the env vars are unset.
pub async fn bootstrap_default_admin(
    pool: &PgPool,
    email: Option<&str>,
    password: Option<&str>,
) -> Result<()> {
    let (Some(email), Some(password)) = (email, password) else {
        return Ok(());
    };

    let existing: i64 = sqlx::query_scalar("SELECT count(*) FROM admins")
        .fetch_one(pool)
        .await?;
    if existing > 0 {
        return Ok(());
    }

    let hash = hash_password(password)?;
    sqlx::query(
        "INSERT INTO admins (email, full_name, password_hash) VALUES ($1, $2, $3) \
         ON CONFLICT DO NOTHING",
    )
    .bind(email)
    .bind("Default Admin")
    .bind(hash)
    .execute(pool)
    .await
    .context("seeding default admin")?;
    tracing::info!(%email, "seeded default admin (admins table was empty)");
    Ok(())
}

/// `seed-org <name> <slug>` — create an organization, printing its guid.
pub async fn seed_org(pool: &PgPool, name: &str, slug: &str) -> Result<()> {
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO organizations (name, slug) VALUES ($1, $2) \
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id",
    )
    .bind(name)
    .bind(slug)
    .fetch_one(pool)
    .await
    .context("inserting organization")?;
    println!("org ready: {slug} — guid {id}");
    Ok(())
}

/// `add-member <user_email> <org_slug> [role]` — add a membership (default role
/// `member`). Idempotent on the (user, org) pair.
pub async fn add_member(pool: &PgPool, user_email: &str, org_slug: &str, role: &str) -> Result<()> {
    let user_id: Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE lower(email) = lower($1)")
            .bind(user_email)
            .fetch_optional(pool)
            .await?
            .with_context(|| format!("no such user: {user_email}"))?;
    let org_id: Uuid = sqlx::query_scalar("SELECT id FROM organizations WHERE slug = $1")
        .bind(org_slug)
        .fetch_optional(pool)
        .await?
        .with_context(|| format!("no such org: {org_slug}"))?;

    sqlx::query(
        "INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3) \
         ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role",
    )
    .bind(user_id)
    .bind(org_id)
    .bind(role)
    .execute(pool)
    .await
    .context("inserting membership")?;
    println!("membership ready: {user_email} → {org_slug} ({role})");
    Ok(())
}
