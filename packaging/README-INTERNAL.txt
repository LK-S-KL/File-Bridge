LK‘s File Bridge {{VERSION}} 安装说明书
文档修订：r2，2026-09-07

先看结论
本安装包仅用于 macOS，不是 Windows 安装包。ZIP 和 DMG 只是同一个 Mac
安装包的两种下载形式，任选一种，不要安装两次。
这是 Adobe 软件里的扩展面板，不是独立 App，不需要拖到“应用程序”。
当前未签名、未公证，且不内置 FFmpeg；首次安装需要联网准备依赖。
已有旧版且能正常使用的同事：仍须先保存工程并退出 Adobe，再执行安装。

一、我的电脑能不能安装？

1. Mac：可以按本文安装，但须满足以下条件：
   - Premiere Pro 或 After Effects 已安装且能正常启动。
   - 插件目标为 Adobe 2025 / 25.x、CEP 12。24.x 及更早版本不适用。
   - manifest 虽允许 25.0 及以上加载，不等于每一个新版 Adobe 都实测兼容。
     26.x 等未验证版本、Intel Mac 请先用独立测试工程体验，勿直接用于交付。
   - 已安装可运行的 ffmpeg 和 ffprobe，两者缺一不可。
   - 公司管理的电脑如禁止脚本或安装工具，请先联系 IT，不要绕过管理策略。
2. Windows：本版不支持。不要在 Windows 上运行 .command、DMG，也不要通过
   WSL 安装来替代 Windows 插件适配。Windows 扫描、回收站、路径和媒体工具
   还需要单独适配与实机测试，目前没有可交付的 Windows 安装包。
3. Mac 的 M 系列与 Intel：插件文件共用同一包，不需要选两个安装包；FFmpeg
   必须匹配你的处理器。点击屏幕左上角苹果菜单 > 关于本机，记录“芯片”
   （Apple M 系列）或“处理器”（Intel），以及 macOS 版本。
4. 本次包内安装器在 macOS 26.5.1 / Apple Silicon 的临时用户目录中验证。
   不代表所有 macOS、Intel 或所有 Adobe 组合均通过。Homebrew 当前官方常规
   安装要求为 macOS 14+，Intel 为 Tier 3；老系统或 Intel 依赖安装失败时请
   由 IT 提供匹配的 FFmpeg，不要把 Homebrew 的系统要求当成插件实测矩阵。

二、下载哪一个文件？

官方版本页：
https://github.com/LK-S-KL/File-Bridge/releases/tag/v0.6.7-internal

在 Assets（附件）中展开完整列表：
- 推荐：名称包含 macOS-install-r2、结尾为 .zip 的文件。
- 也可选：名称包含 macOS-install-r2、结尾为 .dmg 的文件。
- SHA256SUMS 是用于检查下载完整性的清单，不是安装程序。
- 不要下载 GitHub 自动生成的 Source code (zip) / Source code (tar.gz)，
  它们是给开发者用的源代码，不是这里的安装包。

ZIP：双击解压，再打开解压出来的文件夹。必须先解压整个包，不要只取出安装脚本。
DMG：双击挂载，打开 Finder 中出现的磁盘窗口。安装时磁盘保持打开即可。
两种方式的窗口内都应有：
  README-内测安装说明.txt（本说明）
  安装 LK‘s File Bridge.command
  卸载 LK‘s File Bridge.command
  extension 文件夹
  extension-maintenance.zsh
  测试报告与版本.txt
不要移动、删除或改名其中的 extension 文件夹及 .zsh 文件。

可选：检查下载是否完整。下载同一版的 SHA256SUMS 清单，用“文本编辑”打开。
在终端输入 shasum -a 256，接着输入一个空格，把下载的 ZIP 或 DMG 拖入终端，
再按回车。对比输出的长串字符与清单中同一文件名那一行，必须完全一致。
不一致时不要运行安装器，请重新下载；只校验自己下载的那一种包即可。

三、首次准备环境（只需做一次）

FFmpeg 用于生成缩略图、读取时长、播放兼容代理和截图。缺少它会影响基本预览，
因此安装器会先检查 ffmpeg 与 ffprobe；失败时停止，不会覆盖旧插件。
使用本插件不需要安装 Node.js、npm、Git，也不需要购买第三方扩展管理器。

如果已经有 FFmpeg，可直接跳到第四部分，安装器会检查能否实际运行。

没有 FFmpeg：
1. 按 Command + 空格，输入“终端”，回车打开 macOS 自带的终端程序。
2. 在终端输入 brew --version，然后按回车。
   出现 Homebrew 版本号：继续第 4 步。
   出现 command not found（找不到命令）：继续第 3 步。
