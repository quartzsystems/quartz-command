//! `quartzcommand.enrollment.v1.EnrollmentService` — the unauthenticated
//! bootstrap path a factory-fresh QuartzFire device uses to trade an
//! enrollment token + proof-of-possession of its Ed25519 key for an mTLS
//! client certificate.
//!
//! Error discipline mirrors the login endpoints: the device learns nothing
//! about *why* an attempt failed. BeginEnrollment answers a uniform
//! `NOT_FOUND` whether the token is unknown, expired, revoked, or exhausted;
//! CompleteEnrollment answers a uniform `PERMISSION_DENIED` for every
//! verification failure. The real reason goes to the audit log.

use std::net::IpAddr;
use std::sync::Arc;

use ed25519_dalek::{Signature, VerifyingKey};
use rand::RngCore;
use serde_json::json;
use sqlx::PgPool;
use tonic::{Request, Response, Status};
use uuid::Uuid;

use crate::gateway::pb::enrollment::v1::{
    enrollment_service_server::EnrollmentService, BeginEnrollmentRequest, BeginEnrollmentResponse,
    CompleteEnrollmentRequest, CompleteEnrollmentResponse,
};
use crate::gateway::GrpcState;
use crate::pki::deviceid;
use crate::product::Product;
use crate::{audit, security};

/// Enrollment sessions live 5 minutes.
const SESSION_TTL_MINUTES: i64 = 5;

pub struct EnrollmentGrpc {
    pub state: Arc<GrpcState>,
}

/// Uniform BeginEnrollment failure — never distinguishes unknown from
/// expired/revoked/exhausted tokens.
fn begin_fail() -> Status {
    Status::not_found("enrollment token not found")
}

/// Uniform CompleteEnrollment failure — one message for every rejection.
fn complete_fail() -> Status {
    Status::permission_denied("enrollment failed")
}

fn internal(e: impl std::fmt::Display) -> Status {
    tracing::error!("enrollment internal error: {e}");
    Status::internal("internal error")
}

#[derive(sqlx::FromRow)]
struct TokenRow {
    org_id: Uuid,
    secret_hash: String,
    expires_at: chrono::DateTime<chrono::Utc>,
    max_uses: Option<i32>,
    use_count: i32,
    revoked_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Sub-organization the token allocates enrolled devices to, if any.
    sub_org_id: Option<Uuid>,
    /// Product line the token enrolls ("quartzfire" / "quartzsonic") — decides
    /// the expected device-ID prefix and is stamped onto the device row.
    product: String,
}

impl TokenRow {
    fn usable(&self) -> Result<(), &'static str> {
        if self.revoked_at.is_some() {
            return Err("token_revoked");
        }
        if self.expires_at <= chrono::Utc::now() {
            return Err("token_expired");
        }
        if self.max_uses.is_some_and(|m| self.use_count >= m) {
            return Err("token_exhausted");
        }
        Ok(())
    }
}

async fn load_token(db: &PgPool, token_id: &str) -> Result<Option<TokenRow>, Status> {
    sqlx::query_as::<_, TokenRow>(
        "SELECT org_id, secret_hash, expires_at, max_uses, use_count, revoked_at, sub_org_id, \
                product \
         FROM enrollment_tokens WHERE token_id = $1",
    )
    .bind(token_id)
    .fetch_optional(db)
    .await
    .map_err(internal)
}

impl EnrollmentGrpc {
    fn source_ip<T>(&self, req: &Request<T>) -> Option<IpAddr> {
        req.remote_addr().map(|a| a.ip())
    }

    /// Rate-limit the bootstrap path aggressively per source IP. Requests
    /// with no resolvable peer address (in-process tests) are not limited.
    #[allow(clippy::result_large_err)] // tonic::Status is just big
    fn check_rate<T>(&self, req: &Request<T>) -> Result<(), Status> {
        if let Some(ip) = self.source_ip(req) {
            if !self.state.enroll_limiter.check(ip) {
                return Err(Status::resource_exhausted("rate limit exceeded"));
            }
        }
        Ok(())
    }
}

