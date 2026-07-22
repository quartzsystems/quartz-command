#!/usr/bin/env bash
# Universal Quartz Command installer & updater for Debian/Ubuntu and
# Fedora/RHEL-family Linux.
#
# Fresh host: installs PostgreSQL from the distro repos, provisions the role
# and database, installs the latest quartz-command .deb/.rpm from GitHub
# releases, writes /etc/quartz-command/backend.env, puts nginx on :443
# (self-signed TLS, proxying the loopback frontend), and starts the systemd
# services.
#
# Host with an existing, configured install: switches to update mode — the
# database and the (conffile-marked) /etc/quartz-command/*.env files are never
# touched. Downloads the requested release, upgrades the package in place,
# restarts the backend (embedded migrations run on boot), verifies health,
# then restarts the frontend.
#
#   curl -fsSL https://raw.githubusercontent.com/quartzsystems/quartz-command/main/scripts/install.sh | sudo bash
#
# Environment overrides:
#   QC_REPO=owner/repo       GitHub repo to download from (default quartzsystems/quartz-command)
#   QC_VERSION=1.2.3         Install/update to a specific release instead of the latest
#   QC_ALLOW_DOWNGRADE=1     Permit installing an older version than the current one.
#                            Note: database migrations are forward-only — rolling back
#                            across a release that migrated the schema may not work.
set -euo pipefail

QC_REPO="${QC_REPO:-quartzsystems/quartz-command}"
QC_VERSION="${QC_VERSION:-}"
QC_ALLOW_DOWNGRADE="${QC_ALLOW_DOWNGRADE:-}"

ENV_FILE=/etc/quartz-command/backend.env
TLS_DIR=/etc/quartz-command/tls
NGINX_CONF=/etc/nginx/conf.d/quartz-command.conf
DB_NAME=quartz_command
DB_ROLE=quartz

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "this installer must run as root (re-run with sudo)"
command -v systemctl >/dev/null || die "systemd is required"

# ── distro detection ────────────────────────────────────────────────────────

[ -r /etc/os-release ] || die "cannot detect the distribution (/etc/os-release missing)"
. /etc/os-release
case " $ID ${ID_LIKE:-} " in
    *" debian "*|*" ubuntu "*) FAMILY=deb ;;
    *" fedora "*|*" rhel "*|*" centos "*) FAMILY=rpm ;;
    *) die "unsupported distribution: $ID (Debian/Ubuntu and Fedora/RHEL families are supported)" ;;
esac

if [ "$FAMILY" = rpm ]; then
    PKG=dnf
    command -v dnf >/dev/null || PKG=yum
fi

log "Detected $PRETTY_NAME ($FAMILY-family)"

# ── release lookup & download (shared by install and update modes) ──────────

