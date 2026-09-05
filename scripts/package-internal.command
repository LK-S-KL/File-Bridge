#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
DESKTOP="${HOME}/Desktop"
VERSION="$(node -p 'require(process.argv[1]).version' "${PROJECT_ROOT}/package.json")"
PRODUCT="LK‘s File Bridge"
PACKAGE_NAME="${PRODUCT} ${VERSION} 内测版"
STAGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lk-file-bridge-package.XXXXXX")"
STAGE="${STAGE_ROOT}/${PACKAGE_NAME}"
ZIP_PATH="${DESKTOP}/${PACKAGE_NAME}.zip"
DMG_PATH="${DESKTOP}/${PACKAGE_NAME}.dmg"

cleanup() { rm -rf "${STAGE_ROOT}"; }
trap cleanup EXIT

print "正在运行内测包前检查…"
(cd "${PROJECT_ROOT}" && npm test)

rm -f "${ZIP_PATH}" "${DMG_PATH}"
mkdir -p "${STAGE}/extension"

ditto --norsrc --noextattr --noqtn --noacl "${PROJECT_ROOT}/extension" "${STAGE}/extension"
find "${STAGE}" -name .DS_Store -type f -delete
cp "${PROJECT_ROOT}/packaging/install-internal.command" "${STAGE}/安装 ${PRODUCT}.command"
cp "${PROJECT_ROOT}/packaging/uninstall-internal.command" "${STAGE}/卸载 ${PRODUCT}.command"
cp "${PROJECT_ROOT}/packaging/README-INTERNAL.txt" "${STAGE}/README-内测安装说明.txt"
chmod +x "${STAGE}/安装 ${PRODUCT}.command" "${STAGE}/卸载 ${PRODUCT}.command"
printf '%s\n' "${PRODUCT} ${VERSION} · 内测版" > "${STAGE}/版本.txt"

(
  cd "${STAGE_ROOT}"
  COPYFILE_DISABLE=1 zip -r -X "${ZIP_PATH}" "${PACKAGE_NAME}" -x '*/.DS_Store' >/dev/null
)
hdiutil create -volname "${PACKAGE_NAME}" -srcfolder "${STAGE}" -ov -format UDZO "${DMG_PATH}" >/dev/null

print "已生成："
print "  ${ZIP_PATH}"
print "  ${DMG_PATH}"
