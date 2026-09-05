#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
SOURCE_DIR="${SCRIPT_DIR}/extension"
INSTALL_HOME="${LKFB_INSTALL_HOME:-${HOME}}"
EXTENSIONS_DIR="${INSTALL_HOME}/Library/Application Support/Adobe/CEP/extensions"
DESTINATION="${EXTENSIONS_DIR}/com.fnnas.seekbridge.mvp"

if [[ ! -d "${SOURCE_DIR}" ]]; then
  print -u2 "找不到安装源：${SOURCE_DIR}"
  exit 1
fi

mkdir -p "${EXTENSIONS_DIR}"
if [[ -e "${DESTINATION}" || -L "${DESTINATION}" ]]; then
  BACKUP="${DESTINATION}.backup.$(date +%Y%m%d-%H%M%S)"
  mv "${DESTINATION}" "${BACKUP}"
  print "旧版本已备份到：${BACKUP}"
fi

ditto --noqtn "${SOURCE_DIR}" "${DESTINATION}"
if [[ "${LKFB_SKIP_DEFAULTS:-0}" != "1" ]]; then
  defaults write com.adobe.CSXS.12 PlayerDebugMode -string "1"
fi

print "LK‘s File Bridge 已安装。"
print "请完整退出并重新打开 Premiere Pro 或 After Effects。"
print "然后选择：窗口 > 扩展 > LK‘s File Bridge"
