#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
SOURCE_DIR="${SCRIPT_DIR:h}/extension"
DESTINATION="${HOME}/Library/Application Support/Adobe/CEP/extensions/com.fnnas.seekbridge.mvp"

if [[ ! -L "${DESTINATION}" ]]; then
  print "未找到 Rove 的开发版软链接，无需卸载。"
  exit 0
fi

CURRENT_TARGET="$(readlink "${DESTINATION}")"
if [[ "${CURRENT_TARGET}" != "${SOURCE_DIR}" ]]; then
  print "安装位置指向其他内容，未做删除：${DESTINATION}"
  exit 1
fi

trash "${DESTINATION}"
print "Rove 已移到废纸篓。重新打开 Adobe 软件后生效。"
print "本机缩略图缓存和项目源代码均已保留。"
