#!/usr/bin/env bash
# Build the .deb package. Runs on Debian/Ubuntu (CI or WSL).
#
#   usage: build-deb.sh
#
# Set QC_STAGE_DIR to reuse an existing staging tree (as the CI workflow does
# to share one build between the deb and rpm); otherwise stage.sh runs first.
# Output lands in dist/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
mkdir -p "$DIST"

VERSION="$(tr -d ' \r\n' < "$ROOT/VERSION")"
ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"

STAGE="${QC_STAGE_DIR:-}"
if [ -z "$STAGE" ]; then
  STAGE="$DIST/stage"
  bash "$ROOT/scripts/stage.sh" "$STAGE"
fi

PKG="$DIST/deb-root"
rm -rf "$PKG"
mkdir -p "$PKG/DEBIAN"
cp -a "$STAGE/." "$PKG/"

INSTALLED_SIZE="$(du -sk "$PKG" | cut -f 1)"
cat > "$PKG/DEBIAN/control" <<EOF
Package: quartz-command
Version: $VERSION
Section: web
Priority: optional
Architecture: $ARCH
Depends: nodejs (>= 18.17)
Recommends: postgresql
Installed-Size: $INSTALLED_SIZE
Maintainer: Cody Wellman <cwellman@quartz.systems>
Homepage: https://github.com/zagdrath/quartz-command
Description: Quartz Command cloud console
 Backend API (Rust/axum over PostgreSQL, with embedded migrations) and
 Next.js web frontend, run as the quartz-command-backend and
 quartz-command-frontend systemd services.
EOF

cat > "$PKG/DEBIAN/conffiles" <<EOF
/etc/quartz-command/backend.env
/etc/quartz-command/frontend.env
EOF

install -m 0755 "$ROOT/scripts/packaging/deb/postinst" \
                "$ROOT/scripts/packaging/deb/prerm" \
                "$ROOT/scripts/packaging/deb/postrm" \
                "$PKG/DEBIAN/"

OUT="$DIST/quartz-command_${VERSION}_${ARCH}.deb"
dpkg-deb --build --root-owner-group "$PKG" "$OUT"
rm -rf "$PKG"
echo "Built $OUT"
