#!/usr/bin/env bash
# Gracefully update an existing Quartz Command install (Debian/Ubuntu and
# Fedora/RHEL families). Downloads the requested release package, upgrades it
# in place, restarts the backend (embedded migrations run on boot), verifies
# health, then restarts the frontend. The database and the (conffile-marked)
# /etc/quartz-command/*.env files are never touched.
#
#   curl -fsSL https://raw.githubusercontent.com/quartzsystems/quartz-command/main/scripts/update.sh | sudo bash
#
# Environment overrides:
#   QC_REPO=owner/repo       GitHub repo to download from (default quartzsystems/quartz-command)
#   QC_VERSION=1.2.3         Update (or roll back) to a specific release instead of the latest
#   QC_ALLOW_DOWNGRADE=1     Permit installing an older version than the current one.
#                            Note: database migrations are forward-only — rolling back
#                            across a release that migrated the schema may not work.
set -euo pipefail

QC_REPO="${QC_REPO:-quartzsystems/quartz-command}"
QC_VERSION="${QC_VERSION:-}"
QC_ALLOW_DOWNGRADE="${QC_ALLOW_DOWNGRADE:-}"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "this updater must run as root (re-run with sudo)"
command -v systemctl >/dev/null || die "systemd is required"
command -v curl >/dev/null || die "curl is required"

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

# ── current install ─────────────────────────────────────────────────────────

if [ "$FAMILY" = deb ]; then
    INSTALLED="$(dpkg-query -W -f='${Version}' quartz-command 2>/dev/null || true)"
else
    INSTALLED="$(rpm -q --qf '%{VERSION}' quartz-command 2>/dev/null || true)"
    case "$INSTALLED" in *"not installed"*) INSTALLED="" ;; esac
fi
[ -n "$INSTALLED" ] || die "quartz-command is not installed — use scripts/install.sh for a fresh install"

log "Installed version: $INSTALLED"

# ── target release ──────────────────────────────────────────────────────────

if [ -n "$QC_VERSION" ]; then
    API="https://api.github.com/repos/$QC_REPO/releases/tags/v${QC_VERSION#v}"
else
    API="https://api.github.com/repos/$QC_REPO/releases/latest"
fi
JSON="$(curl -fsSL "$API")" || die "could not query GitHub releases for $QC_REPO"
TARGET="$(printf '%s' "$JSON" | grep -oE '"tag_name": *"[^"]+"' | head -n 1 \
    | grep -oE 'v?[0-9][^"]*' | sed 's/^v//')"
[ -n "$TARGET" ] || die "could not determine the release version from $API"

if [ "$TARGET" = "$INSTALLED" ]; then
    log "Already on $INSTALLED — nothing to do."
    exit 0
fi
log "Updating $INSTALLED → $TARGET"

if [ "$FAMILY" = deb ]; then
    ASSET_FILTER="_$(dpkg --print-architecture)\.deb"
else
    ASSET_FILTER="$(uname -m)\.rpm"
fi
URL="$(printf '%s' "$JSON" \
    | grep -oE '"browser_download_url": *"[^"]+"' \
    | grep -oE 'https://[^"]+' \
    | grep -E "$ASSET_FILTER" | head -n 1 || true)"
[ -n "$URL" ] || die "release v$TARGET has no ${FAMILY} package matching '$ASSET_FILTER'"

TMP="$(mktemp -d)"
PKG_FILE="$TMP/${URL##*/}"
log "Downloading ${URL##*/}"
curl -fsSL -o "$PKG_FILE" "$URL"

# ── upgrade ─────────────────────────────────────────────────────────────────
# The package upgrade replaces binaries only; dpkg conffiles / rpm
# %config(noreplace) keep the existing /etc/quartz-command/*.env. Services
# keep running the old code until we restart them below.

log "Installing quartz-command $TARGET"
if [ "$FAMILY" = deb ]; then
    if [ -n "$QC_ALLOW_DOWNGRADE" ]; then
        apt-get install -y -qq --allow-downgrades "$PKG_FILE" || die "package install failed"
    else
        apt-get install -y -qq "$PKG_FILE" \
            || die "package install failed (downgrade? re-run with QC_ALLOW_DOWNGRADE=1)"
    fi
else
    if [ -n "$QC_ALLOW_DOWNGRADE" ]; then
        "$PKG" downgrade -y -q "$PKG_FILE" 2>/dev/null || "$PKG" install -y -q "$PKG_FILE" \
            || die "package install failed"
    else
        "$PKG" install -y -q "$PKG_FILE" \
            || die "package install failed (downgrade? re-run with QC_ALLOW_DOWNGRADE=1)"
    fi
fi

# ── graceful restart: backend first (migrations), verify, then frontend ─────

ROLLBACK_HINT="QC_VERSION=$INSTALLED QC_ALLOW_DOWNGRADE=1 curl -fsSL https://raw.githubusercontent.com/$QC_REPO/main/scripts/update.sh | sudo bash"

log "Restarting backend (database migrations run on startup)"
systemctl restart quartz-command-backend

log "Waiting for the backend to become healthy"
BACKEND_OK=""
for _ in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
        BACKEND_OK=1
        break
    fi
    sleep 1
done
if [ -z "$BACKEND_OK" ]; then
    warn "backend is not healthy after the update"
    warn "  inspect:   journalctl -u quartz-command-backend -n 50"
    warn "  roll back: $ROLLBACK_HINT"
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
echo "    roll back: $ROLLBACK_HINT"
