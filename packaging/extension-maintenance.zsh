#!/bin/zsh
# Shared by internal packages and the development symlink installer.
set -euo pipefail

lkfb_bundle_id="com.fnnas.seekbridge.mvp"
lkfb_install_home="${LKFB_INSTALL_HOME:-${HOME}}"
lkfb_extensions="${lkfb_install_home}/Library/Application Support/Adobe/CEP/extensions"
lkfb_support="${lkfb_install_home}/Library/Application Support/LK File Bridge"
lkfb_backup_base="${lkfb_support}/Extension Backups"
lkfb_destination="${lkfb_extensions}/${lkfb_bundle_id}"
lkfb_lock="${lkfb_support}/.extension-operation-lock"
lkfb_operation_dir=""
lkfb_published=0
lkfb_success=0
lkfb_lock_owned=0
typeset -a lkfb_originals=() lkfb_backups=()

lkfb_manifest_id() {
  [[ -f "$1/CSXS/manifest.xml" ]] || return 0
  /usr/bin/xmllint --xpath 'string(/ExtensionManifest/@ExtensionBundleId)' "$1/CSXS/manifest.xml" 2>/dev/null || true
}

lkfb_finish() {
  local saved_status=$?
  local index
  if [[ "${lkfb_success}" != 1 && -n "${lkfb_operation_dir}" ]]; then
    if [[ "${lkfb_published}" == 1 && ( -e "${lkfb_destination}" || -L "${lkfb_destination}" ) ]]; then
      mv "${lkfb_destination}" "${lkfb_operation_dir}/failed-install" || true
    fi
    for (( index=${#lkfb_originals}; index>=1; index-- )); do
      if [[ ! -e "${lkfb_originals[index]}" && ! -L "${lkfb_originals[index]}" ]]; then
        mv "${lkfb_backups[index]}" "${lkfb_originals[index]}" || print -u2 "恢复失败，请保留备份：${lkfb_backups[index]}"
      fi
    done
    print -u2 "操作未完成；旧扩展已尽可能恢复。恢复资料：${lkfb_operation_dir}"
  fi
  if [[ "${lkfb_lock_owned}" == 1 ]]; then rmdir "${lkfb_lock}" 2>/dev/null || true; fi
  return "${saved_status}"
}

lkfb_acquire_lock() {
  mkdir -p "${lkfb_support}" "${lkfb_backup_base}" || return $?
  if ! mkdir "${lkfb_lock}" 2>/dev/null; then
    print -u2 "已有安装或卸载操作正在运行。若上次意外中断，请先确认没有安装进程，再移除空锁目录：${lkfb_lock}"
    return 1
  fi
  lkfb_lock_owned=1
  lkfb_operation_dir="$(mktemp -d "${lkfb_backup_base}/$(date +%Y%m%d-%H%M%S).XXXXXX")" || return $?
}

lkfb_check_media_tools() {
  local source_dir="$1"
  local resolver="${source_dir}/js/resolve-media-tools.pl"
  local result
  local -a arguments
  [[ -f "${resolver}" ]] || { print -u2 "安装包不完整：缺少媒体组件检查器，请重新下载完整 macOS 安装包。"; return 1; }
  arguments=("${resolver}" --root "${source_dir}" --home "${lkfb_install_home}")
  if [[ -n "${LKFB_MEDIA_BIN_DIR:-}" ]]; then
    arguments+=(--system-dir "${LKFB_MEDIA_BIN_DIR}")
  fi
  print "正在检查系统与内置 FFmpeg / FFprobe（首次可能需要几秒）…"
  if ! result="$(/usr/bin/perl "${arguments[@]}")"; then
    print -u2 "安装已停止：系统及内置 ffmpeg / ffprobe 都未通过验证，未覆盖旧插件。"
    print -u2 "请先重新下载完整 macOS 包；查看包内安装说明的媒体组件修复部分。"
    print -u2 -r -- "${result}"
    if [[ -t 1 && -z "${LKFB_INSTALL_HOME:-}" && -f "${source_dir}/help/MAC-INSTALL.txt" ]]; then
      /usr/bin/open -a TextEdit "${source_dir}/help/MAC-INSTALL.txt" || true
    fi
    return 1
  fi
  print -r -- "${result}" | /usr/bin/perl -MJSON::PP -e '
    local $/; my $r = decode_json(<STDIN>);
    exit 1 unless $r->{ok} && $r->{source} =~ /^(system|bundled)$/ && $r->{ffmpeg} && $r->{ffprobe};
    print "$r->{source}: FFmpeg $r->{version} ($r->{architecture})\n";
    print "ffmpeg: $r->{ffmpeg}\nffprobe: $r->{ffprobe}\n";
  ' || return $?
  if [[ "${result}" == *'"source":"system"'* ]]; then
    print "复用系统媒体组件，不安装或覆盖系统 FFmpeg。"
  else
    print "使用内置媒体组件，无需安装 Homebrew 或联网下载。"
  fi
}

lkfb_archive_matching_extensions() {
  local candidate target index=0
  for candidate in "${lkfb_extensions}"/*(DN); do
    [[ "$(lkfb_manifest_id "${candidate}")" == "${lkfb_bundle_id}" ]] || continue
    index=$((index + 1))
    target="${lkfb_operation_dir}/${index}-${candidate:t}"
    mv "${candidate}" "${target}" || return $?
    lkfb_originals+=("${candidate}")
    lkfb_backups+=("${target}")
  done
}

lkfb_install() {
  local source_dir="$1"
  local mode="${2:-copy}"
  local stage
  if [[ "$(/usr/bin/uname -s)" != Darwin ]]; then
    print -u2 "此安装器仅支持 macOS，不能用于 Windows。"
    return 1
  fi
  if [[ "$(lkfb_manifest_id "${source_dir}")" != "${lkfb_bundle_id}" ]]; then
    print -u2 "找不到有效的安装源：${source_dir}"
    return 1
  fi
  lkfb_acquire_lock || return $?
  mkdir -p "${lkfb_extensions}" || return $?
  if [[ ( -e "${lkfb_destination}" || -L "${lkfb_destination}" ) && "$(lkfb_manifest_id "${lkfb_destination}")" != "${lkfb_bundle_id}" ]]; then
    print -u2 "安装位置被其他内容占用，未做覆盖：${lkfb_destination}"
    return 1
  fi
  stage="${lkfb_operation_dir}/new-extension"
  if [[ "${mode}" == symlink ]]; then
    ln -s "${source_dir}" "${stage}" || return $?
  else
    ditto --norsrc --noextattr --noqtn "${source_dir}" "${stage}" || return $?
  fi
  [[ "$(lkfb_manifest_id "${stage}")" == "${lkfb_bundle_id}" ]] || return 1
  # Validate only the new copied payload; do not execute quarantined download files.
  lkfb_check_media_tools "${stage}" || return $?
  if [[ "${LKFB_SKIP_DEFAULTS:-0}" != "1" ]]; then
    defaults write com.adobe.CSXS.12 PlayerDebugMode -string "1" || return $?
  fi
  lkfb_archive_matching_extensions || return $?
  mv "${stage}" "${lkfb_destination}" || return $?
  lkfb_published=1
  [[ "$(lkfb_manifest_id "${lkfb_destination}")" == "${lkfb_bundle_id}" ]] || return 1
  lkfb_success=1
  print "LK‘s File Bridge 已安装。旧扩展保存在 Adobe 扫描目录之外：${lkfb_operation_dir}"
  print "请完整退出并重新打开 Premiere Pro 或 After Effects，然后选择：窗口 > 扩展 > LK‘s File Bridge"
}

lkfb_uninstall() {
  lkfb_acquire_lock || return $?
  lkfb_archive_matching_extensions || return $?
  lkfb_success=1
  print "LK‘s File Bridge 已卸载，包括使用同一扩展 ID 的历史备份。重新打开 Adobe 软件后生效。"
  print "扩展可从此目录恢复：${lkfb_operation_dir}"
  print "源素材、Adobe 工程、本机收藏和缓存均保留。"
}
