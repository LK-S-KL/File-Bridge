#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
source "${SCRIPT_DIR}/extension-maintenance.zsh"
trap lkfb_finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
lkfb_install "${SCRIPT_DIR}/extension" || exit $?
