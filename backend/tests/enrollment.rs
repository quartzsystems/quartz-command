//! Integration tests for the device enrollment token system: token lifecycle,
//! the full happy-path enrollment with real Ed25519 keys and CSRs, every
//! rejection path, cert issuance fields, renewal, and clone detection.
//!
//! Each test gets its own throwaway database via `#[sqlx::test]` (requires
//! DATABASE_URL pointing at a local PostgreSQL with createdb rights).

use std::net::IpAddr;
use std::sync::Arc;

use ed25519_dalek::pkcs8::EncodePrivateKey;
use ed25519_dalek::{Signer, SigningKey};
use sqlx::PgPool;
use tonic::{Code, Request};
use uuid::Uuid;

use quartz_command::console::enroll_tokens::{
    compose_token_string, generate_secret, generate_token_id,
};
use quartz_command::gateway::device::{renew_with_identity, report_contact};
use quartz_command::gateway::enrollment::EnrollmentGrpc;
use quartz_command::gateway::pb::enrollment::v1::enrollment_service_server::EnrollmentService;
use quartz_command::gateway::pb::enrollment::v1::{
    BeginEnrollmentRequest, BeginEnrollmentResponse, CompleteEnrollmentRequest,
    CompleteEnrollmentResponse,
};
use quartz_command::gateway::GrpcState;
use quartz_command::pki::ca::{DeviceCa, DeviceIdentity, DEVICE_CERT_DAYS};
use quartz_command::pki::deviceid::derive_device_id;
use quartz_command::product::Product;
use quartz_command::security;

// ── shared fixtures ─────────────────────────────────────────────────────────

fn service(pool: &PgPool) -> EnrollmentGrpc {
    let ca_dir = std::env::temp_dir().join(format!("qc-test-ca-{}", Uuid::new_v4()));
    let ca = Arc::new(DeviceCa::load_or_create(&ca_dir).expect("test CA"));
    EnrollmentGrpc {
        state: Arc::new(GrpcState::new(
            pool.clone(),
            ca,
            "gw.test:8443".into(),
            Arc::new(quartz_command::gateway::control::DeviceRegistry::new()),
        )),
    }
}

async fn create_org(pool: &PgPool) -> Uuid {
    let (id,): (Uuid,) =
        sqlx::query_as("INSERT INTO organizations (name, slug) VALUES ('Test Org', $1) RETURNING id")
            .bind(format!("test-{}", &Uuid::new_v4().to_string()[..8]))
            .fetch_one(pool)
            .await
            .expect("create org");
    id
}

/// Insert a token row directly (the REST handler is a thin wrapper over the
/// same statement) and return `(token_id, plaintext_secret)`.
async fn create_token(
    pool: &PgPool,
    org: Uuid,
    expires_hours: i32,
    max_uses: Option<i32>,
) -> (String, String) {
    let token_id = generate_token_id();
    let secret = generate_secret();
    let hash = security::hash_password(&secret).expect("hash");
    sqlx::query(
        "INSERT INTO enrollment_tokens (token_id, org_id, secret_hash, expires_at, max_uses) \
         VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5)",
    )
    .bind(&token_id)
    .bind(org)
    .bind(&hash)
    .bind(expires_hours)
    .bind(max_uses)
    .execute(pool)
    .await
    .expect("insert token");
    (token_id, secret)
}

struct Device {
    key: SigningKey,
    pubkey: Vec<u8>,
    device_id: String,
}

fn new_device_for(product: Product) -> Device {
    let key = SigningKey::generate(&mut rand::rngs::OsRng);
    let pubkey = key.verifying_key().to_bytes().to_vec();
    let device_id = derive_device_id(product, &pubkey);
    Device {
        key,
        pubkey,
        device_id,
    }
}

fn new_device() -> Device {
    new_device_for(Product::QuartzFire)
}

