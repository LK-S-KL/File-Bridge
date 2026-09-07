# LK‘s File Bridge

LK‘s File Bridge 是面向 Adobe Premiere Pro 25.0 与 After Effects 25.0 的共享素材面板。当前版本直接读取已经挂载到 Mac 的 SMB 或本地文件夹，不调用 Seek 私有接口。

## v0.6 第五版能力

- 同时添加多个素材文件夹；勾选一组显示该位置，勾选多组合并显示，未勾选时不显示素材
- 素材位置支持全选、当前目标路径、新建文件夹，以及文件夹打开、重命名和可恢复删除
- SMB 目录异步分批扫描；单个位置离线不影响其他位置，也不会因一次全量同步读取锁死面板
- 离线根目录会显示上次成功扫描的本机索引，重新挂载 SMB 后可刷新恢复
- 搜索、连续缩放、图标排序/筛选、全选、置顶，以及列表/卡片两种浏览模式
- 文件名、大小、类型、修改日期和时长排序，支持升序/降序
- 按文件大小、格式、色彩标签、素材位置和元数据状态筛选
- 88–260 px 连续缩略图大小调节
- 视频封面和 12 帧雪碧图滑动预览
- 音频波形
- 卡片模式支持信息卡/纯净卡；列表模式自动锁定缩略图大小并缩小角标
- 缩略图左下角显示视频/音频时长或图片分辨率；右上角常驻收藏，右下角显示标签与格式；代理和置顶显示独立角标
- 双击全屏预览视频、音频或图片；视频支持逐帧、源时间码（含 29.97/59.94 丢帧）、I/O 点、I/O 循环和自动/原画/4K/1080p/720p/480p/360p 播放代理
- MOV 或浏览器不兼容的编码自动生成 H.264/AAC 兼容播放代理
- 预览画面可拖入 Premiere；按住 Alt 拖动视频时发送预先生成的纯音频副本
- 一键从原始视频生成原尺寸 PNG 并导入 Premiere 项目
- 截图命名为“源文件名_Screenshot_YYYYMMDD-HHmm”，作为普通文件直接导入 Premiere 项目根目录
- `.cube` LUT 解析、合成 Log 风景参考片、切换/分割/滑动对比和效果强度调节；Premiere 时间线选中视频后可尝试直接应用 Lumetri Input LUT
- 右键悬浮查看格式、时长、码率、编码、分辨率、帧率、色彩空间、动态范围、Alpha、像素格式、位深、音频声道等元数据
- 右键把视频转码为 1080p、720p 或 360p MP4，输出到源文件当前目录；优先使用 macOS VideoToolbox
- 转码显示实时进度并使用 Proxy 文件名；支持多选后批量收藏、标签、置顶、转码、创建副本、移动、删除、导入或插入
- 外部素材可拖入当前路径；已选素材可拖入插件文件夹
- PSD/PSB、PDF-compatible AI/EPS 使用系统可用解码器生成预览，失败时不会阻塞面板
- Premiere 右键可插入当前时间、首帧或尾帧；独立打包入口只复制所有时间线实际引用的已配置素材
- 项目打包默认扁平复制最终文件，并纳入时间线实际使用的插件截图；同名文件自动编号
- 收藏和六种色彩标签保存在本机；Premiere 与 AE 共用并跨重启保留
- Premiere：卡片可直接拖到素材箱、源监视器或时间线
- Premiere：右键打开、导入项目，或插入到当前时间、首帧、尾帧
- After Effects：右键导入项目或加入当前合成
- Finder 定位、重命名、移到废纸篓

## LUT 与 Lumetri 的边界

LK‘s File Bridge 在 Canvas 中做 8-bit sRGB 三线性插值预览，用于挑选方向；它不会伪装成最终调色结果。Premiere 25.x 的 CEP/QE 宿主会在时间线选中视频时尝试添加 Lumetri Color 并写入 Input LUT；如果当前版本没有可写的 Lumetri 属性，会明确返回不支持，而不会伪造成功状态。

## Adobe 拖拽边界

Premiere Pro 25.0 的 CEP 支持文件从扩展面板拖到宿主：

- 拖到项目面板：导入工程
- 拖到源监视器：打开源素材
- 拖到时间线：导入并放入时间线

After Effects 没有可靠的扩展面板文件拖入协议，因此 AE 中卡片不会宣称可拖，使用“导入项目”或“加入当前合成”。

## 数据与文件安全

