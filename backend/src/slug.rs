//! Organization slug derivation, shared by the admin console and the member
//! (cloud console) creation paths.

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::{AppError, Result};

/// Derive a URL/DNS-ish slug from an organization name: lowercase
/// alphanumerics with hyphens between word runs, capped at 63 chars.
fn slugify(name: &str) -> String {
    let mut s = String::new();
    let mut pending_hyphen = false;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            if pending_hyphen && !s.is_empty() {
                s.push('-');
            }
            pending_hyphen = false;
            s.push(c.to_ascii_lowercase());
        } else {
            pending_hyphen = true;
        }
    }
    s.truncate(63);
    while s.ends_with('-') {
        s.pop();
    }
    if s.is_empty() {
        // Name had no ASCII alphanumerics at all — fall back to something valid.
        s.push_str("org");
    }
    s
}

/// First free slug for `name`: the plain slugified form, then `-2`, `-3`, ….
/// `exclude` keeps an org's own slug counting as free when renaming it.
pub async fn unique_slug(pool: &PgPool, name: &str, exclude: Option<Uuid>) -> Result<String> {
    let base = slugify(name);
    for n in 1u32..=1000 {
        let candidate = if n == 1 {
            base.clone()
        } else {
            // Keep the suffixed form within the 63-char cap.
            let suffix = format!("-{n}");
            let mut trimmed = base.clone();
            trimmed.truncate(63 - suffix.len());
            while trimmed.ends_with('-') {
                trimmed.pop();
            }
            format!("{trimmed}{suffix}")
        };
        let taken: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM organizations WHERE slug = $1 \
                 AND ($2::uuid IS NULL OR id <> $2))",
        )
        .bind(&candidate)
        .bind(exclude)
        .fetch_one(pool)
        .await?;
        if !taken {
            return Ok(candidate);
        }
    }
    Err(AppError::Internal(anyhow::anyhow!(
        "could not find a free slug for {name:?}"
    )))
}

/// Map a unique-constraint violation (Postgres 23505) onto a friendly 400.
pub fn on_conflict(e: sqlx::Error, msg: &str) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        if db.code().as_deref() == Some("23505") {
            return AppError::BadRequest(msg.into());
        }
    }
    e.into()
}