/// Build a real Ed25519 CSR with the given CN, signed by `key`.
fn make_csr(key: &SigningKey, cn: &str) -> Vec<u8> {
    let pkcs8 = key.to_pkcs8_der().expect("pkcs8");
    let rc_key = rcgen::KeyPair::try_from(pkcs8.as_bytes()).expect("rcgen key");
    let mut params = rcgen::CertificateParams::default();
    let mut dn = rcgen::DistinguishedName::new();
    dn.push(rcgen::DnType::CommonName, cn);
    params.distinguished_name = dn;
    params
        .serialize_request(&rc_key)
        .expect("csr")
        .der()
        .to_vec()
}

async fn begin(
    svc: &EnrollmentGrpc,
    token_id: &str,
    pubkey: &[u8],
) -> Result<BeginEnrollmentResponse, tonic::Status> {
    svc.begin_enrollment(Request::new(BeginEnrollmentRequest {
        token_id: token_id.to_string(),
        device_pubkey: pubkey.to_vec(),
    }))
    .await
    .map(|r| r.into_inner())
}

fn complete_request(
    session: &BeginEnrollmentResponse,
    secret: &str,
    dev: &Device,
) -> CompleteEnrollmentRequest {
    CompleteEnrollmentRequest {
        enrollment_session_id: session.enrollment_session_id.clone(),
        token_secret: secret.to_string(),
        device_id: dev.device_id.clone(),
        nonce_signature: dev.key.sign(&session.nonce).to_bytes().to_vec(),
        csr_der: make_csr(&dev.key, &dev.device_id),
        hostname: "fw-test".into(),
        qf_version: "1.2.3".into(),
    }
}

async fn complete(
    svc: &EnrollmentGrpc,
    req: CompleteEnrollmentRequest,
) -> Result<CompleteEnrollmentResponse, tonic::Status> {
    svc.complete_enrollment(Request::new(req))
        .await
        .map(|r| r.into_inner())
}

/// Begin + complete with everything valid.
async fn enroll(
    svc: &EnrollmentGrpc,
    token_id: &str,
    secret: &str,
    dev: &Device,
) -> Result<CompleteEnrollmentResponse, tonic::Status> {
    let session = begin(svc, token_id, &dev.pubkey).await?;
    complete(svc, complete_request(&session, secret, dev)).await
}

/// The uniform CompleteEnrollment rejection every failure path must produce.
fn assert_uniform_rejection(status: &tonic::Status) {
    assert_eq!(status.code(), Code::PermissionDenied);
    assert_eq!(status.message(), "enrollment failed");
}

async fn device_state(pool: &PgPool, device_id: &str) -> Option<(Uuid, String)> {
    sqlx::query_as("SELECT org_id, state FROM devices WHERE device_id = $1")
        .bind(device_id)
        .fetch_optional(pool)
        .await
        .expect("device query")
}

async fn audit_actions(pool: &PgPool) -> Vec<String> {
    sqlx::query_scalar("SELECT action FROM audit_log ORDER BY created_at")
        .fetch_all(pool)
        .await
        .expect("audit query")
}

