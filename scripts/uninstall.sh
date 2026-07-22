#!/usr/bin/env bash
# Completely remove Quartz Command from a Debian/Ubuntu or Fedora/RHEL-family
# host: stops and removes the services and package, drops the PostgreSQL
# database and role, and deletes /etc/quartz-command (env files, TLS certs),
# /var/lib/quartz-command, the nginx site, and the service user. PostgreSQL
# and nginx themselves are left installed — they are shared system packages
# that may serve other things on the host.
#
# Afterwards the host is clean for a fresh scripts/install.sh run.
#
#   curl -fsSL https://raw.githubusercontent.com/quartzsystems/quartz-command/main/scripts/uninstall.sh | sudo bash
#
# Environment overrides:
#   QC_YES=1            Skip the interactive confirmation (required when no
#                       terminal is available to confirm on)
#   QC_KEEP_DATABASE=1  Keep the PostgreSQL database and role (services,
#                       package, and config are still removed)
set -euo pipefail

QC_YES="${QC_YES:-}"
QC_KEEP_DATABASE="${QC_KEEP_DATABASE:-}"

DB_NAME=quartz_command
DB_ROLE=quartz
NGINX_CONF=/etc/nginx/conf.d/quartz-command.conf

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "this uninstaller must run as root (re-run with sudo)"
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

# ── confirmation ────────────────────────────────────────────────────────────
# Read from /dev/tty, not stdin: when piped via `curl | sudo bash`, stdin is
# the script itself.

if [ -z "$QC_YES" ]; then
    if [ -n "$QC_KEEP_DATABASE" ]; then
        DB_NOTE=""
    else
        DB_NOTE=", and the '$DB_NAME' database"
    fi
    if ! { exec 3</dev/tty; } 2>/dev/null; then
        die "no terminal available to confirm on — re-run with QC_YES=1"
    fi
    printf '\033[1;33mThis permanently removes Quartz Command: services, package, config,\nTLS certificates%s.\033[0m\n' "$DB_NOTE" >&2
    printf 'Type "uninstall" to continue: ' >&2
    IFS= read -r -u 3 REPLY || REPLY=""
    exec 3<&-
    [ "$REPLY" = "uninstall" ] || die "aborted — nothing was changed"
fi

# ── services & package ──────────────────────────────────────────────────────

log "Stopping and disabling services"
systemctl disable --now quartz-command-backend quartz-command-frontend >/dev/null 2>&1 || true

if [ "$FAMILY" = deb ]; then
    if dpkg-query -W quartz-command >/dev/null 2>&1; then
        log "Purging the quartz-command package"
        export DEBIAN_FRONTEND=noninteractive
        apt-get purge -y -qq quartz-command || die "package removal failed"
    else
        log "quartz-command package is not installed — cleaning up leftovers anyway"
    fi
else
    if rpm -q quartz-command >/dev/null 2>&1; then
        log "Removing the quartz-command package"
        "$PKG" remove -y -q quartz-command || die "package removal failed"
    else
        log "quartz-command package is not installed — cleaning up leftovers anyway"
    fi
fi

# ── database ────────────────────────────────────────────────────────────────

# Run psql as the postgres superuser (cd / avoids cwd-permission noise).
pg() { (cd / && runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc "$1"); }

if [ -n "$QC_KEEP_DATABASE" ]; then
    log "Keeping the PostgreSQL database and role (QC_KEEP_DATABASE=1)"
elif ! command -v psql >/dev/null 2>&1 || ! getent passwd postgres >/dev/null 2>&1; then
    log "PostgreSQL is not installed — no database to drop"
elif pg 'SELECT 1' >/dev/null 2>&1; then
    log "Dropping database '$DB_NAME' and role '$DB_ROLE'"
    pg "DROP DATABASE IF EXISTS $DB_NAME" >/dev/null || warn "could not drop database '$DB_NAME'"
    pg "DROP ROLE IF EXISTS $DB_ROLE" >/dev/null || warn "could not drop role '$DB_ROLE'"
else
    warn "PostgreSQL server is not reachable — database '$DB_NAME' was not dropped"
fi

# ── nginx site ──────────────────────────────────────────────────────────────
# Only the quartz-command site is removed; nginx itself stays installed.

if [ -f "$NGINX_CONF" ]; then
    log "Removing the nginx site"
    rm -f "$NGINX_CONF"
    if systemctl is-active nginx >/dev/null 2>&1; then
        (nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1) \
            || warn "could not reload nginx"
    fi
fi

# ── files, service user, firewall ───────────────────────────────────────────

log "Removing /etc/quartz-command and /var/lib/quartz-command"
rm -rf /etc/quartz-command /var/lib/quartz-command

if getent passwd quartz-command >/dev/null 2>&1; then
    log "Removing the quartz-command service user"
    userdel quartz-command >/dev/null 2>&1 || warn "could not remove user quartz-command"
fi

# Close the device gateway port the installer opened. 443/https is left open:
# nginx is still installed and may serve other sites on this host.
if systemctl is-active firewalld >/dev/null 2>&1; then
    log "Closing 8443/tcp in firewalld (https/443 is left open)"
    (firewall-cmd --permanent --remove-port=8443/tcp >/dev/null \
        && firewall-cmd --reload >/dev/null) \
        || warn "could not close 8443/tcp in firewalld"
elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    log "Closing 8443/tcp in ufw (443/tcp is left open)"
    ufw delete allow 8443/tcp >/dev/null 2>&1 || warn "could not close 8443/tcp in ufw"
fi

systemctl daemon-reload

echo
log "Quartz Command has been removed."
echo
echo "  Left in place (shared system packages):"
echo "    - PostgreSQL and nginx (only the quartz-command database/site were removed)"
echo "    - port 443 in the firewall"
echo
echo "  For a clean re-install:"
echo "    curl -fsSL https://raw.githubusercontent.com/quartzsystems/quartz-command/main/scripts/install.sh | sudo bash"