3. 用浏览器打开 https://brew.sh/zh-cn/ ，按照官方“安装 Homebrew”步骤操作。
   只使用官方来源；先阅读安装器说明再确认。首次安装可能要求安装 Apple
   Command Line Tools，按系统提示安装并等待结束。输入 Mac 登录密码时终端
   不会显示圆点或文字，这是正常的；输入后按回车。不要把密码发给其他人。
   安装完后按终端显示的 Next steps 完成配置，再关闭并重新打开终端。
   再运行 brew --version，看到版本号后继续。网络连接或权限报错时不要反复
   粘贴随机修复命令，应把不含隐私的错误信息交给 IT。
4. 输入以下命令，按回车，等待回到可输入命令的提示行：

   brew install ffmpeg

   命令会联网下载 Homebrew 的 FFmpeg 及依赖，不是下载本插件。不要加 sudo。
5. 分别执行下面两条命令，每条后按回车：

   ffmpeg -version
   ffprobe -version

   两条都显示版本信息才算依赖准备完成。
   如出现 Bad CPU type、权限错误或缺少库文件，说明这套依赖不能正常运行，
   请先修复依赖，不要继续安装或自行关闭系统安全功能。

给 IT 的补充：安装器检查 ~/.local/bin、/opt/homebrew/bin、/usr/local/bin。
如使用独立发行的二进制，须同时提供可信、可执行且匹配架构的 ffmpeg 和
ffprobe，放入当前用户的 ~/.local/bin。不得只提供源码或 Windows .exe。
只在其他 PATH 目录可运行，不代表本版插件可以发现它们。

四、安装插件

1. 保存正在编辑的工程。对 Premiere Pro 和 After Effects 分别按 Command + Q
   完整退出；关闭工程窗口或面板不等于退出软件。
2. 在第二部分打开的安装包中，双击“安装 LK‘s File Bridge.command”。
3. 正常会打开终端窗口并显示检查进度，不会出现“下一步”式的应用安装向导。
4. 如果系统提示“无法验证开发者”或“Apple 无法检查”：
   先确认文件确实来自上面的官方版本页；尝试打开后，进入“系统设置 > 隐私
   与安全性”，找到这次被拦截的文件，按“仍要打开”，再确认“打开”。部分
   macOS 版本也可右键文件 > 打开。没有相关选项的受管理电脑，请联系 IT。
   不要执行关闭 Gatekeeper、关闭 SIP 或对整个下载目录批量清除隔离标记的命令。
   若提示“将损坏电脑”或“文件已损坏”，请停止，重新下载校验或联系维护者，
   不要按上述方式强行放行恶意软件警告。
5. 安装完成必须看到：
   “依赖检查通过”分别出现 ffmpeg 和 ffprobe；
   “LK‘s File Bridge 已安装”；
   随后提示重新打开 Adobe 软件。
   若出现“安装已停止”或“操作未完成”，表示没有成功。请保留终端错误信息。
6. 看到成功提示后关闭终端窗口。DMG 用户可以在 Finder 侧栏推出安装磁盘。
   插件已复制到本机用户目录，不依赖安装包继续挂载。

安装器只为当前 Mac 用户安装。它会开启 com.adobe.CSXS.12 的 PlayerDebugMode，
允许 CEP 12 加载未签名扩展。这不是 Apple 公证，也不代表插件经过 Adobe 审核。
该设置会影响同一用户的其他 CEP 12 扩展，请只安装可信扩展。

五、打开插件并确认安装成功

1. 启动 Premiere Pro，先建立一个空白测试工程（或打开你准备好的测试工程）。
2. 点击顶部菜单“窗口 > 扩展 > LK‘s File Bridge”。英文界面为
   Window > Extensions > LK‘s File Bridge；不同 Adobe 版本菜单文字可能略有差异。
   After Effects 中同样从“窗口 > 扩展”打开。
3. 在插件工具栏右侧点击文件夹图标，添加一个本机素材文件夹，并勾选该位置。
   没勾选任何位置时没有素材，这是正常逻辑。
4. 先放一小段已知可播放的本地 MP4 和一张 JPG 进行测试，等待缩略图生成。
5. 点选视频，确认卡片里有画面和声音；双击打开大预览，试一下播放/暂停。
6. 在空白测试工程里右键素材，执行“导入项目”，确认出现在 Adobe 项目面板。
7. 如要使用共享盘：先在 Finder 中连接并打开共享文件夹，再在插件中添加位置。
   首次生成缩略图可能较慢，等待缓存完成。离线共享盘需重新连接后刷新。