#[tonic::async_trait]
impl EnrollmentService for EnrollmentGrpc {
    async fn begin_enrollment(
        &self,
        request: Request<BeginEnrollmentRequest>,
    ) -> Result<Response<BeginEnrollmentResponse>, Status> {
        self.check_rate(&request)?;
        let ip = self.source_ip(&request).map(|i| i.to_string());
        let req = request.into_inner();
        let db = &self.state.db;

        if req.device_pubkey.len() != deviceid::ED25519_PUBKEY_LEN {
            return Err(Status::invalid_argument(
                "device_pubkey must be a raw 32-byte Ed25519 public key",
            ));
        }

        // Opportunistic cleanup of expired sessions (no background job needed).
        let _ = sqlx::query("DELETE FROM enrollment_sessions WHERE expires_at < now()")
            .execute(db)
            .await;

        let token = match load_token(db, &req.token_id).await? {
            Some(t) => t,
            None => {
                audit::record(
                    db,
                    None,
                    "system",
                    "enrollment.failed",
                    json!({ "phase": "begin", "reason": "unknown_token",
                            "token_id": req.token_id, "source_ip": ip }),
                )
                .await;
                return Err(begin_fail());
            }
        };
        if let Err(reason) = token.usable() {
            audit::record(
                db,
                Some(token.org_id),
                "system",
                "enrollment.failed",
                json!({ "phase": "begin", "reason": reason,
                        "token_id": req.token_id, "source_ip": ip }),
            )
            .await;
            return Err(begin_fail());
        }

        let mut nonce = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut nonce);

        let (session_id,): (Uuid,) = sqlx::query_as(
            "INSERT INTO enrollment_sessions (token_id, device_pubkey, nonce, expires_at) \
             VALUES ($1, $2, $3, now() + make_interval(mins => $4)) RETURNING id",
        )
        .bind(&req.token_id)
        .bind(&req.device_pubkey[..])
        .bind(&nonce[..])
        .bind(SESSION_TTL_MINUTES as i32)
        .fetch_one(db)
        .await
        .map_err(internal)?;

