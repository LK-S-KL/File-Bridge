#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
exec node "${PROJECT_ROOT}/scripts/package-macos.cjs" "$@"