8. 检查“版本与运行信息”中前端与宿主版本均为 {{VERSION}}。
   安装说明 r2 只更新交付文档，不改变 {{VERSION}} 插件功能或版本号。

六、常见问题

Q：下载的 ZIP 能在 Windows 解压，为什么不能安装？
A：ZIP 是通用压缩格式，不代表里面的程序跨平台。本版内部是 macOS 脚本，
   Windows 不受支持。请等待经过 Windows 实机验证的专用包。

Q：提示找不到 ffmpeg 或 ffprobe？
A：先完成第三部分，确认两条 -version 命令都成功。只有 ffmpeg 没有 ffprobe
   也会停止安装。自定义安装目录请让 IT 核对上面列出的实际查找位置。

Q：找不到有效安装源、找不到 extension-maintenance.zsh？
A：常见原因是只复制了 .command 文件。重新解压整个 ZIP，再从完整文件夹运行。

Q：双击打开的是文本编辑器，而不是执行安装？
A：在 Finder 中右键 .command 文件 > 打开方式 > 终端。仍然失败请截图报错。

Q：安装显示成功，但 Adobe 菜单里没有插件？
A：先确认当前登录的是安装时同一个 Mac 用户，Adobe 为 25.x、支持 CEP 12，
   然后 Command + Q 完全退出两款 Adobe 软件再重开。不要再手动复制一份扩展。
   24.x 无法使用本版；更新或未验证的 Adobe 版本请提供版本号给维护者。

Q：显示的还是旧界面或版本？
A：先彻底重启 Adobe，再核对“版本与运行信息”的版本和实际路径。升级器只管理
   当前用户的 CEP 目录；如果 IT 在系统级目录另装了一份，请由 IT 排查，勿盲删。

Q：没有素材、缩略图一直不出现？
A：检查位置是否勾选、搜索是否清空、分类是否选为“全部”；先用小体积本地文件
   测试。检查 Adobe 对该文件夹的访问权限，只授予实际需要的目录权限；共享盘
   要先在 Finder 重新连接。不要为排错直接删除素材、收藏数据或整个缓存目录。

Q：公司电脑不能安装 Homebrew、网络下载失败或没有“仍要打开”？
A：联系 IT。本版不提供绕过企业策略的办法；网络失败与插件安装失败是两件事。

Q：看到“已有安装或卸载操作正在运行”？
A：等其他安装/卸载终端结束。若上次异常断电，保留错误文字并联系维护者，
   不要在不确定是否仍有进程运行时删除锁目录。

七、升级、卸载与恢复

升级：保存工程并退出 Adobe，运行新包中的安装脚本，无须先卸载旧版。
同一扩展 ID 的旧版本会被移出当前用户的 CEP 扫描目录；安装失败会尝试恢复。

卸载：保存工程并退出 Adobe，运行“卸载 LK‘s File Bridge.command”，确认出现
“已卸载”。它会把扩展移入可恢复的备份目录，不会删除源素材、Adobe 工程、
本机收藏或缓存。卸载不会自动关闭 PlayerDebugMode，避免影响其他内测扩展。

备份位置（Finder > 前往 > 前往文件夹，输入下一行）：
~/Library/Application Support/LK File Bridge/Extension Backups

当前用户安装位置（仅供排错查看，不需要手工复制文件）：
~/Library/Application Support/Adobe/CEP/extensions/com.fnnas.seekbridge.mvp

恢复旧版：优先保留备份，让维护者核对扩展 ID 后处理，避免恢复出多份同 ID 插件。
如明确不再使用任何未签名 CEP 12 扩展，可请 IT 将 PlayerDebugMode 设为 0。

八、当前功能边界

- LUT 预览可用，但自动套用 Lumetri 的入口暂不可用；请在 Adobe 中手动选择 LUT。
- 拖入时间线后暂不自动同步标签；右键“导入项目”或“插入到”可携带标签。
- 不同编码、Intel、各 Adobe 版本与真实 SMB 断连仍需继续内测，不承诺零故障。
- 视频转码、截图等会产生本地文件；请确认目标位置可写并有足够空间。

反馈时请提供：Mac 芯片、macOS 版本、Adobe 完整版本、插件版本、具体步骤、
本地还是共享盘、素材格式、终端/面板报错截图。不要发送密码、共享盘凭据、
客户工程或敏感源素材；截图里的私人路径也应遮盖。

参考官方说明（核对日期 2026-09-07）
Homebrew：https://brew.sh/zh-cn/
Homebrew 安装要求：https://docs.brew.sh/Installation
Apple 打开未签名软件：https://support.apple.com/zh-cn/102445
