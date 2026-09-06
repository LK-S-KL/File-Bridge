#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
DESKTOP="${HOME}/Desktop"
VERSION="$(node -p 'require(process.argv[1]).version' "${PROJECT_ROOT}/package.json")"
PRODUCT="LK‘s File Bridge"
PACKAGE_NAME="${PRODUCT} ${VERSION} 稳定性内测"
STAGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lk-file-bridge-package.XXXXXX")"
STAGE="${STAGE_ROOT}/${PACKAGE_NAME}"
ZIP_PATH="${DESKTOP}/${PACKAGE_NAME}.zip"
DMG_PATH="${DESKTOP}/${PACKAGE_NAME}.dmg"
STAGED_ZIP="${STAGE_ROOT}/${PACKAGE_NAME}.zip"
STAGED_DMG="${STAGE_ROOT}/${PACKAGE_NAME}.dmg"

cleanup() { rm -rf "${STAGE_ROOT}"; }
trap cleanup EXIT

if [[ -e "${ZIP_PATH}" || -e "${DMG_PATH}" ]]; then
  print -u2 "同版本安装包已存在，未覆盖：${ZIP_PATH} / ${DMG_PATH}"
  exit 1
fi

print "正在运行内测包前检查…"
(cd "${PROJECT_ROOT}" && npm test)

mkdir -p "${STAGE}/extension"

ditto --norsrc --noextattr --noqtn --noacl "${PROJECT_ROOT}/extension" "${STAGE}/extension"
find "${STAGE}" -name .DS_Store -type f -delete
cp "${PROJECT_ROOT}/packaging/install-internal.command" "${STAGE}/安装 ${PRODUCT}.command"
cp "${PROJECT_ROOT}/packaging/uninstall-internal.command" "${STAGE}/卸载 ${PRODUCT}.command"
cp "${PROJECT_ROOT}/packaging/extension-maintenance.zsh" "${STAGE}/extension-maintenance.zsh"
node -e 'const fs=require("fs"); const input=fs.readFileSync(process.argv[1],"utf8"); fs.writeFileSync(process.argv[2],input.replace(/\{\{VERSION\}\}/g,process.argv[3]));' "${PROJECT_ROOT}/packaging/README-INTERNAL.txt" "${STAGE}/README-内测安装说明.txt" "${VERSION}"
cp "${PROJECT_ROOT}/docs/V0.6.6_STABILITY_TEST_REPORT.md" "${STAGE}/稳定性测试报告.md"
cp "${PROJECT_ROOT}/docs/V0.6.7_RELEASE_TEST_REPORT.md" "${STAGE}/V0.6.7_RELEASE_TEST_REPORT.md"
chmod +x "${STAGE}/安装 ${PRODUCT}.command" "${STAGE}/卸载 ${PRODUCT}.command"
printf '%s\n' "${PRODUCT} ${VERSION} · 内测版" > "${STAGE}/版本.txt"

(
  cd "${STAGE_ROOT}"
  COPYFILE_DISABLE=1 zip -r -X "${STAGED_ZIP}" "${PACKAGE_NAME}" -x '*/.DS_Store' >/dev/null
)
hdiutil create -volname "${PACKAGE_NAME}" -srcfolder "${STAGE}" -format UDZO "${STAGED_DMG}" >/dev/null
/usr/bin/unzip -tq "${STAGED_ZIP}" >/dev/null
hdiutil verify "${STAGED_DMG}" >/dev/null
# Publish verified archives exclusively; an existing delivery is never overwritten.
node -e 'const fs=require("fs"); for(let i=1;i<process.argv.length;i+=2) fs.copyFileSync(process.argv[i],process.argv[i+1],fs.constants.COPYFILE_EXCL);' "${STAGED_ZIP}" "${ZIP_PATH}" "${STAGED_DMG}" "${DMG_PATH}"

print "已生成："
print "  ${ZIP_PATH}"
print "  ${DMG_PATH}"
