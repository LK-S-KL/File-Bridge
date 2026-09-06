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

lkfb_binary_runs() {
  local executable="$1"
  [[ -x "${executable}" && ! -d "${executable}" ]] || return 1
  /usr/bin/perl -e '
    my $pid = fork(); defined($pid) or exit 125;
    if ($pid == 0) { exec @ARGV; exit 126; }
    $SIG{ALRM} = sub { kill "KILL", $pid; waitpid($pid, 0); exit 124; };
    alarm 8; waitpid($pid, 0); my $result = $?; alarm 0;
    exit(($result & 127) ? 128 + ($result & 127) : $result >> 8);
  ' "${executable}" -version >/dev/null 2>&1
}

lkfb_check_media_tools() {
  local tool candidate found
  local -a directories
  if [[ -n "${LKFB_MEDIA_BIN_DIR:-}" ]]; then
    directories=("${LKFB_MEDIA_BIN_DIR}")
  else
    directories=("${lkfb_install_home}/.local/bin" /opt/homebrew/bin /usr/local/bin)
  fi
  for tool in ffmpeg ffprobe; do
    found=0
    for candidate in "${directories[@]}"; do
      if lkfb_binary_runs "${candidate}/${tool}"; then
        print "依赖检查通过：${candidate}/${tool}"
        found=1
        break
      fi
    done
    if [[ "${found}" != 1 ]]; then
      print -u2 "安装已停止：找不到可运行的 ${tool}。请先通过 Homebrew 安装 FFmpeg（brew install ffmpeg），或将 ffmpeg 和 ffprobe 放入 ${lkfb_install_home}/.local/bin。请使用与你的 Mac 处理器匹配的版本。"
      return 1
    fi
  done
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
  if [[ "$(lkfb_manifest_id "${source_dir}")" != "${lkfb_bundle_id}" ]]; then
    print -u2 "找不到有效的安装源：${source_dir}"
    return 1
  fi
  lkfb_check_media_tools || return $?
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
    ditto --noqtn "${source_dir}" "${stage}" || return $?
  fi
  [[ "$(lkfb_manifest_id "${stage}")" == "${lkfb_bundle_id}" ]] || return 1
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
