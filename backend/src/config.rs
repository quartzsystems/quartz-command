use anyhow::{Context, Result};
use std::path::PathBuf;

/// Runtime configuration, loaded from the environment (12-factor style — this
/// is a cloud service, not an appliance). A `.env` file, if present, is not
/// read by us; use the shell/orchestrator to export these.
#[derive(Debug, Clone)]
pub struct Config {
    /// PostgreSQL connection string (`postgres://user:pass@host/db`).
    pub database_url: String,

    /// Address the axum server binds to. A reverse proxy (or the Next.js dev
    /// rewrite) fronts this and terminates TLS.
    pub listen: String,

    /// File holding the JWT signing secret for the **user** realm. Generated on
    /// first start if absent. Distinct from the admin secret so a user token can
    /// never satisfy admin auth.
    pub jwt_secret_file: PathBuf,

    /// File holding the JWT signing secret for the **admin** realm.
    pub admin_jwt_secret_file: PathBuf,

    /// Mark session cookies `Secure` (HTTPS-only). True in production; set
    /// `QC_COOKIE_SECURE=false` for plain-HTTP local dev.
    pub cookie_secure: bool,

    /// Session (JWT + cookie) lifetime in hours.
    pub session_hours: u64,

    /// Optional default admin, seeded on startup **only when the `admins` table
    /// is empty** (see `seed::bootstrap_default_admin`). Lets a fresh deploy
    /// come up with a usable `/admin/login` without a manual seed step.
    pub default_admin_email: Option<String>,
    pub default_admin_password: Option<String>,
}

impl Config {
    /// Load configuration from environment variables, applying dev-friendly
    /// defaults where reasonable. `DATABASE_URL` is required.
    pub fn from_env() -> Result<Self> {
        let database_url = std::env::var("DATABASE_URL")
            .context("DATABASE_URL must be set (e.g. postgres://quartz:quartz@localhost/quartz_command)")?;

        let listen = std::env::var("QC_LISTEN").unwrap_or_else(|_| "127.0.0.1:8080".to_string());

        let jwt_secret_file = std::env::var("QC_JWT_SECRET_FILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data/jwt.secret"));
        let admin_jwt_secret_file = std::env::var("QC_ADMIN_JWT_SECRET_FILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data/admin-jwt.secret"));

        let cookie_secure = std::env::var("QC_COOKIE_SECURE")
            .map(|v| !matches!(v.trim().to_ascii_lowercase().as_str(), "false" | "0" | "no"))
            .unwrap_or(true);

        let session_hours = std::env::var("QC_SESSION_HOURS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(24);

        let non_empty = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        let default_admin_email = non_empty("QC_DEFAULT_ADMIN_EMAIL");
        let default_admin_password = non_empty("QC_DEFAULT_ADMIN_PASSWORD");

        Ok(Self {
            database_url,
            listen,
            jwt_secret_file,
            admin_jwt_secret_file,
            cookie_secure,
            session_hours,
            default_admin_email,
            default_admin_password,
        })
    }
}
