#!/usr/bin/env bash
# Universal Quartz Command installer for Debian/Ubuntu and Fedora/RHEL-family
# Linux. Installs PostgreSQL from the distro repos, provisions the role and
# database, installs the latest quartz-command .deb/.rpm from GitHub releases,
# writes /etc/quartz-command/backend.env, puts nginx on :443 (self-signed TLS,
# proxying the loopback frontend), and starts the systemd services.
#
#   curl -fsSL https://raw.githubusercontent.com/quartzsystems/quartz-command/main/scripts/install.sh | sudo bash
#
# Environment overrides:
#   QC_REPO=owner/repo     GitHub repo to download from (default quartzsystems/quartz-command)
#   QC_VERSION=1.2.3       Install a specific release instead of the latest
#
# Safe to re-run: existing PostgreSQL data, an already-configured backend.env,
# and running services are left alone; the package itself is upgraded.
set -euo pipefail

QC_REPO="${QC_REPO:-quartzsystems/quartz-command}"
QC_VERSION="${QC_VERSION:-}"

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

open_firewall() {
    if systemctl is-active firewalld >/dev/null 2>&1; then
        log "Opening https in firewalld"
        (firewall-cmd --permanent --add-service=https >/dev/null \
            && firewall-cmd --reload >/dev/null) \
            || warn "could not open 443/tcp in firewalld"
    elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
        log "Opening 443/tcp in ufw"
        ufw allow 443/tcp >/dev/null 2>&1 || warn "could not open 443/tcp in ufw"
    fi
}

# ── quartz-command package ──────────────────────────────────────────────────

download_package() {
    local api asset_filter json url tmp
    if [ -n "$QC_VERSION" ]; then
        api="https://api.github.com/repos/$QC_REPO/releases/tags/v${QC_VERSION#v}"
    else
        api="https://api.github.com/repos/$QC_REPO/releases/latest"
    fi

    if [ "$FAMILY" = deb ]; then
        asset_filter="_$(dpkg --print-architecture)\.deb"
    else
        asset_filter="$(uname -m)\.rpm"
    fi

    log "Looking up release assets ($api)"
    json="$(curl -fsSL "$api")" || die "could not query GitHub releases for $QC_REPO"
    url="$(printf '%s' "$json" \
        | grep -oE '"browser_download_url": *"[^"]+"' \
        | grep -oE 'https://[^"]+' \
        | grep -E "$asset_filter" | head -n 1 || true)"
    [ -n "$url" ] || die "no ${FAMILY} package matching '$asset_filter' in the release — build one with scripts/build-${FAMILY}.sh"

    tmp="$(mktemp -d)"
    PKG_FILE="$tmp/${url##*/}"
    log "Downloading ${url##*/}"
    curl -fsSL -o "$PKG_FILE" "$url"
}

install_package() {
    log "Installing quartz-command package"
    if [ "$FAMILY" = deb ]; then
        # apt resolves the nodejs dependency from the distro repos.
        apt-get install -y -qq "$PKG_FILE" || die "package install failed — the distro's nodejs may be older than 18.17; install Node 18+ and re-run"
    else
        if ! "$PKG" install -y -q "$PKG_FILE"; then
            # RHEL 8/9 default nodejs module stream can be < 18; try a newer
            # stream and retry once. (Fedora has no module streams; this is a
            # harmless no-op failure there.)
            warn "install failed — enabling the nodejs:20 module stream and retrying"
            "$PKG" -y module reset nodejs >/dev/null 2>&1 || true
            "$PKG" -y module enable nodejs:20 >/dev/null 2>&1 || true
            "$PKG" install -y -q "$PKG_FILE" || die "package install failed"
        fi
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
    systemctl enable --now quartz-command-backend quartz-command-frontend >/dev/null 2>&1

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

install_postgres
fix_pg_hba
provision_database
install_web_proxy
download_package
install_package
configure_backend
start_services

HOST_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_ADDR="${HOST_ADDR:-127.0.0.1}"

echo
log "Quartz Command is installed."
echo
echo "  Web console:   https://$HOST_ADDR/login"
echo "  Admin console: https://$HOST_ADDR/admin/login"
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