- 浏览、搜索、缩略图、雪碧图、波形和 ffprobe 元数据不会修改源素材
- 预览代理、音频副本、缩略图、波形和普通帧缓存只写入 `~/Library/Caches/com.fnnas.fnosbridge.mvp`
- 派生缓存超过 12 GB 时会回收一天前最旧的项目，并保留当前正在生成的文件
- 用户明确点击“截图入项目”后，原尺寸 PNG 保存在 `~/Pictures/LK‘s File Bridge Captures` 并导入项目，避免清理缓存后工程离线
- 多路径、收藏、标签和视图设置写入 `~/Library/Application Support/fnOS Bridge/state.json`
- 收藏和标签目前只在这台 Mac 生效，不会同步回 Seek
- 单纯浏览、双击预览、切换播放代理、设置 I/O 点或预览 LUT 都不会创建 Adobe ProjectItem，也不会给工程增加负担
- 只有明确拖放、右键导入/放置、“截图入项目”才会改变 Adobe 工程
- 重命名和“移到废纸篓”会操作当前路径中的真实源文件，并在执行前明确警告
- 不允许通过面板更改扩展名
- 删除只调用 macOS Foundation 的安全废纸篓接口；共享盘不支持时直接失败，绝不降级成永久删除
- 已导入 Adobe 的素材被重命名或移走后，工程引用可能离线

## 打开方式

完整退出并重新打开 Adobe 软件，然后选择：

`窗口 > 扩展 > LK‘s File Bridge`

## 内测分发

0.6.8 的 **macOS** 包内置 ARM64 和 Intel 两套 FFmpeg / FFprobe，**Windows 暂不支持**。
ZIP 与 DMG 内容相同，任选一种；系统已有同目录配对且通过检测的工具时复用，否则
自动使用匹配 Mac 架构的内置工具。不覆盖系统 FFmpeg，不自动安装 Homebrew 或修改 PATH。

同事安装请先阅读 [完整安装说明](extension/help/MAC-INSTALL.txt)，再从
[Release 附件](https://github.com/LK-S-KL/File-Bridge/releases)
下载 macOS ZIP 或 DMG，不要下载自动生成的 Source code。
正常安装无需联网获取依赖：保存工程、退出 Adobe、运行包内安装脚本、重启 Adobe。

目标为 Adobe 25.x / CEP 12。内置工具最低 macOS 12，仍须满足 Adobe 自身系统要求。
ARM64 原生和 Intel Rosetta 媒体测试通过，但 Intel Mac、多 Adobe 版本仍需实机验收。
未签名 CEP、临时签名媒体工具，尚未 Apple 公证；系统提示需用户明确放行。
安装脚本为当前用户开启 CEP 12 PlayerDebugMode，旧扩展备份到 Adobe 扫描目录之外。

开发者从当前代码构建新版本：

```bash
npm run package:internal
```

首次打包前先运行 `npm run media:build:macos`，从验证过的 FFmpeg 源码和固定的
x264 提交编译两种架构；需要 Xcode Command Line Tools 和 GnuPG。生成文件在忽略的
`build/macos-media`，不得提交二进制或构建临时目录到 Git。
打包器验证二进制、源码哈希和许可证，随包附带完整对应源码、配置与构建脚本；
只有 Apple 系统库可作为运行时动态依赖。输出在桌面版本文件夹，不覆盖旧包。

本软件以独立子进程使用 FFmpeg / x264，内置构建为 **GPL-2.0-or-later**，未启用
nonfree。源码及许可证同时包含于安装包 `extension/vendor/media/{sources,legal}` 和
Release 的 `FFmpeg-Sources.zip`。参见 [FFmpeg 许可说明](https://ffmpeg.org/legal.html)。

## 开发检查

```bash
npm test
```

Premiere 与 AE 的调试端口分别为 `9360` 和 `9361`。

版本发布和日常维护分别参见 [`docs/RELEASING.md`](docs/RELEASING.md) 与 [`CONTRIBUTING.md`](CONTRIBUTING.md)。当前开发版内部 ID 暂时保留为 `com.fnnas.seekbridge.mvp`，避免破坏本机安装和数据；第一次正式发布前应确定并冻结最终 ID，发布后不要随意更换。

第五版逐条实现与验收记录见 [`docs/V5_ACCEPTANCE.md`](docs/V5_ACCEPTANCE.md)。

本轮 v0.6 迭代（82–112）验收记录见 [`docs/V6_ACCEPTANCE.md`](docs/V6_ACCEPTANCE.md)。

## 卸载开发版

运行 `scripts/uninstall.command`。它只会把 Adobe 扩展目录中的开发软链接移到废纸篓，不会删除项目源代码、源素材、本机收藏或派生媒体缓存。
