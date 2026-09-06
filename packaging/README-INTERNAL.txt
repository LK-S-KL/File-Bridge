LK‘s File Bridge {{VERSION}} · 稳定性修复内测

这是给同事体验的 macOS Adobe CEP 内测包，支持：
- Adobe Premiere Pro 25.0+
- Adobe After Effects 25.0+
- macOS Apple Silicon / Intel（需系统能读取已挂载的 SMB 素材位置）

安装
1. 先安装与你的 Mac 匹配的 FFmpeg（包含 ffmpeg 和 ffprobe）。Homebrew 用户运行 brew install ffmpeg；也可以将两个可执行文件放在 ~/.local/bin。安装器会分别验证运行状态，缺少任意一个时会停止安装，旧版本保持原样。
2. 双击“安装 LK‘s File Bridge.command”。
3. 如果 macOS 阻止脚本运行：右键脚本，选择“打开”，再确认打开。
4. 完整退出并重新打开 Premiere Pro 或 After Effects。
5. 选择“窗口 > 扩展 > LK‘s File Bridge”。
6. 在面板中添加已经挂载的共享文件夹或本地文件夹。

说明
- 这是未签名 CEP 内测包，安装脚本会为 CSXS 12 开启 PlayerDebugMode；这是 CEP 内测所需设置。
- 本版包含安装升级、任务取消、本地状态恢复和素材列表的稳定性修复。完整修复记录见随包测试报告。
- LUT 可在面板内预览比较。当前 CEP 宿主没有可验证的 Lumetri 原子写入和回滚能力，因此自动套用入口暂不可用，可在 Premiere Lumetri 中手动选择 LUT。
- 拖拽不会预先导入素材；拖入时暂不自动同步插件标签。需要同步标签时请使用右键“导入项目”或“插入到”。
- 预览、搜索、元数据、收藏、标签和 LUT 预览不会自动导入 Adobe 工程。
- 只有拖放、右键导入/放置或“截图入项目”才会改变工程。
- 关闭面板或退出 Adobe 前，请等待正在进行的转码提示结束。
- 如果同事电脑已经安装旧版，安装脚本会把同一扩展 ID 的旧版本和遗留备份移出 Adobe 扫描目录，保存至 ~/Library/Application Support/LK File Bridge/Extension Backups。升级失败会恢复旧扩展。

卸载
双击“卸载 LK‘s File Bridge.command”。它会将同一扩展 ID 的所有安装目录移入上述可恢复备份目录，不会删除源素材、Adobe 工程或本机收藏状态。

反馈
请记录：Adobe 软件及版本、macOS 版本、素材格式、是否为 SMB 路径、复现步骤和面板提示文字。不要把账号密码、共享盘凭据或源素材发到群里。
