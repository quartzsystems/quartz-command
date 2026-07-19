#!/usr/bin/env bash
# Build the .rpm package. Needs rpmbuild (apt install rpm / dnf install rpm-build).
#
#   usage: build-rpm.sh
#
# Set QC_STAGE_DIR to reuse an existing staging tree (as the CI workflow does
# to share one build between the deb and rpm); otherwise stage.sh runs first.
# Output lands in dist/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
mkdir -p "$DIST"

VERSION="$(tr -d ' \r\n' < "$ROOT/VERSION")"

STAGE="${QC_STAGE_DIR:-}"
if [ -z "$STAGE" ]; then
  STAGE="$DIST/stage"
  "$ROOT/scripts/stage.sh" "$STAGE"
fi
STAGE="$(cd "$STAGE" && pwd)"   # rpmbuild needs an absolute path

TOP="$DIST/rpmbuild"
rm -rf "$TOP"
mkdir -p "$TOP"

rpmbuild -bb \
  --define "_topdir $TOP" \
  --define "qc_version $VERSION" \
  --define "qc_staging $STAGE" \
  "$ROOT/scripts/packaging/rpm/quartz-command.spec"

OUT="$(find "$TOP/RPMS" -name '*.rpm' -print -quit)"
cp "$OUT" "$DIST/"
rm -rf "$TOP"
echo "Built $DIST/$(basename "$OUT")"
