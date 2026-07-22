#!/usr/bin/env bash
# Deprecated wrapper: the update flow now lives in scripts/install.sh, which
# detects an existing install and upgrades it in place (graceful restart,
# health check, rollback hint). This file stays so the previously documented
# one-liner keeps working — it simply runs the installer.
#
#   curl -fsSL https://raw.githubusercontent.com/quartzsystems/quartz-command/main/scripts/update.sh | sudo bash
#
# Environment overrides are passed through: QC_REPO, QC_VERSION,
# QC_ALLOW_DOWNGRADE (see scripts/install.sh).
set -euo pipefail

export QC_REPO="${QC_REPO:-quartzsystems/quartz-command}"
if [ -n "${QC_VERSION:-}" ]; then export QC_VERSION; fi
if [ -n "${QC_ALLOW_DOWNGRADE:-}" ]; then export QC_ALLOW_DOWNGRADE; fi

# Run the sibling install.sh when executed from a checkout; when piped via
# curl there is no local file, so fetch it from the same repo.
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/install.sh" ]; then
    exec bash "$(dirname "${BASH_SOURCE[0]}")/install.sh"
fi
curl -fsSL "https://raw.githubusercontent.com/$QC_REPO/main/scripts/install.sh" | bash
