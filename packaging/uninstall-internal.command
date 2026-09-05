#!/bin/zsh
set -euo pipefail

DESTINATION="${HOME}/Library/Application Support/Adobe/CEP/extensions/com.fnnas.seekbridge.mvp"

if [[ ! -e "${DESTINATION}" && ! -L "${DESTINATION}" ]]; then
  print "未找到 LK‘s File Bridge，无需卸载。"
  exit 0
fi

if command -v trash >/dev/null 2>&1; then
  trash "${DESTINATION}"
else
  BACKUP="${DESTINATION}.removed.$(date +%Y%m%d-%H%M%S)"
  mv "${DESTINATION}" "${BACKUP}"
  print "系统没有 trash 命令，已移动到：${BACKUP}"
fi
print "LK‘s File Bridge 已卸载。重新打开 Adobe 软件后生效。"
