-- Quartz Command — initial schema.
-- Two auth realms (users, admins) kept in separate tables, plus multi-tenant
-- organizations with a many-to-many membership join.

-- gen_random_uuid() lives in pgcrypto on PostgreSQL < 13; harmless on 13+.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Cloud-console users (the /login realm).
CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL,
    full_name     text,
    password_hash text NOT NULL,          -- Argon2id PHC string
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Case-insensitive email uniqueness (login normalizes with lower()).
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

-- Platform administrators (the /admin/login realm) — a separate table so admin
-- credentials never share storage with customer users.
CREATE TABLE admins (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL,
    full_name     text,
    password_hash text NOT NULL,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admins_email_lower_idx ON admins (lower(email));

-- Tenant organizations. `id` IS the organization_guid used in /cloud/{guid}.
CREATE TABLE organizations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    slug       text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Membership: which users belong to which organizations, and their role there.
CREATE TABLE memberships (
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role            text NOT NULL DEFAULT 'member',
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, organization_id)
);
-- Reverse lookup: members of an organization.
CREATE INDEX memberships_org_idx ON memberships (organization_id);
