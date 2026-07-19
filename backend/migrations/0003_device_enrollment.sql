-- Device enrollment: controller-issued enrollment tokens, adopted devices,
-- short-lived enrollment sessions (nonce store), plus org-scoped events and an
-- audit trail. Cloud-side half of QuartzFire device adoption.

-- Controller-issued enrollment tokens. Only the Argon2id hash of the secret
-- half is stored; the full QC1|… string is shown exactly once at creation.
CREATE TABLE enrollment_tokens (
    token_id    text PRIMARY KEY,             -- "tok_…", URL-safe
    org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    secret_hash text NOT NULL,                -- Argon2id PHC string
    created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,         -- default 24h, set by the API
    max_uses    integer,                      -- NULL = unlimited
    use_count   integer NOT NULL DEFAULT 0,
    revoked_at  timestamptz,
    label       text
);
CREATE INDEX enrollment_tokens_org_idx ON enrollment_tokens (org_id);

-- Adopted (or revoked) QuartzFire devices. device_id is derived from the
-- device's Ed25519 public key ("QF-" + Crockford base32(SHA256(pubkey))[0:16]),
-- so the same key always maps to the same device.
CREATE TABLE devices (
    device_id          text PRIMARY KEY,      -- QF-XXXX-XXXX-XXXX-XXXX
    org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    pubkey             bytea NOT NULL,        -- raw 32-byte Ed25519 public key
    cert_serial        text,                  -- hex serial of the current client cert
    cert_not_after     timestamptz,
    state              text NOT NULL DEFAULT 'pending'
                       CHECK (state IN ('pending', 'adopted', 'revoked')),
    enrolled_at        timestamptz,
    enrolled_via_token text,                  -- token_id; not a FK so token deletion keeps history
    hostname           text,
    qf_version         text,
    last_seen_at       timestamptz,
    last_seen_ip       text,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_org_idx ON devices (org_id);

-- Short-lived (5 min) server-side nonce store for in-flight enrollments.
-- Expired rows are cleaned up opportunistically on BeginEnrollment.
CREATE TABLE enrollment_sessions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id      text NOT NULL,              -- validated again at completion
    device_pubkey bytea NOT NULL,
    nonce         bytea NOT NULL,             -- 32 CSPRNG bytes the device must sign
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL
);
CREATE INDEX enrollment_sessions_expires_idx ON enrollment_sessions (expires_at);

-- Org-visible operational events (e.g. "Possible cloned device"). First pass
-- of a notification system; the console can list these per organization.
CREATE TABLE org_events (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    severity   text NOT NULL DEFAULT 'info'
               CHECK (severity IN ('info', 'warning', 'critical')),
    title      text NOT NULL,
    details    jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX org_events_org_idx ON org_events (org_id, created_at DESC);

-- Append-only audit trail for the enrollment/PKI surface: token
-- created/revoked, enrollment succeeded/failed (with reason), cert
-- issued/renewed, device revoked. org_id is nullable so failures against
-- unknown tokens can still be recorded.
CREATE TABLE audit_log (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     uuid REFERENCES organizations(id) ON DELETE SET NULL,
    actor      text NOT NULL,                 -- "user:<uuid>", "device:<id>", "system"
    action     text NOT NULL,                 -- e.g. "enrollment.failed"
    details    jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_idx ON audit_log (org_id, created_at DESC);
