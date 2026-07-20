//! `quartzcommand.device.v1.DeviceService` — the mTLS-authenticated device
//! surface. Identity comes exclusively from the presented client certificate
//! (already validated against the device CA by the TLS handshake); nothing in
//! the request body is trusted for identity.

use std::net::IpAddr;
use std::sync::Arc;

use serde_json::json;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status, Streaming};

use crate::audit;
use crate::gateway::clone_detect::CloneSignal;
use crate::gateway::pb::device::v1::{
    device_message, device_service_server::DeviceService, ControllerMessage, DeviceMessage,
    RenewCertificateRequest, RenewCertificateResponse, SecurityTelemetry,
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

/// Store the latest security-telemetry snapshot a device pushed over its
/// control stream (upsert — one row per device). Counters are u64 on the wire
/// but always well within i64 in practice; saturate on the way into Postgres.
async fn store_security_telemetry(state: &GrpcState, device_id: &str, t: &SecurityTelemetry) {
    let ips = t.ips.clone().unwrap_or_default();
    let ac = t.app_control.clone().unwrap_or_default();
    let geo = t.geolocation.clone().unwrap_or_default();
    let cf = t.content_filtering.clone().unwrap_or_default();
    let i64c = |v: u64| i64::try_from(v).unwrap_or(i64::MAX);

    let res = sqlx::query(
        "INSERT INTO device_security_telemetry ( \
            device_id, time_unix, interval_secs, \
            ips_enabled, ips_prevented, ips_detected, ips_scans, ips_scans_available, \
            ac_enabled, ac_blocked, ac_detected, ac_total_requests, \
            geo_enabled, geo_blocked, geo_connections, geo_countries_blocked, \
            cf_enabled, cf_blocked, cf_allowed, cf_total_requests, received_at) \
         VALUES ($1,$2,$3, $4,$5,$6,$7,$8, $9,$10,$11,$12, $13,$14,$15,$16, $17,$18,$19,$20, now()) \
         ON CONFLICT (device_id) DO UPDATE SET \
            time_unix = EXCLUDED.time_unix, interval_secs = EXCLUDED.interval_secs, \
            ips_enabled = EXCLUDED.ips_enabled, ips_prevented = EXCLUDED.ips_prevented, \
            ips_detected = EXCLUDED.ips_detected, ips_scans = EXCLUDED.ips_scans, \
            ips_scans_available = EXCLUDED.ips_scans_available, \
            ac_enabled = EXCLUDED.ac_enabled, ac_blocked = EXCLUDED.ac_blocked, \
            ac_detected = EXCLUDED.ac_detected, ac_total_requests = EXCLUDED.ac_total_requests, \
            geo_enabled = EXCLUDED.geo_enabled, geo_blocked = EXCLUDED.geo_blocked, \
            geo_connections = EXCLUDED.geo_connections, \
            geo_countries_blocked = EXCLUDED.geo_countries_blocked, \
            cf_enabled = EXCLUDED.cf_enabled, cf_blocked = EXCLUDED.cf_blocked, \
            cf_allowed = EXCLUDED.cf_allowed, cf_total_requests = EXCLUDED.cf_total_requests, \
            received_at = now()",
    )
    .bind(device_id)
    .bind(t.time_unix)
    .bind(t.interval_secs as i32)
    .bind(ips.enabled)
    .bind(i64c(ips.prevented))
    .bind(i64c(ips.detected))
    .bind(i64c(ips.scans))
    .bind(ips.scans_available)
    .bind(ac.enabled)
    .bind(i64c(ac.blocked))
    .bind(i64c(ac.detected))
    .bind(i64c(ac.total_requests))
    .bind(geo.enabled)
    .bind(i64c(geo.blocked))
    .bind(i64c(geo.connections))
    .bind(geo.countries_blocked as i32)
    .bind(cf.enabled)
    .bind(i64c(cf.blocked))
    .bind(i64c(cf.allowed))
    .bind(i64c(cf.total_requests))
    .execute(&state.db)
    .await;
    if let Err(e) = res {
        tracing::debug!(device = %device_id, "storing security telemetry: {e}");
    }
}

/// Extract and validate the mTLS device identity from a request.
fn authenticated_identity<T>(request: &Request<T>) -> Result<DeviceIdentity, Status> {
    // peer_certs() is populated by tonic's TLS layer once the client cert
    // chain validated against the device CA root. Absent cert (or the
    // plaintext dev listener) → unauthenticated.
    let cert = request
        .peer_certs()
        .and_then(|certs| certs.first().cloned())
        .ok_or_else(|| Status::unauthenticated("client certificate required"))?;
    ca::identity_from_cert_der(cert.as_ref())
        .map_err(|_| Status::unauthenticated("unrecognized client certificate"))
}

/// The device must still be adopted in the org its cert claims, with the same
/// key (the same gate renewal applies).
async fn require_adopted(state: &GrpcState, ident: &DeviceIdentity) -> Result<(), Status> {
    let row: Option<(Vec<u8>, String)> =
        sqlx::query_as("SELECT pubkey, state FROM devices WHERE device_id = $1 AND org_id = $2")
            .bind(&ident.device_id)
            .bind(ident.org_id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    let authorized = row
        .as_ref()
        .is_some_and(|(pubkey, st)| st == "adopted" && *pubkey == ident.pubkey);
    if authorized {
        Ok(())
    } else {
        Err(Status::permission_denied("device not adopted"))
    }
}

#[tonic::async_trait]
impl DeviceService for DeviceGrpc {
    async fn renew_certificate(
        &self,
        request: Request<RenewCertificateRequest>,
    ) -> Result<Response<RenewCertificateResponse>, Status> {
        let source_ip = request.remote_addr().map(|a| a.ip());
        let ident = authenticated_identity(&request)?;
        let resp =
            renew_with_identity(&self.state, &ident, &request.get_ref().csr_der, source_ip).await?;
        Ok(Response::new(resp))
    }

    type ControlStreamStream = ReceiverStream<Result<ControllerMessage, Status>>;

    /// The device-held command channel: register the stream in the registry so
    /// the console's VyOS proxy can reach this device, pump ProxyResponses
    /// back to their waiting callers, and keep last_seen fresh.
    async fn control_stream(
        &self,
        request: Request<Streaming<DeviceMessage>>,
    ) -> Result<Response<Self::ControlStreamStream>, Status> {
        let source_ip = request.remote_addr().map(|a| a.ip());
        let ident = authenticated_identity(&request)?;
        require_adopted(&self.state, &ident).await?;

        let mut inbound = request.into_inner();

        // Outbound: registry → this stream. The channel is deliberately small;
        // the console proxy awaits each response, so depth stays tiny.
        let (tx, rx) = tokio::sync::mpsc::channel::<ControllerMessage>(16);
        let (out_tx, out_rx) = tokio::sync::mpsc::channel::<Result<ControllerMessage, Status>>(16);
        let epoch = self
            .state
            .registry
            .register(&ident.device_id, ident.org_id, tx);

        tracing::info!(device = %ident.device_id, org = %ident.org_id, "control stream connected");
        if let Some(ip) = source_ip {
            report_contact(&self.state, &ident.device_id, ident.org_id, ip).await;
        }
        let ip_str = source_ip.map(|i| i.to_string());
        sqlx::query(
            "UPDATE devices SET last_seen_at = now(), last_seen_ip = COALESCE($2, last_seen_ip) \
             WHERE device_id = $1",
        )
        .bind(&ident.device_id)
        .bind(&ip_str)
        .execute(&self.state.db)
        .await
        .map_err(internal)?;

        // Forwarder: registry messages → gRPC response stream.
        let state = self.state.clone();
        let device_id = ident.device_id.clone();
        tokio::spawn(async move {
            let mut rx = rx;
            loop {
                tokio::select! {
                    // Console → device requests.
                    req = rx.recv() => match req {
                        Some(msg) => {
                            if out_tx.send(Ok(msg)).await.is_err() {
                                break; // stream gone
                            }
                        }
                        None => break, // replaced by a newer connection
                    },
                    // Device → console messages.
                    msg = inbound.message() => match msg {
                        Ok(Some(DeviceMessage { msg: Some(device_message::Msg::Hello(hello)) })) => {
                            let _ = sqlx::query(
                                "UPDATE devices SET hostname = NULLIF($2, ''), \
                                        qf_version = NULLIF($3, ''), last_seen_at = now() \
                                 WHERE device_id = $1",
                            )
                            .bind(&device_id)
                            .bind(&hello.hostname)
                            .bind(&hello.qf_version)
                            .execute(&state.db)
                            .await;
                        }
                        Ok(Some(DeviceMessage { msg: Some(device_message::Msg::ProxyResponse(resp)) })) => {
                            state.registry.resolve(&device_id, resp);
                        }
                        Ok(Some(DeviceMessage { msg: Some(device_message::Msg::SecurityTelemetry(t)) })) => {
                            store_security_telemetry(&state, &device_id, &t).await;
                        }
                        Ok(Some(DeviceMessage { msg: None })) => {}
                        Ok(None) => break,          // device closed the stream
                        Err(e) => {
                            tracing::debug!(device = %device_id, "control stream error: {e}");
                            break;
                        }
                    },
                }
            }
            state.registry.deregister(&device_id, epoch);
            tracing::info!(device = %device_id, "control stream disconnected");
        });

        Ok(Response::new(ReceiverStream::new(out_rx)))
    }
}
