LK‘s File Bridge 0.6.1 · 第五版修复内测

这是给同事体验的 macOS Adobe CEP 内测包，支持：
- Adobe Premiere Pro 25.0+
- Adobe After Effects 25.0+
- macOS Apple Silicon / Intel（需系统能读取已挂载的 SMB 素材位置）

安装
1. 双击“安装 LK‘s File Bridge.command”。
2. 如果 macOS 阻止脚本运行：右键脚本，选择“打开”，再确认打开。
3. 完整退出并重新打开 Premiere Pro 或 After Effects。
4. 选择“窗口 > 扩展 > LK‘s File Bridge”。
5. 在面板中添加已经挂载的共享文件夹或本地文件夹。

说明
- 这是未签名 CEP 内测包，安装脚本会为 CSXS 12 开启 PlayerDebugMode；这是 CEP 内测所需设置。
- 第五版重点新增：信息卡/纯净卡、结果操作菜单、悬浮子菜单、鼠标 I/O、中文路径转码、截图直入项目根目录和扁平项目素材打包；本修复版重点修复卡片缩略图行高和工具栏对齐。
- 预览、搜索、元数据、收藏、标签和 LUT 预览不会自动导入 Adobe 工程。
- 只有拖放、右键导入/放置或“截图入项目”才会改变工程。
- 关闭面板或退出 Adobe 前，请等待正在进行的转码提示结束。
- 如果同事电脑已经安装旧版，安装脚本会先把旧扩展目录改名为带时间戳的备份，不会直接删除。

卸载
双击“卸载 LK‘s File Bridge.command”。它会把扩展目录移到废纸篓，不会删除源素材、Adobe 工程或本机收藏状态。

反馈
请记录：Adobe 软件及版本、macOS 版本、素材格式、是否为 SMB 路径、复现步骤和面板提示文字。不要把账号密码、共享盘凭据或源素材发到群里。
