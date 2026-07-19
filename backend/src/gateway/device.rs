//! `quartzcommand.device.v1.DeviceService` — the mTLS-authenticated device
//! surface. Identity comes exclusively from the presented client certificate
//! (already validated against the device CA by the TLS handshake); nothing in
//! the request body is trusted for identity.

use std::net::IpAddr;
use std::sync::Arc;

use serde_json::json;
use tonic::{Request, Response, Status};

use crate::audit;
use crate::gateway::clone_detect::CloneSignal;
use crate::gateway::pb::device::v1::{
    device_service_server::DeviceService, RenewCertificateRequest, RenewCertificateResponse,
};
use crate::gateway::GrpcState;
use crate::pki::ca::{self, DeviceIdentity, DEVICE_CERT_DAYS};

pub struct DeviceGrpc {
    pub state: Arc<GrpcState>,
}

fn internal(e: impl std::fmt::Display) -> Status {
    tracing::error!("device service internal error: {e}");
    Status::internal("internal error")
}

/// Renew the client certificate for an authenticated device identity.
/// Factored out of the tonic trait so tests can call it with a synthetic
/// identity (tonic requests can't carry peer certs outside a real handshake).
pub async fn renew_with_identity(
    state: &GrpcState,
    ident: &DeviceIdentity,
    csr_der: &[u8],
    source_ip: Option<IpAddr>,
) -> Result<RenewCertificateResponse, Status> {
    let db = &state.db;
    let ip_str = source_ip.map(|i| i.to_string());

    // The device must still be adopted in the org its cert claims, with the
    // same key. Uniform failure — a revoked device learns nothing extra.
    let row: Option<(Vec<u8>, String)> =
        sqlx::query_as("SELECT pubkey, state FROM devices WHERE device_id = $1 AND org_id = $2")
            .bind(&ident.device_id)
            .bind(ident.org_id)
            .fetch_optional(db)
            .await
            .map_err(internal)?;
    let authorized = row
        .as_ref()
        .is_some_and(|(pubkey, st)| st == "adopted" && *pubkey == ident.pubkey);
    if !authorized {
        audit::record(
            db,
            Some(ident.org_id),
            &format!("device:{}", ident.device_id),
            "cert.renewal_denied",
            json!({ "device_id": ident.device_id, "source_ip": ip_str }),
        )
        .await;
        return Err(Status::permission_denied("renewal denied"));
    }

    // Same validation as enrollment: CSR key must equal the device key and
    // CN must equal the device id.
    let issued = state
        .device_ca
        .issue_device_cert(csr_der, &ident.device_id, ident.org_id, &ident.pubkey)
        .map_err(|e| {
            tracing::warn!(device = %ident.device_id, "renewal CSR rejected: {e}");
            Status::invalid_argument("invalid CSR")
        })?;

    sqlx::query(
        "UPDATE devices SET cert_serial = $2, cert_not_after = $3, \
                            last_seen_at = now(), last_seen_ip = COALESCE($4, last_seen_ip) \
         WHERE device_id = $1",
    )
    .bind(&ident.device_id)
    .bind(&issued.serial_hex)
    .bind(issued.not_after)
    .bind(&ip_str)
    .execute(db)
    .await
    .map_err(internal)?;

    if let Some(ip) = source_ip {
        report_contact(state, &ident.device_id, ident.org_id, ip).await;
    }

    audit::record(
        db,
        Some(ident.org_id),
        &format!("device:{}", ident.device_id),
        "cert.renewed",
        json!({ "device_id": ident.device_id, "serial": issued.serial_hex,
                "not_after": issued.not_after.to_rfc3339(), "source_ip": ip_str }),
    )
    .await;

    let not_after_unix = issued.not_after.timestamp();
    let lifetime_secs = DEVICE_CERT_DAYS * 24 * 3600;
    Ok(RenewCertificateResponse {
        client_cert_der: issued.cert_der,
        ca_chain_der: state.device_ca.ca_chain_der(),
        not_after_unix,
        // Rotation is designed to happen at 2/3 of cert lifetime.
        renew_after_unix: not_after_unix - lifetime_secs / 3,
    })
}

/// Feed the clone detector with an authenticated device contact; raises a
/// "Possible cloned device" org event when the pattern warrants it. Also the
/// hook the future control channel should call on every device connection.
pub async fn report_contact(state: &GrpcState, device_id: &str, org_id: uuid::Uuid, ip: IpAddr) {
    let Some(signal) = state.clone_detector.record(device_id, ip) else {
        return;
    };
    let details = match &signal {
        CloneSignal::ConcurrentSources { previous, current } => json!({
            "device_id": device_id, "kind": "concurrent_sources",
            "previous_ip": previous.to_string(), "current_ip": current.to_string(),
        }),
        CloneSignal::FlappingSources { switches } => json!({
            "device_id": device_id, "kind": "flapping_sources", "switches": switches,
        }),
    };
    tracing::warn!(device = %device_id, ?signal, "possible cloned device");
    audit::raise_event(
        &state.db,
        org_id,
        "warning",
        "Possible cloned device",
        details,
    )
    .await;
}

#[tonic::async_trait]
impl DeviceService for DeviceGrpc {
    async fn renew_certificate(
        &self,
        request: Request<RenewCertificateRequest>,
    ) -> Result<Response<RenewCertificateResponse>, Status> {
        let source_ip = request.remote_addr().map(|a| a.ip());

        // peer_certs() is populated by tonic's TLS layer once the client cert
        // chain validated against the device CA root. Absent cert (or the
        // plaintext dev listener) → unauthenticated.
        let cert = request
            .peer_certs()
            .and_then(|certs| certs.first().cloned())
            .ok_or_else(|| Status::unauthenticated("client certificate required"))?;
        let ident = ca::identity_from_cert_der(cert.as_ref())
            .map_err(|_| Status::unauthenticated("unrecognized client certificate"))?;

        let resp =
            renew_with_identity(&self.state, &ident, &request.get_ref().csr_der, source_ip).await?;
        Ok(Response::new(resp))
    }
}
