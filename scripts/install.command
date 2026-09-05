#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
SOURCE_DIR="${SCRIPT_DIR:h}/extension"
EXTENSIONS_DIR="${HOME}/Library/Application Support/Adobe/CEP/extensions"
DESTINATION="${EXTENSIONS_DIR}/com.fnnas.seekbridge.mvp"

mkdir -p "${EXTENSIONS_DIR}"

if [[ -L "${DESTINATION}" ]]; then
  CURRENT_TARGET="$(readlink "${DESTINATION}")"
  if [[ "${CURRENT_TARGET}" != "${SOURCE_DIR}" ]]; then
    print "安装位置已被其他软链接占用：${DESTINATION}"
    exit 1
  fi
elif [[ -e "${DESTINATION}" ]]; then
  print "安装位置已有其他文件，未做覆盖：${DESTINATION}"
  exit 1
else
  ln -s "${SOURCE_DIR}" "${DESTINATION}"
fi

defaults write com.adobe.CSXS.12 PlayerDebugMode -string "1"

print "LK‘s File Bridge 已安装。"
print "请完整退出并重新打开 Premiere Pro 或 After Effects。"
print "然后选择：窗口 > 扩展 > LK‘s File Bridge"
