//! Quartz Command backend library. `main.rs` is a thin binary over this; the
//! split exists so integration tests (`tests/`) can drive the enrollment
//! services directly.
//!
//! Layout: `admin/` and `console/` are the two REST realms, `gateway/` is the
//! device-facing gRPC surface, `pki/` the device CA. Cross-cutting modules
//! (config, db, error, models, security, audit, …) live at the root.

pub mod admin;
pub mod audit;
pub mod config;
pub mod console;
pub mod db;
pub mod error;
pub mod gateway;
pub mod models;
pub mod pki;
pub mod product;
pub mod security;
pub mod seed;
pub mod settings;
pub mod slug;

use sqlx::PgPool;
use std::sync::Arc;

use config::Config;
use pki::ca::DeviceCa;

/// Shared state handed to every request handler.
pub struct AppState {
    pub config: Config,
    pub db: PgPool,
    /// Secret used to sign **user** session JWTs.
    pub jwt_secret: String,
    /// Secret used to sign **admin** session JWTs (distinct realm).
    pub admin_jwt_secret: String,
    /// The internal CA issuing device mTLS client certs.
    pub device_ca: Arc<DeviceCa>,
    /// SHA-256 (hex) of the gateway's issuing CA cert — the `sha256:` field
    /// of enrollment tokens.
    pub gateway_ca_fingerprint_hex: String,
    /// Live device control streams (shared with the gRPC gateway) — the
    /// console's per-device VyOS proxy sends requests through this.
    pub device_registry: Arc<gateway::control::DeviceRegistry>,
}