# Sets RELEASE_JSON and TARGET (the release version, without the leading v).
fetch_release() {
    local api
    if [ -n "$QC_VERSION" ]; then
        api="https://api.github.com/repos/$QC_REPO/releases/tags/v${QC_VERSION#v}"
    else
        api="https://api.github.com/repos/$QC_REPO/releases/latest"
    fi
    log "Looking up release assets ($api)"
    RELEASE_JSON="$(curl -fsSL "$api")" || die "could not query GitHub releases for $QC_REPO"
    TARGET="$(printf '%s' "$RELEASE_JSON" | grep -oE '"tag_name": *"[^"]+"' | head -n 1 \
        | grep -oE 'v?[0-9][^"]*' | sed 's/^v//')"
    [ -n "$TARGET" ] || die "could not determine the release version from $api"
}

# Sets PKG_FILE to the downloaded .deb/.rpm for this machine's architecture.
download_package() {
    local asset_filter url tmp
    if [ "$FAMILY" = deb ]; then
        asset_filter="_$(dpkg --print-architecture)\.deb"
    else
        asset_filter="$(uname -m)\.rpm"
    fi
    url="$(printf '%s' "$RELEASE_JSON" \
        | grep -oE '"browser_download_url": *"[^"]+"' \
        | grep -oE 'https://[^"]+' \
        | grep -E "$asset_filter" | head -n 1 || true)"
    [ -n "$url" ] || die "release v$TARGET has no ${FAMILY} package matching '$asset_filter' — build one with scripts/build-${FAMILY}.sh"

    tmp="$(mktemp -d)"
    PKG_FILE="$tmp/${url##*/}"
    log "Downloading ${url##*/}"
    curl -fsSL -o "$PKG_FILE" "$url"
}

install_package() {
    log "Installing quartz-command $TARGET"
    if [ "$FAMILY" = deb ]; then
        if [ -n "$QC_ALLOW_DOWNGRADE" ]; then
            apt-get install -y -qq --allow-downgrades "$PKG_FILE" || die "package install failed"
        else
            apt-get install -y -qq "$PKG_FILE" \
                || die "package install failed — a downgrade needs QC_ALLOW_DOWNGRADE=1; on a fresh install the distro's nodejs may be older than 18.17"
        fi
    else
        if [ -n "$QC_ALLOW_DOWNGRADE" ]; then
            "$PKG" downgrade -y -q "$PKG_FILE" 2>/dev/null \
                || "$PKG" install -y -q "$PKG_FILE" \
                || die "package install failed"
        elif ! "$PKG" install -y -q "$PKG_FILE"; then
            # RHEL 8/9 default nodejs module stream can be < 18; try a newer
            # stream and retry once. (Fedora has no module streams; this is a
            # harmless no-op failure there.)
            warn "install failed — enabling the nodejs:20 module stream and retrying"
            "$PKG" -y module reset nodejs >/dev/null 2>&1 || true
            "$PKG" -y module enable nodejs:20 >/dev/null 2>&1 || true
            "$PKG" install -y -q "$PKG_FILE" \
                || die "package install failed (downgrade? re-run with QC_ALLOW_DOWNGRADE=1)"
        fi
    fi
}

# ── update mode ─────────────────────────────────────────────────────────────

installed_version() {
    if [ "$FAMILY" = deb ]; then
        dpkg-query -W -f='${Version}' quartz-command 2>/dev/null || true
    else
        local v
        v="$(rpm -q --qf '%{VERSION}' quartz-command 2>/dev/null || true)"
        case "$v" in *"not installed"*) v="" ;; esac
        printf '%s' "$v"
    fi
}

run_update() {
    command -v curl >/dev/null || die "curl is required"
    log "Existing install detected (quartz-command $INSTALLED) — running in update mode"

    fetch_release
    if [ "$TARGET" = "$INSTALLED" ]; then
        log "Already on $INSTALLED — nothing to do."
        log "(Services were left alone; to restart them anyway: systemctl restart quartz-command-backend quartz-command-frontend)"
        exit 0
    fi
    log "Updating $INSTALLED → $TARGET"

    download_package
    install_package

    # Graceful restart: backend first (migrations run on startup), verify
    # health, then the frontend. The package upgrade replaced binaries only;
    # dpkg conffiles / rpm %config(noreplace) keep /etc/quartz-command/*.env.
    local rollback_hint="QC_VERSION=$INSTALLED QC_ALLOW_DOWNGRADE=1 curl -fsSL https://raw.githubusercontent.com/$QC_REPO/main/scripts/install.sh | sudo bash"

    log "Restarting backend (database migrations run on startup)"
    systemctl restart quartz-command-backend

    log "Waiting for the backend to become healthy"
    local backend_ok=""
    for _ in $(seq 1 60); do
        if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
            backend_ok=1
            break
        fi
        sleep 1
    done
    if [ -z "$backend_ok" ]; then
        warn "backend is not healthy after the update"
        warn "  inspect:   journalctl -u quartz-command-backend -n 50"
        warn "  roll back: $rollback_hint"
        die "update to $TARGET failed health check"
    fi

    log "Restarting frontend"
    systemctl restart quartz-command-frontend
    for _ in $(seq 1 30); do
        if curl -fsSk https://127.0.0.1/login >/dev/null 2>&1 \
            || curl -fsS http://127.0.0.1:3000/login >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done

    echo
    log "Quartz Command updated: $INSTALLED → $TARGET"
    echo
    echo "  If anything looks wrong:"
    echo "    logs:      journalctl -u quartz-command-backend -u quartz-command-frontend"
    echo "    roll back: $rollback_hint"
    exit 0
}

INSTALLED="$(installed_version)"
if [ -n "$INSTALLED" ] && [ -f "$ENV_FILE" ] && ! grep -q 'CHANGE_ME' "$ENV_FILE"; then
    run_update # exits when done
fi

# ── fresh install from here on ──────────────────────────────────────────────
# (Also reached when the package is present but backend.env was never
# configured — a broken or half-finished install gets re-provisioned.)

# ── prerequisites ───────────────────────────────────────────────────────────

if [ "$FAMILY" = deb ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    command -v curl >/dev/null || apt-get install -y -qq curl ca-certificates
else
    command -v curl >/dev/null || "$PKG" install -y -q curl
fi

# 32 hex chars from 16 CSPRNG bytes. Deliberately avoids the classic
# `tr </dev/urandom | head` construction: head closing the pipe SIGPIPEs tr,
# which `set -o pipefail` turns into a script-killing failure.
random_secret() { od -An -tx1 -N16 /dev/urandom | tr -d ' \n'; }

# ── PostgreSQL ──────────────────────────────────────────────────────────────

install_postgres() {
    # contrib is required: migration 0001 does CREATE EXTENSION pgcrypto, and
    # the RHEL-family server package ships without the contrib modules.
    if [ "$FAMILY" = deb ]; then
        log "Installing PostgreSQL"
        apt-get install -y -qq postgresql postgresql-contrib
        PG_SERVICE=postgresql
    else
        log "Installing PostgreSQL server"
        "$PKG" install -y -q postgresql-server postgresql-contrib
        PG_SERVICE=postgresql
        # Fedora/RHEL packages ship without an initialized cluster.
        if [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then
            log "Initializing PostgreSQL cluster"
            postgresql-setup --initdb >/dev/null
        fi
    fi
    systemctl enable --now "$PG_SERVICE" >/dev/null 2>&1
}

# Run psql as the postgres superuser (cd / avoids cwd-permission noise).
pg() { (cd / && runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc "$1"); }

# The RHEL-family default pg_hba.conf uses `ident` for TCP connections, which
# rejects password logins; switch those lines to scram so the backend can
# authenticate over 127.0.0.1. (Debian's default is already scram/md5.)
fix_pg_hba() {
    local hba
    hba="$(pg 'SHOW hba_file')"
    if grep -Eq '^host.*\bident$' "$hba"; then
        log "Switching pg_hba host auth from ident to scram-sha-256"
        sed -i -E 's/^(host.*[[:space:]])ident$/\1scram-sha-256/' "$hba"
        systemctl reload "$PG_SERVICE"
    fi
}

provision_database() {
    DB_PASSWORD="$(random_secret)"
    if pg "SELECT 1 FROM pg_roles WHERE rolname = '$DB_ROLE'" | grep -q 1; then
        # On a re-run, backend.env is already configured and configure_backend
        # leaves it untouched — resetting the role password here would strand
        # the env file with stale credentials.
        if [ -f "$ENV_FILE" ] && ! grep -q 'CHANGE_ME' "$ENV_FILE"; then
            log "Role '$DB_ROLE' and configured $ENV_FILE exist — leaving credentials alone"
        else
            log "Role '$DB_ROLE' exists — resetting its password for this install"
            pg "ALTER ROLE $DB_ROLE WITH LOGIN PASSWORD '$DB_PASSWORD'" >/dev/null
        fi
    else
        log "Creating PostgreSQL role '$DB_ROLE'"
        pg "CREATE ROLE $DB_ROLE WITH LOGIN PASSWORD '$DB_PASSWORD'" >/dev/null
    fi
    if ! pg "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
        log "Creating database '$DB_NAME'"
        pg "CREATE DATABASE $DB_NAME OWNER $DB_ROLE" >/dev/null
    fi
}

# ── web front end: nginx on :443 ────────────────────────────────────────────
# The packaged Next.js server is plain HTTP on 127.0.0.1:3000 and runs
# unprivileged; nginx terminates TLS on 443 in front of it so the console is
# reachable at https://<host>/ out of the box. The generated self-signed cert
# lives in /etc/quartz-command/tls/ — drop a real cert/key over it and
# `systemctl reload nginx` to replace it.

install_web_proxy() {
    log "Installing nginx (TLS front end on :443)"
    if [ "$FAMILY" = deb ]; then
        apt-get install -y -qq nginx openssl
    else
        "$PKG" install -y -q nginx openssl
    fi

    if [ ! -f "$TLS_DIR/cert.pem" ]; then
        log "Generating a self-signed TLS certificate"
        mkdir -p "$TLS_DIR"
        local host
        host="$(hostname -f 2>/dev/null || hostname)"
        openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
            -keyout "$TLS_DIR/key.pem" -out "$TLS_DIR/cert.pem" \
            -subj "/CN=$host" \
            -addext "subjectAltName=DNS:$host,IP:127.0.0.1" >/dev/null 2>&1 \
            || die "could not generate the TLS certificate"
        chmod 0600 "$TLS_DIR/key.pem"
    fi

    cat > "$NGINX_CONF" <<'EOF'
# Quartz Command web console — TLS termination for the Next.js frontend on
# 127.0.0.1:3000 (which forwards /api to the backend itself). Written by
# scripts/install.sh. To use a real certificate, replace the files in
# /etc/quartz-command/tls/ and `systemctl reload nginx`.
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name _;

    ssl_certificate     /etc/quartz-command/tls/cert.pem;
    ssl_certificate_key /etc/quartz-command/tls/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
EOF

    # SELinux (RHEL family): out of the box nginx may not open outbound
    # connections, which would 502 every request to the upstream on :3000.
    if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
        log "Allowing nginx to reach the frontend (SELinux httpd_can_network_connect)"
        setsebool -P httpd_can_network_connect 1 \
            || warn "could not set httpd_can_network_connect — nginx may return 502"
    fi

    nginx -t >/dev/null 2>&1 || die "nginx configuration test failed (nginx -t)"
    systemctl enable --now nginx >/dev/null 2>&1
    systemctl reload nginx >/dev/null 2>&1 || true

    open_firewall
}

# 443 is the web console; 8443 is the device gateway (gRPC) devices dial.
open_firewall() {
    if systemctl is-active firewalld >/dev/null 2>&1; then
        log "Opening https and 8443/tcp in firewalld"
        (firewall-cmd --permanent --add-service=https >/dev/null \
            && firewall-cmd --permanent --add-port=8443/tcp >/dev/null \
            && firewall-cmd --reload >/dev/null) \
            || warn "could not open 443+8443/tcp in firewalld"
    elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
        log "Opening 443/tcp and 8443/tcp in ufw"
        (ufw allow 443/tcp >/dev/null 2>&1 && ufw allow 8443/tcp >/dev/null 2>&1) \
            || warn "could not open 443+8443/tcp in ufw"
    fi
}

# ── configuration ───────────────────────────────────────────────────────────

configure_backend() {
    [ -f "$ENV_FILE" ] || die "$ENV_FILE missing after package install"

    if ! grep -q 'CHANGE_ME' "$ENV_FILE"; then
        log "$ENV_FILE already configured — leaving it untouched"
        ADMIN_PASSWORD=""
        return
    fi

    log "Writing DATABASE_URL to $ENV_FILE"
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://$DB_ROLE:$DB_PASSWORD@127.0.0.1/$DB_NAME|" "$ENV_FILE"

    # The address devices dial for enrollment — baked into enrollment tokens.
    # Best guess is this host's primary address; correct it later in the admin
    # console (Settings -> Server) if devices should use another name.
    log "Setting the device gateway address to $HOST_ADDR:8443"
    sed -i "s|^QC_GATEWAY_ADDR=.*|QC_GATEWAY_ADDR=$HOST_ADDR:8443|" "$ENV_FILE"

    # QC_COOKIE_SECURE stays true (the template default): the console is
    # served over TLS by nginx on :443.

    # Seed a default admin (only takes effect while the admins table is empty).
    ADMIN_PASSWORD="$(random_secret)"
    sed -i "s|^#QC_DEFAULT_ADMIN_EMAIL=.*|QC_DEFAULT_ADMIN_EMAIL=admin@quartz.local|" "$ENV_FILE"
    sed -i "s|^#QC_DEFAULT_ADMIN_PASSWORD=.*|QC_DEFAULT_ADMIN_PASSWORD=$ADMIN_PASSWORD|" "$ENV_FILE"
}

start_services() {
    log "Starting services"
    systemctl daemon-reload
    systemctl enable quartz-command-backend quartz-command-frontend >/dev/null 2>&1
    # restart (not `enable --now`): if a half-configured install left services
    # running, they must pick up the freshly written backend.env.
    systemctl restart quartz-command-backend quartz-command-frontend

    log "Waiting for the backend to come up"
    local backend_ok=""
    for _ in $(seq 1 30); do
        if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
            backend_ok=1
            break
        fi
        sleep 1
    done
    [ -n "$backend_ok" ] \
        || warn "backend did not answer /api/health yet — check: journalctl -u quartz-command-backend"

    log "Waiting for the console on :443"
    for _ in $(seq 1 30); do
        # -k: the generated cert is self-signed.
        if curl -fsSk https://127.0.0.1/login >/dev/null 2>&1; then
            return
        fi
        sleep 1
    done
    warn "https://127.0.0.1/ not answering yet — check: journalctl -u quartz-command-frontend -u nginx"
}

# ── run ─────────────────────────────────────────────────────────────────────

# This host's primary address: used for the device gateway address written to
# backend.env and for the URLs printed at the end.
HOST_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_ADDR="${HOST_ADDR:-127.0.0.1}"

install_postgres
fix_pg_hba
provision_database
install_web_proxy
fetch_release
download_package
install_package
configure_backend
start_services

echo
log "Quartz Command is installed."
echo
echo "  Web console:    https://$HOST_ADDR/login"
echo "  Admin console:  https://$HOST_ADDR/admin/login"
echo "  Device gateway: $HOST_ADDR:8443 (change in the admin console: Settings -> Server)"
if [ -n "${ADMIN_PASSWORD:-}" ]; then
    echo
    echo "  Default admin account (change the password after first login):"
    echo "    email:    admin@quartz.local"
    echo "    password: $ADMIN_PASSWORD"
fi
echo
echo "  Config:  /etc/quartz-command/{backend,frontend}.env"
echo "  Logs:    journalctl -u quartz-command-backend -u quartz-command-frontend -u nginx"
echo
echo "  The console is served by nginx on :443 with a self-signed certificate"
echo "  (your browser will warn once). To use a real certificate, replace"
echo "  $TLS_DIR/{cert,key}.pem and run: systemctl reload nginx"
