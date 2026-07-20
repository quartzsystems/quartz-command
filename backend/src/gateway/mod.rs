//! Device gateway: shared state + server startup for the gRPC services.
//!
//! TLS model: the listener terminates TLS itself, trusting the device CA for
//! client certs with client auth *optional* — EnrollmentService is the
//! bootstrap path and must work without a client cert, while DeviceService
//! rejects any request that didn't present one. The server identity comes
//! from `QC_GRPC_TLS_CERT_FILE`/`QC_GRPC_TLS_KEY_FILE` when set; otherwise a
//! cert covering the advertised gateway host is auto-issued from the device
//! CA at startup (devices verify it via the CA fingerprint pinned in their
//! enrollment token). `QC_GATEWAY_TLS=off` forces a plaintext listener
//! (local dev only; DeviceService is then effectively disabled).

pub mod clone_detect;
pub mod control;
pub mod device;
pub mod enrollment;
pub mod pb;
pub mod ratelimit;

use anyhow::{Context, Result};
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;

use crate::config::Config;
use crate::pki::ca::DeviceCa;
use self::clone_detect::CloneDetector;
use self::device::DeviceGrpc;
use self::enrollment::EnrollmentGrpc;
use self::pb::device::v1::device_service_server::DeviceServiceServer;
use self::pb::enrollment::v1::enrollment_service_server::EnrollmentServiceServer;
use self::ratelimit::RateLimiter;

/// Aggressive per-IP budget for the unauthenticated enrollment path: an
/// honest device needs 2 calls; 10/min absorbs retries without enabling
/// brute force.
const ENROLL_RATE_MAX: usize = 10;
const ENROLL_RATE_WINDOW: Duration = Duration::from_secs(60);

pub struct GrpcState {
    pub db: PgPool,
    pub device_ca: Arc<DeviceCa>,
    /// `host:port` devices should use for their control channel, as effective
    /// at startup (admin settings override included). Enrollment re-reads the
    /// setting per request and only falls back to this snapshot.
    pub gateway_addr: String,
    pub enroll_limiter: RateLimiter,
    pub clone_detector: CloneDetector,
    /// Live device control streams — shared with the console's VyOS proxy.
    pub registry: Arc<control::DeviceRegistry>,
}

impl GrpcState {
    pub fn new(
        db: PgPool,
        device_ca: Arc<DeviceCa>,
        gateway_addr: String,
        registry: Arc<control::DeviceRegistry>,
    ) -> Self {
        Self {
            db,
            device_ca,
            gateway_addr,
            enroll_limiter: RateLimiter::new(ENROLL_RATE_MAX, ENROLL_RATE_WINDOW),
            clone_detector: CloneDetector::new(),
            registry,
        }
    }
}

/// Host half of a `host:port` address (`[v6]:port` brackets stripped; a bare
/// host with no port passes through).
fn host_of(addr: &str) -> &str {
    if let Some(rest) = addr.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            return &rest[..end];
        }
    }
    match addr.rsplit_once(':') {
        Some((host, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => host,
        _ => addr,
    }
}

/// Serve the device gateway until process exit.
pub async fn serve(state: Arc<GrpcState>, config: &Config) -> Result<()> {
    let addr = config
        .grpc_listen
        .parse()
        .with_context(|| format!("invalid QC_GRPC_LISTEN {:?}", config.grpc_listen))?;

    let mut builder = tonic::transport::Server::builder();

    match (&config.grpc_tls_cert_file, &config.grpc_tls_key_file) {
        (Some(cert_path), Some(key_path)) => {
            let cert = std::fs::read(cert_path)
                .with_context(|| format!("reading {}", cert_path.display()))?;
            let key = std::fs::read(key_path)
                .with_context(|| format!("reading {}", key_path.display()))?;
            let tls = tonic::transport::ServerTlsConfig::new()
                .identity(tonic::transport::Identity::from_pem(cert, key))
                .client_ca_root(tonic::transport::Certificate::from_pem(
                    state.device_ca.ca_cert_pem(),
                ))
                .client_auth_optional(true);
            builder = builder.tls_config(tls).context("configuring gateway TLS")?;
            tracing::info!("device gateway listening on {addr} (TLS, optional client certs)");
        }
        (None, None) if config.gateway_tls_off => {
            tracing::warn!(
                "device gateway listening on {addr} WITHOUT TLS (QC_GATEWAY_TLS=off) — dev \
                 only; mTLS device services will reject all calls"
            );
        }
        (None, None) => {
            // The advertised address (settings override included) is what
            // devices dial, so that host is what the cert must cover.
            let host = host_of(&state.gateway_addr);
            let identity = state.device_ca.issue_gateway_cert(host)?;
            let tls = tonic::transport::ServerTlsConfig::new()
                .identity(tonic::transport::Identity::from_pem(
                    identity.cert_pem,
                    identity.key_pem,
                ))
                .client_ca_root(tonic::transport::Certificate::from_pem(
                    state.device_ca.ca_cert_pem(),
                ))
                .client_auth_optional(true);
            builder = builder.tls_config(tls).context("configuring gateway TLS")?;
            tracing::info!(
                "device gateway listening on {addr} (TLS, auto-issued device-CA cert \
                 for {host}, optional client certs)"
            );
        }
        _ => anyhow::bail!("QC_GRPC_TLS_CERT_FILE and QC_GRPC_TLS_KEY_FILE must be set together"),
    }

    builder
        .add_service(EnrollmentServiceServer::new(EnrollmentGrpc {
            state: state.clone(),
        }))
        .add_service(DeviceServiceServer::new(DeviceGrpc { state }))
        .serve(addr)
        .await
        .context("device gateway server")
}