// ── happy path + cert fields ────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn happy_path_enrollment_issues_valid_cert(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let (token_id, secret) = create_token(&pool, org, 24, Some(5)).await;
    let dev = new_device();

    let resp = enroll(&svc, &token_id, &secret, &dev).await.expect("enrollment");

    assert_eq!(resp.org_id, org.to_string());
    assert_eq!(resp.assigned_gateway, "gw.test:8443");
    assert_eq!(resp.ca_chain_der.len(), 1);

    // The issued cert: CN=device_id, org SAN URI, ~30-day validity, and the
    // serial recorded on the device row.
    let (_, cert) =
        x509_parser::parse_x509_certificate(&resp.client_cert_der).expect("parse cert");
    let cn = cert
        .subject()
        .iter_common_name()
        .next()
        .and_then(|c| c.as_str().ok())
        .expect("cert CN");
    assert_eq!(cn, dev.device_id);

    let sans: Vec<String> = cert
        .extensions()
        .iter()
        .filter_map(|e| match e.parsed_extension() {
            x509_parser::extensions::ParsedExtension::SubjectAlternativeName(san) => Some(san),
            _ => None,
        })
        .flat_map(|san| san.general_names.iter())
        .filter_map(|n| match n {
            x509_parser::extensions::GeneralName::URI(u) => Some(u.to_string()),
            _ => None,
        })
        .collect();
    assert_eq!(
        sans,
        vec![format!("quartz://org/{org}/device/{}", dev.device_id)]
    );

    let lifetime = cert.validity().not_after.timestamp() - cert.validity().not_before.timestamp();
    let expected = DEVICE_CERT_DAYS * 24 * 3600;
    assert!(
        (lifetime - expected).abs() < 3600,
        "cert lifetime {lifetime}s should be ~{expected}s"
    );

    let (dev_org, state) = device_state(&pool, &dev.device_id).await.expect("device row");
    assert_eq!(dev_org, org);
    assert_eq!(state, "adopted");

    let (serial, hostname, qf_version): (Option<String>, Option<String>, Option<String>) =
        sqlx::query_as(
            "SELECT cert_serial, hostname, qf_version FROM devices WHERE device_id = $1",
        )
        .bind(&dev.device_id)
        .fetch_one(&pool)
        .await
        .expect("device fields");
    assert_eq!(hostname.as_deref(), Some("fw-test"));
    assert_eq!(qf_version.as_deref(), Some("1.2.3"));
    let cert_serial_hex = cert.serial.to_str_radix(16);
    assert_eq!(
        serial.expect("serial recorded").trim_start_matches('0'),
        cert_serial_hex.trim_start_matches('0')
    );

    let (use_count,): (i32,) =
        sqlx::query_as("SELECT use_count FROM enrollment_tokens WHERE token_id = $1")
            .bind(&token_id)
            .fetch_one(&pool)
            .await
            .expect("token row");
    assert_eq!(use_count, 1);

    let actions = audit_actions(&pool).await;
    assert!(actions.contains(&"enrollment.succeeded".to_string()));
    assert!(actions.contains(&"cert.issued".to_string()));
}

#[sqlx::test(migrations = "./migrations")]
async fn token_string_format(pool: PgPool) {
    let _ = pool; // format check only
    let org: Uuid = "6dfe64c8-9edb-4f5c-8d1a-51f3e2f5c111".parse().unwrap();
    let token_id = generate_token_id();
    let secret = generate_secret();
    assert_eq!(token_id.len(), "tok_".len() + 12);
    assert!(token_id.starts_with("tok_"));
    assert_eq!(secret.len(), 43); // 32 bytes base64url, no padding
    let s = compose_token_string("gw.example.com:8443", org, &token_id, &secret, "ab12");
    let parts: Vec<&str> = s.split('|').collect();
    assert_eq!(parts[0], "QC1");
    assert_eq!(parts[1], "gw.example.com:8443");
    assert_eq!(parts[2], org.to_string());
    assert_eq!(parts[3], format!("{token_id}.{secret}"));
    assert_eq!(parts[4], "sha256:ab12");
}

// ── product lines ───────────────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn quartzsonic_token_enrolls_qs_device(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let (token_id, secret) = create_token(&pool, org, 24, None).await;
    sqlx::query("UPDATE enrollment_tokens SET product = 'quartzsonic' WHERE token_id = $1")
        .bind(&token_id)
        .execute(&pool)
        .await
        .unwrap();

    // A QuartzFire-derived identity (QF-…) must not enroll via a QuartzSONiC
    // token — the server derives the QS-… id and the claim mismatches.
    let fire = new_device();
    assert_uniform_rejection(&enroll(&svc, &token_id, &secret, &fire).await.unwrap_err());

    let dev = new_device_for(Product::QuartzSonic);
    assert!(dev.device_id.starts_with("QS-"));
    enroll(&svc, &token_id, &secret, &dev).await.expect("sonic enrollment");

    let (product,): (String,) =
        sqlx::query_as("SELECT product FROM devices WHERE device_id = $1")
            .bind(&dev.device_id)
            .fetch_one(&pool)
            .await
            .expect("device row");
    assert_eq!(product, "quartzsonic");
}

