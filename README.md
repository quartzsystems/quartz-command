# Quartz Command

Cloud console for Quartz Systems. TypeScript **Next.js** frontend (Tailwind CSS,
Quartz Systems design system) on a **Rust + PostgreSQL** backend.

The login page and its security model are ported from
[QuartzFire](../quartz-fire/quartzfire-webui): a JWT carried in an httpOnly
`SameSite=Lax` cookie, uniform 401s that don't leak which accounts exist, and
timing-safe password verification. Passwords here are hashed with **Argon2id**
in PostgreSQL (QuartzFire verifies VyOS's sha512-crypt hashes instead).

## Layout

```
frontend/            Next.js 14 app-router, Tailwind v4
backend/             Rust axum + sqlx (PostgreSQL)
  migrations/        SQL migrations (run automatically on boot)
  .env.example       Copy to .env and set DATABASE_URL etc.
```

## Realms & routes

Two fully separate auth realms, each with its own DB table, session cookie, and
JWT signing secret — a user token can never satisfy admin auth, and vice versa.

| Realm | Login | Console | Table | Cookie |
|-------|-------|---------|-------|--------|
| User  | `/login`        | `/cloud`, `/cloud/{organization_guid}` | `users`  | `qc_session`       |
| Admin | `/admin/login`  | `/admin`                                | `admins` | `qc_admin_session` |

Users belong to many organizations via the `memberships` table (a role per org).
`/cloud` lists the signed-in user's orgs (or redirects when there's exactly one);
`/cloud/{organization_guid}` renders an org the user is a member of (403 otherwise).

## Install

One-liner for Debian/Ubuntu and Fedora/RHEL-family servers (needs systemd):

```sh
curl -fsSL https://raw.githubusercontent.com/quartzsystems/quartz-command/main/scripts/install.sh | sudo bash
```

The script installs PostgreSQL from the distro repos, creates the `quartz`
role and `quartz_command` database with a random password, installs the latest
released `.deb`/`.rpm`, writes `/etc/quartz-command/backend.env`, seeds a
default admin (credentials are printed once at the end), and starts the
`quartz-command-backend` and `quartz-command-frontend` services. Pin a release
with `QC_VERSION=x.y.z`; re-running upgrades the package without touching an
existing database or config.

The console is served at **`https://<host>/`** — the installer puts nginx on
:443 as a TLS terminator (self-signed certificate, so the browser warns once)
in front of the loopback-only frontend, and opens 443 in firewalld/ufw when
active. To use a real certificate, replace
`/etc/quartz-command/tls/{cert,key}.pem` and `systemctl reload nginx`.

### Update

```sh
curl -fsSL https://raw.githubusercontent.com/quartzsystems/quartz-command/main/scripts/update.sh | sudo bash
```

Upgrades the package to the latest release without touching the database or
your edited config files, restarts the backend first (migrations run on
startup) and verifies `/api/health` before restarting the frontend. On
failure it prints a pinned rollback one-liner. `QC_VERSION=x.y.z` targets a
specific release; add `QC_ALLOW_DOWNGRADE=1` to roll back (schema migrations
are forward-only — don't roll back across a release that migrated).

## Development

1. **Database** — run PostgreSQL yourself (local install, managed service, etc.),
   then create the role/database and point `DATABASE_URL` at it:

   ```sh
   createdb quartz_command
   psql -c "CREATE ROLE quartz LOGIN PASSWORD 'quartz'; GRANT ALL ON DATABASE quartz_command TO quartz;"
   ```

2. **Backend** (`backend/`) — needs a Rust toolchain. `backend/.env` is loaded
   automatically (no shell `export` needed — handy on Windows/PowerShell).
   Migrations run on startup, and a default admin (`QC_DEFAULT_ADMIN_*`) is
   seeded when the `admins` table is empty, so `/admin/login` works immediately
   on a fresh database.

   ```sh
   cd backend
   cp .env.example .env           # set DATABASE_URL; QC_COOKIE_SECURE=false for http

   cargo run                      # migrates, seeds the default admin, serves :8080
   ```

   Seed console (user) accounts to test with. Passwords are prompted (no echo);
   set `QC_SEED_PASSWORD` to run non-interactively (scripts / PowerShell):

   ```sh
   cargo run -- seed-user  alice@example.com "Alice"
   cargo run -- seed-org   "Acme Inc" acme
   cargo run -- add-member alice@example.com acme owner
   cargo run -- seed-admin root@example.com "Root"   # more admins if needed
   ```

3. **Frontend** (`frontend/`) — needs Node. Proxies `/api/*` to the backend so
   the session cookie stays first-party (override the target with `QC_API_URL`).

   ```sh
   cd frontend
   npm install
   npm run dev                    # http://localhost:3000
   ```

Visit <http://localhost:3000/login> (user) or <http://localhost:3000/admin/login>
(admin).

## Security notes

- Session tokens live in httpOnly cookies; JavaScript never reads them. The only
  client-side state is a non-sensitive cached user for display.
- Login returns a uniform *invalid credentials* error for unknown accounts,
  inactive accounts, and wrong passwords; the unknown-account path still runs a
  dummy Argon2 verification so response timing can't be used to enumerate emails.
- Every protected route is enforced server-side by realm-specific middleware; the
  frontend guards only avoid rendering protected UI to an unauthenticated visitor.
- Set `QC_COOKIE_SECURE=true` (the default) in production, behind TLS.
