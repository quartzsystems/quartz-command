//! Shared session primitives for both auth realms (user and admin).
//!
//! Security model ported from QuartzFire's `auth.rs`, adapted from VyOS
//! sha512-crypt verification to Argon2id against PostgreSQL:
//!  1. The browser POSTs `{email, password}` to the realm's `/login`.
//!  2. The backend looks the account up in its table and verifies the password
//!     against the stored Argon2id hash **in a blocking task** (the KDF is
//!     memory-hard and would stall the async runtime).
//!  3. On success it issues a JWT carried in an httpOnly `SameSite=Lax` cookie
//!     (`Secure` in production). JS can never read the token.
//!  4. The realm's `require_*` middleware gates every protected route.
//!
//! Unknown accounts, inactive accounts, and wrong passwords all return a
//! uniform 401, and the unknown-account path still runs a dummy Argon2 verify
//! so its timing is indistinguishable from a real one.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// JWT payload. `sub` is the account's UUID (as a string); `realm` pins the
/// token to the realm that issued it as defence in depth on top of the
/// per-realm signing secret.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub realm: String,
    pub exp: usize,
    pub iat: usize,
}

impl Claims {
    pub fn new(subject: &str, realm: &str, session_hours: u64) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        Self {
            sub: subject.to_string(),
            realm: realm.to_string(),
            iat: now as usize,
            exp: (now + session_hours * 3600) as usize,
        }
    }
}

// ── JWT ─────────────────────────────────────────────────────────────────────

pub fn encode_token(claims: &Claims, secret: &str) -> anyhow::Result<String> {
    encode(
        &Header::default(),
        claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| anyhow::anyhow!("token encode failed: {e}"))
}

/// Decode and validate a token, additionally requiring that it was minted for
/// `expected_realm`. Any failure (bad signature, expiry, wrong realm) yields
/// `None` so callers map it to a uniform 401.
pub fn decode_token(token: &str, secret: &str, expected_realm: &str) -> Option<Claims> {
    let claims = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .ok()?
    .claims;
    (claims.realm == expected_realm).then_some(claims)
}

/// Load a JWT signing secret from `path`, generating and persisting a random
/// one on first start. Falls back to an ephemeral in-memory secret if the file
/// cannot be written (local dev) — sessions then die with the process.
pub fn load_or_create_secret(path: &std::path::Path) -> String {
    match std::fs::read_to_string(path) {
        Ok(s) if !s.trim().is_empty() => return s.trim().to_string(),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => tracing::warn!("could not read secret {}: {e}", path.display()),
    }

    let bytes: [u8; 32] = rand::random();
    let secret: String = bytes.iter().map(|b| format!("{b:02x}")).collect();

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(path, &secret) {
        Ok(()) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
            }
            tracing::info!("generated new session secret at {}", path.display());
        }
        Err(e) => tracing::warn!(
            "could not persist session secret to {} ({e}); sessions will not survive restarts",
            path.display()
        ),
    }
    secret
}

// ── Cookies ─────────────────────────────────────────────────────────────────

/// `Set-Cookie` value carrying the session JWT (httpOnly so JS can't read it).
pub fn session_cookie(name: &str, token: &str, secure: bool, max_age_secs: u64) -> String {
    let mut c = format!("{name}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age_secs}");
    if secure {
        c.push_str("; Secure");
    }
    c
}

/// `Set-Cookie` value that expires the named session cookie immediately.
pub fn clear_cookie(name: &str, secure: bool) -> String {
    let mut c = format!("{name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    if secure {
        c.push_str("; Secure");
    }
    c
}

/// Pull a named cookie's value from the `Cookie` header, falling back to
/// `Authorization: Bearer` (handy for curl/tests).
pub fn extract_token(headers: &axum::http::HeaderMap, cookie_name: &str) -> Option<String> {
    if let Some(cookie) = headers
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
    {
        let prefix = format!("{cookie_name}=");
        for part in cookie.split(';') {
            if let Some(val) = part.trim().strip_prefix(&prefix) {
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(str::to_string)
}

// ── Argon2id password hashing ────────────────────────────────────────────────

/// Hash a plaintext password into an Argon2id PHC string (for the seed CLI /
/// account creation). Runs on the caller's thread; callers doing this in a
/// request path should wrap it in `spawn_blocking`.
pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("password hash failed: {e}"))
}

/// A syntactically valid but unmatchable Argon2id hash used to burn the same
/// verification work when an account does not exist, so login timing can't be
/// used to enumerate accounts. Computed once from a random throwaway password.
fn dummy_hash() -> &'static str {
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| {
        let bytes: [u8; 16] = rand::random();
        let throwaway: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        hash_password(&throwaway).expect("dummy hash generation")
    })
}

/// Verify `password` against a stored Argon2id hash. When `stored` is `None`
/// (unknown or inactive account) it verifies against a dummy hash and returns
/// `false`, keeping the timing indistinguishable from a real verification.
///
/// Blocking + CPU-heavy: call inside `tokio::task::spawn_blocking`.
pub fn verify_password(password: &str, stored: Option<&str>) -> bool {
    let hash_str = stored.unwrap_or_else(|| dummy_hash());
    let parsed = match PasswordHash::new(hash_str) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let ok = Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok();
    // Never report success for the dummy path even in the (impossible) case of
    // a collision.
    ok && stored.is_some()
}
