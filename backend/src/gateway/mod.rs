//! Device gateway: shared state + server startup for the gRPC services.
//!
//! TLS model: when `QC_GRPC_TLS_CERT_FILE`/`QC_GRPC_TLS_KEY_FILE` are set the
//! listener terminates TLS itself, trusting the device CA for client certs
//! with client auth *optional* — EnrollmentService is the bootstrap path and
//! must work without a client cert, while DeviceService rejects any request
//! that didn't present one. Without the env vars the listener is plaintext
//! (local dev only; DeviceService is then effectively disabled).

pub mod clone_detect;
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
    /// `host:port` devices should use for their control channel (and the
    /// gateway field embedded in enrollment tokens).
    pub gateway_addr: String,
    pub enroll_limiter: RateLimiter,
    pub clone_detector: CloneDetector,
}

impl GrpcState {
    pub fn new(db: PgPool, device_ca: Arc<DeviceCa>, gateway_addr: String) -> Self {
        Self {
            db,
            device_ca,
            gateway_addr,
            enroll_limiter: RateLimiter::new(ENROLL_RATE_MAX, ENROLL_RATE_WINDOW),
            clone_detector: CloneDetector::new(),
        }
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
        (None, None) => {
            tracing::warn!(
                "device gateway listening on {addr} WITHOUT TLS — dev only; \
                 mTLS device services will reject all calls"
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