        Ok(Response::new(BeginEnrollmentResponse {
            nonce: nonce.to_vec(),
            enrollment_session_id: session_id.to_string(),
        }))
    }

    async fn complete_enrollment(
        &self,
        request: Request<CompleteEnrollmentRequest>,
    ) -> Result<Response<CompleteEnrollmentResponse>, Status> {
        self.check_rate(&request)?;
        let ip = self.source_ip(&request).map(|i| i.to_string());
        let req = request.into_inner();
        let db = &self.state.db;

        // Audit + uniform failure in one place; the caller sees no reason.
        macro_rules! reject {
            ($org:expr, $reason:expr, $extra:tt) => {{
                let mut details = json!($extra);
                details["reason"] = json!($reason);
                details["phase"] = json!("complete");
                details["source_ip"] = json!(ip);
                audit::record(db, $org, "system", "enrollment.failed", details).await;
                return Err(complete_fail());
            }};
        }

        let session_id: Uuid = match req.enrollment_session_id.parse() {
            Ok(id) => id,
            Err(_) => reject!(None, "bad_session_id", {}),
        };

        // Claim the session atomically — each nonce is single-use even under
        // concurrent completion attempts.
        let session: Option<(String, Vec<u8>, Vec<u8>)> = sqlx::query_as(
            "DELETE FROM enrollment_sessions WHERE id = $1 AND expires_at > now() \
             RETURNING token_id, device_pubkey, nonce",
        )
        .bind(session_id)
        .fetch_optional(db)
        .await
        .map_err(internal)?;
        let Some((token_id, device_pubkey, nonce)) = session else {
            reject!(None, "unknown_or_expired_session", {});
        };

        // Verify the plaintext secret against the stored Argon2id hash. Same
        // uniform-timing discipline as login: a missing token still burns a
        // dummy verification.
        let token = load_token(db, &token_id).await?;
        let stored = token.as_ref().map(|t| t.secret_hash.clone());
        let secret = req.token_secret.clone();
        let secret_ok =
            tokio::task::spawn_blocking(move || security::verify_password(&secret, stored.as_deref()))
                .await
                .map_err(internal)?;
        let Some(token) = token else {
            reject!(None, "unknown_token", { "token_id": token_id });
        };
        let org_id = token.org_id;
        if !secret_ok {
            reject!(Some(org_id), "bad_secret", { "token_id": token_id });
        }
        if let Err(reason) = token.usable() {
            reject!(Some(org_id), reason, { "token_id": token_id });
        }

        // The claimed device_id must be the canonical derivation of the key
        // presented at BeginEnrollment, for the token's product line — a
        // QuartzSONiC token only ever adopts a QS-… identity (and vice versa).
        let product = Product::parse(&token.product)
            .ok_or_else(|| internal(format!("unknown product {:?} on token", token.product)))?;
        let derived = deviceid::derive_device_id(product, &device_pubkey);
        if derived != req.device_id {
            reject!(Some(org_id), "device_id_mismatch",
                    { "claimed": req.device_id, "token_id": token_id });
        }

        // Proof-of-possession: Ed25519 signature over our nonce.
        let pubkey_arr: [u8; 32] = match device_pubkey.as_slice().try_into() {
            Ok(a) => a,
            Err(_) => reject!(Some(org_id), "bad_pubkey", { "device_id": derived }),
        };
        let sig_ok = VerifyingKey::from_bytes(&pubkey_arr)
            .ok()
            .zip(Signature::from_slice(&req.nonce_signature).ok())
            .is_some_and(|(vk, sig)| vk.verify_strict(&nonce, &sig).is_ok());
        if !sig_ok {
            reject!(Some(org_id), "bad_signature", { "device_id": derived });
        }

        // CSR must carry the same key and CN=device_id; issue the cert (pure
        // computation — nothing is persisted yet).
        let issued = match self.state.device_ca.issue_device_cert(
            &req.csr_der,
            &derived,
            org_id,
            &device_pubkey,
        ) {
            Ok(c) => c,
            Err(e) => {
                reject!(Some(org_id), "bad_csr",
                        { "device_id": derived, "detail": e.to_string() })
            }
        };

        // Consume a token use and adopt the device atomically. The token row
        // UPDATE serializes concurrent enrollments, so max_uses can never be
        // oversubscribed by a race.
        let mut tx = db.begin().await.map_err(internal)?;

        let consumed = sqlx::query(
            "UPDATE enrollment_tokens SET use_count = use_count + 1 \
             WHERE token_id = $1 AND revoked_at IS NULL AND expires_at > now() \
               AND (max_uses IS NULL OR use_count < max_uses)",
        )
        .bind(&token_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
        if consumed.rows_affected() == 0 {
            drop(tx);
            reject!(Some(org_id), "token_exhausted", { "token_id": token_id });
        }

        let existing: Option<(Uuid, String)> =
            sqlx::query_as("SELECT org_id, state FROM devices WHERE device_id = $1 FOR UPDATE")
                .bind(&derived)
                .fetch_optional(&mut *tx)
                .await
                .map_err(internal)?;
        match &existing {
            Some((existing_org, _)) if *existing_org != org_id => {
                drop(tx);
                // Uniform error: a caller must not learn the id exists elsewhere.
                reject!(Some(org_id), "device_in_other_org", { "device_id": derived });
            }
            Some((_, state)) if state == "adopted" => {
                drop(tx);
                // Same key re-enrolling while adopted smells like a cloned
                // key; require an explicit revoke first.
                reject!(Some(org_id), "already_adopted", { "device_id": derived });
            }
            _ => {} // new device, or same-org pending/revoked → (re-)adopt
        }

        // A sub-org-scoped token allocates the device to that sub-organization;
        // an unscoped token leaves any existing allocation alone on re-adoption.
        sqlx::query(
            "INSERT INTO devices (device_id, org_id, pubkey, cert_serial, cert_not_after, state, \
                                  enrolled_at, enrolled_via_token, hostname, qf_version, \
                                  last_seen_at, last_seen_ip, sub_org_id, product) \
             VALUES ($1, $2, $3, $4, $5, 'adopted', now(), $6, $7, $8, now(), $9, $10, $11) \
             ON CONFLICT (device_id) DO UPDATE SET \
               pubkey = EXCLUDED.pubkey, cert_serial = EXCLUDED.cert_serial, \
               cert_not_after = EXCLUDED.cert_not_after, state = 'adopted', \
               enrolled_at = now(), enrolled_via_token = EXCLUDED.enrolled_via_token, \
               hostname = EXCLUDED.hostname, qf_version = EXCLUDED.qf_version, \
               last_seen_at = now(), last_seen_ip = EXCLUDED.last_seen_ip, \
               sub_org_id = COALESCE(EXCLUDED.sub_org_id, devices.sub_org_id), \
               product = EXCLUDED.product",
        )
        .bind(&derived)
        .bind(org_id)
        .bind(&device_pubkey[..])
        .bind(&issued.serial_hex)
        .bind(issued.not_after)
        .bind(&token_id)
        .bind(&req.hostname)
        .bind(&req.qf_version)
        .bind(&ip)
        .bind(token.sub_org_id)
        .bind(product.as_str())
        .execute(&mut *tx)
        .await
        .map_err(internal)?;

        tx.commit().await.map_err(internal)?;

        audit::record(
            db,
            Some(org_id),
            &format!("device:{derived}"),
            "enrollment.succeeded",
            json!({ "device_id": derived, "token_id": token_id,
                    "product": product.as_str(),
                    "hostname": req.hostname, "qf_version": req.qf_version,
                    "source_ip": ip }),
        )
        .await;
        audit::record(
            db,
            Some(org_id),
            "system",
            "cert.issued",
            json!({ "device_id": derived, "serial": issued.serial_hex,
                    "not_after": issued.not_after.to_rfc3339() }),
        )
        .await;
        tracing::info!(device = %derived, org = %org_id, "device enrolled");

        Ok(Response::new(CompleteEnrollmentResponse {
            client_cert_der: issued.cert_der,
            ca_chain_der: self.state.device_ca.ca_chain_der(),
            assigned_gateway: crate::settings::get(db, crate::settings::GATEWAY_ADDR)
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| self.state.gateway_addr.clone()),
            org_id: org_id.to_string(),
        }))
    }
}
