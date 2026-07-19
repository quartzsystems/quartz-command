#!/usr/bin/env bash
# Stamp the version from the root VERSION file (the single source of truth)
# into every manifest that carries one:
#   - backend/Cargo.toml  (+ Cargo.lock, best effort)
#   - frontend/package.json
#
# Run this after editing VERSION; stage.sh also runs it so a package can never
# be built with a drifted version.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d ' \r\n' < "$ROOT/VERSION")"

if [ -z "$VERSION" ]; then
  echo "error: $ROOT/VERSION is empty" >&2
  exit 1
fi

# Only the first `version = "..."` line, i.e. the [package] section at the top.
sed -i -E "0,/^version = \"[^\"]*\"/s//version = \"$VERSION\"/" "$ROOT/backend/Cargo.toml"

# Keep Cargo.lock's entry for our own crate in sync so --locked builds don't
# fail. Offline and best effort: a plain `cargo build` fixes it up anyway.
if command -v cargo >/dev/null 2>&1; then
  cargo update -p quartz-command --offline \
    --manifest-path "$ROOT/backend/Cargo.toml" >/dev/null 2>&1 || true
fi

node -e '
  const fs = require("fs");
  const [file, version] = process.argv.slice(1);
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  pkg.version = version;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
' "$ROOT/frontend/package.json" "$VERSION"

echo "Synced version $VERSION"