// ── token lifecycle ─────────────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn expired_token_rejected_at_begin(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let (token_id, _secret) = create_token(&pool, org, 24, None).await;
    sqlx::query("UPDATE enrollment_tokens SET expires_at = now() - interval '1 hour'")
        .execute(&pool)
        .await
        .unwrap();

    let err = begin(&svc, &token_id, &new_device().pubkey).await.unwrap_err();
    assert_eq!(err.code(), Code::NotFound);
    // Indistinguishable from a token that never existed.
    let unknown = begin(&svc, "tok_doesnotexist", &new_device().pubkey)
        .await
        .unwrap_err();
    assert_eq!(err.code(), unknown.code());
    assert_eq!(err.message(), unknown.message());
}

#[sqlx::test(migrations = "./migrations")]
async fn revoked_token_rejected_even_mid_enrollment(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let (token_id, secret) = create_token(&pool, org, 24, None).await;
    let dev = new_device();

    // Begin while valid, revoke, then try to complete: must fail.
    let session = begin(&svc, &token_id, &dev.pubkey).await.expect("begin");
    sqlx::query("UPDATE enrollment_tokens SET revoked_at = now() WHERE token_id = $1")
        .bind(&token_id)
        .execute(&pool)
        .await
        .unwrap();

    let err = complete(&svc, complete_request(&session, &secret, &dev))
        .await
        .unwrap_err();
    assert_uniform_rejection(&err);
    assert!(device_state(&pool, &dev.device_id).await.is_none());

    // And begin no longer works at all.
    let err = begin(&svc, &token_id, &dev.pubkey).await.unwrap_err();
    assert_eq!(err.code(), Code::NotFound);
}

#[sqlx::test(migrations = "./migrations")]
async fn max_uses_race_admits_exactly_one(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let (token_id, secret) = create_token(&pool, org, 24, Some(1)).await;
    let (dev_a, dev_b) = (new_device(), new_device());

    // Both devices get sessions while the token still has a use left, then
    // race to complete concurrently.
    let session_a = begin(&svc, &token_id, &dev_a.pubkey).await.expect("begin a");
    let session_b = begin(&svc, &token_id, &dev_b.pubkey).await.expect("begin b");

    let (res_a, res_b) = tokio::join!(
        complete(&svc, complete_request(&session_a, &secret, &dev_a)),
        complete(&svc, complete_request(&session_b, &secret, &dev_b)),
    );

    let successes = [&res_a, &res_b].iter().filter(|r| r.is_ok()).count();
    assert_eq!(successes, 1, "exactly one of two racing enrollments may win");
    for r in [&res_a, &res_b] {
        if let Err(e) = r {
            assert_uniform_rejection(e);
        }
    }

    let (use_count,): (i32,) =
        sqlx::query_as("SELECT use_count FROM enrollment_tokens WHERE token_id = $1")
            .bind(&token_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(use_count, 1, "use_count must never exceed max_uses");
}

// ── rejection paths ─────────────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn bad_nonce_signature_rejected(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let (token_id, secret) = create_token(&pool, org, 24, None).await;
    let dev = new_device();

    let session = begin(&svc, &token_id, &dev.pubkey).await.expect("begin");
    let mut req = complete_request(&session, &secret, &dev);
    req.nonce_signature = dev.key.sign(b"not the nonce").to_bytes().to_vec();

    assert_uniform_rejection(&complete(&svc, req).await.unwrap_err());
    assert!(device_state(&pool, &dev.device_id).await.is_none());
    assert!(audit_actions(&pool).await.contains(&"enrollment.failed".to_string()));
}

