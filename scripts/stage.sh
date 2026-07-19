#!/usr/bin/env bash
# Build the backend and frontend, then assemble the filesystem tree that both
# the deb and rpm packages install. Runs on Linux (CI or WSL).
#
#   usage: stage.sh <staging-dir>
#
# Installed layout:
#   /usr/bin/quartz-command                  backend binary (migrations embedded)
#   /usr/lib/quartz-command/web/             Next.js standalone build
#   /usr/lib/systemd/system/                 quartz-command-{backend,frontend}.service
#   /etc/quartz-command/{backend,frontend}.env
#   /var/lib/quartz-command/                 state dir (JWT secret files)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${1:?usage: stage.sh <staging-dir>}"

# Stamp the root VERSION file into the manifests before building.
"$ROOT/scripts/sync-version.sh"

cargo build --release --manifest-path "$ROOT/backend/Cargo.toml"

# lucide-react lives in the repo-root package.json, so both npm trees must be
# installed for the build; next.config.js sets the tracing root accordingly.
npm ci --prefix "$ROOT"
npm ci --prefix "$ROOT/frontend"
npm run build --prefix "$ROOT/frontend"

rm -rf "$STAGE"
install -d \
  "$STAGE/usr/bin" \
  "$STAGE/usr/lib/quartz-command" \
  "$STAGE/usr/lib/systemd/system" \
  "$STAGE/etc/quartz-command" \
  "$STAGE/var/lib/quartz-command"

install -m 0755 "$ROOT/backend/target/release/quartz-command" "$STAGE/usr/bin/quartz-command"

# The standalone tree mirrors the repo layout (server.js under frontend/
# because the tracing root is the repo root). Static assets and public/ are
# not traced by Next and must be copied in next to the server.
WEB="$STAGE/usr/lib/quartz-command/web"
cp -a "$ROOT/frontend/.next/standalone" "$WEB"
mkdir -p "$WEB/frontend/.next"
cp -a "$ROOT/frontend/.next/static" "$WEB/frontend/.next/static"
if [ -d "$ROOT/frontend/public" ]; then
  cp -a "$ROOT/frontend/public" "$WEB/frontend/public"
fi

install -m 0640 "$ROOT/scripts/packaging/env/backend.env" "$STAGE/etc/quartz-command/backend.env"
install -m 0644 "$ROOT/scripts/packaging/env/frontend.env" "$STAGE/etc/quartz-command/frontend.env"
install -m 0644 \
  "$ROOT/scripts/packaging/systemd/quartz-command-backend.service" \
  "$ROOT/scripts/packaging/systemd/quartz-command-frontend.service" \
  "$STAGE/usr/lib/systemd/system/"

echo "Staged install tree in $STAGE"