#[sqlx::test(migrations = "./migrations")]
async fn wrong_secret_rejected(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let (token_id, _secret) = create_token(&pool, org, 24, None).await;
    let dev = new_device();

    let session = begin(&svc, &token_id, &dev.pubkey).await.expect("begin");
    let req = complete_request(&session, &generate_secret(), &dev);
    assert_uniform_rejection(&complete(&svc, req).await.unwrap_err());
}

#[sqlx::test(migrations = "./migrations")]
async fn mismatched_device_id_derivation_rejected(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let (token_id, secret) = create_token(&pool, org, 24, None).await;
    let dev = new_device();

    let session = begin(&svc, &token_id, &dev.pubkey).await.expect("begin");
    let mut req = complete_request(&session, &secret, &dev);
    req.device_id = derive_device_id(Product::QuartzFire, &new_device().pubkey); // someone else's id
    assert_uniform_rejection(&complete(&svc, req).await.unwrap_err());
}

#[sqlx::test(migrations = "./migrations")]
async fn csr_with_foreign_key_rejected(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let (token_id, secret) = create_token(&pool, org, 24, None).await;
    let dev = new_device();

    let session = begin(&svc, &token_id, &dev.pubkey).await.expect("begin");
    let mut req = complete_request(&session, &secret, &dev);
    // CSR key ≠ enrolled device key (CN is right) — must be rejected.
    req.csr_der = make_csr(&new_device().key, &dev.device_id);
    assert_uniform_rejection(&complete(&svc, req).await.unwrap_err());
}

#[sqlx::test(migrations = "./migrations")]
async fn device_in_other_org_rejected_uniformly(pool: PgPool) {
    let svc = service(&pool);
    let org_a = create_org(&pool).await;
    let org_b = create_org(&pool).await;
    let dev = new_device();

    // The same key is already adopted by org B.
    sqlx::query(
        "INSERT INTO devices (device_id, org_id, pubkey, state) VALUES ($1, $2, $3, 'adopted')",
    )
    .bind(&dev.device_id)
    .bind(org_b)
    .bind(&dev.pubkey[..])
    .execute(&pool)
    .await
    .unwrap();

    let (token_id, secret) = create_token(&pool, org_a, 24, None).await;
    let err = enroll(&svc, &token_id, &secret, &dev).await.unwrap_err();
    assert_uniform_rejection(&err);

    // Device stays with org B, and the failed attempt consumed no use.
    let (dev_org, state) = device_state(&pool, &dev.device_id).await.unwrap();
    assert_eq!(dev_org, org_b);
    assert_eq!(state, "adopted");
    let (use_count,): (i32,) =
        sqlx::query_as("SELECT use_count FROM enrollment_tokens WHERE token_id = $1")
            .bind(&token_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(use_count, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn expired_session_rejected(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let (token_id, secret) = create_token(&pool, org, 24, None).await;
    let dev = new_device();

    let session = begin(&svc, &token_id, &dev.pubkey).await.expect("begin");
    sqlx::query("UPDATE enrollment_sessions SET expires_at = now() - interval '1 minute'")
        .execute(&pool)
        .await
        .unwrap();
    assert_uniform_rejection(
        &complete(&svc, complete_request(&session, &secret, &dev))
            .await
            .unwrap_err(),
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn session_is_single_use(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let (token_id, secret) = create_token(&pool, org, 24, None).await;
    let dev = new_device();

    let session = begin(&svc, &token_id, &dev.pubkey).await.expect("begin");
    complete(&svc, complete_request(&session, &secret, &dev))
        .await
        .expect("first completion");
    // Replaying the same session (nonce) must fail.
    assert_uniform_rejection(
        &complete(&svc, complete_request(&session, &secret, &dev))
            .await
            .unwrap_err(),
    );
}

// ── re-enrollment ───────────────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn revoked_device_can_reenroll_same_org(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let dev = new_device();

    let (token_id, secret) = create_token(&pool, org, 24, None).await;
    enroll(&svc, &token_id, &secret, &dev).await.expect("first enrollment");

    sqlx::query("UPDATE devices SET state = 'revoked' WHERE device_id = $1")
        .bind(&dev.device_id)
        .execute(&pool)
        .await
        .unwrap();

    let (token2, secret2) = create_token(&pool, org, 24, None).await;
    enroll(&svc, &token2, &secret2, &dev).await.expect("re-enrollment");

    let (_, state) = device_state(&pool, &dev.device_id).await.unwrap();
    assert_eq!(state, "adopted");
    let (via,): (Option<String>,) =
        sqlx::query_as("SELECT enrolled_via_token FROM devices WHERE device_id = $1")
            .bind(&dev.device_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(via.as_deref(), Some(token2.as_str()));
}

#[sqlx::test(migrations = "./migrations")]
async fn adopted_device_cannot_silently_reenroll(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let dev = new_device();

    let (token_id, secret) = create_token(&pool, org, 24, None).await;
    enroll(&svc, &token_id, &secret, &dev).await.expect("first enrollment");

    // Same key, still adopted: a would-be clone with a stolen key and a valid
    // token must not get a certificate without an explicit revoke first.
    let (token2, secret2) = create_token(&pool, org, 24, None).await;
    assert_uniform_rejection(&enroll(&svc, &token2, &secret2, &dev).await.unwrap_err());
}

// ── renewal + clone detection ───────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn renewal_issues_new_cert_and_revoked_device_is_denied(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let dev = new_device();
    let (token_id, secret) = create_token(&pool, org, 24, None).await;
    enroll(&svc, &token_id, &secret, &dev).await.expect("enrollment");

    let ident = DeviceIdentity {
        device_id: dev.device_id.clone(),
        org_id: org,
        pubkey: dev.pubkey.clone(),
    };
    let csr = make_csr(&dev.key, &dev.device_id);
    let resp = renew_with_identity(&svc.state, &ident, &csr, None)
        .await
        .expect("renewal");
    assert!(!resp.client_cert_der.is_empty());
    // Rotation at 2/3 lifetime: renew_after = not_after - lifetime/3.
    assert_eq!(
        resp.not_after_unix - resp.renew_after_unix,
        DEVICE_CERT_DAYS * 24 * 3600 / 3
    );
    assert!(audit_actions(&pool).await.contains(&"cert.renewed".to_string()));

    sqlx::query("UPDATE devices SET state = 'revoked' WHERE device_id = $1")
        .bind(&dev.device_id)
        .execute(&pool)
        .await
        .unwrap();
    let err = renew_with_identity(&svc.state, &ident, &csr, None)
        .await
        .unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
}

#[sqlx::test(migrations = "./migrations")]
async fn clone_detection_raises_org_event(pool: PgPool) {
    let svc = service(&pool);
    let org = create_org(&pool).await;
    let dev = new_device();
    let (token_id, secret) = create_token(&pool, org, 24, None).await;
    enroll(&svc, &token_id, &secret, &dev).await.expect("enrollment");

    let ip1: IpAddr = "203.0.113.10".parse().unwrap();
    let ip2: IpAddr = "198.51.100.7".parse().unwrap();
    report_contact(&svc.state, &dev.device_id, org, ip1).await;
    report_contact(&svc.state, &dev.device_id, org, ip2).await; // concurrent source

    let events: Vec<(String, String)> =
        sqlx::query_as("SELECT severity, title FROM org_events WHERE org_id = $1")
            .bind(org)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        events,
        vec![("warning".to_string(), "Possible cloned device".to_string())]
    );
}
