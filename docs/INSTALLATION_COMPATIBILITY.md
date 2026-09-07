# 0.6.7 安装兼容性核查

日期：2026-09-07。程序基线：`v0.6.7-internal`，提交 `1579374307a0c6113a9df6f4624e52d2c93be7c1`。

## 结论

| 系统 | 当前交付能力 | 是否拆包 |
|---|---|---|
| macOS Apple Silicon | 安装器支持；依赖 ffmpeg 与 ffprobe，未签名、未公证，不是零依赖一键安装 | ZIP / DMG 内容相同，任选一种 |
| macOS Intel | 脚本共用；需匹配架构的媒体二进制，尚无 Intel 实机验收 | 当前不单独拆插件包；以后内置媒体二进制时须按架构分发或提供 universal 二进制 |
| Windows 10 / 11 | 不支持安装或正常使用；缺少系统适配，不能靠添加 .bat/.ps1 安装器解决 | 必须独立适配、实测后再发布 Windows 包 |

manifest 的 PPRO/AEFT 范围 `[25.0,99.9]` 是允许加载的声明，不是已经验证的兼容矩阵。
本版使用 CSXS 12，目标为 Adobe 25.x；24.x 及以前不适用，后续版本尚需实测。
Homebrew 当前推荐 macOS 14+、Apple Silicon；Intel 为 Tier 3。这是依赖工具的支持范围，
不是本插件在所有该系统上的验收结果。不能写成“Mac / Win 均可直接安装”。

## Windows 阻断证据

- `extension/js/library.js` 的隔离扫描固定启动 `/usr/bin/perl`；主界面启用该路径，无 Windows 工作进程回退。
- `extension/js/media-tools.js` 的二进制查找仅包含 Homebrew 和 `~/.local/bin`，不识别 `.exe`；旧 Node 的空间检查回退调用 `/bin/df`。
- `extension/js/main.js` 将文件 URL 的 pathname 直接用于路径拼接，Windows 盘符会出现额外前导分隔符；打开或定位素材调用 `/usr/bin/open`。
- `extension/js/asset-ops.js` 和 `file-ops.js` 的废纸篓使用 `/usr/bin/osascript` 和 macOS Foundation；跨盘移动也依赖此路径。
- AI/EPS 预览回退依赖 `qlmanage`；缓存和本地状态目录沿用 Mac 的 `Library` 结构。
- `packaging/extension-maintenance.zsh` 写入 Mac 的 CEP 路径及 `defaults`，ZIP 只含 `.command/.zsh`，DMG 是同一套文件。

Windows 后续需要：路径与 UNC、可取消扫描进程、媒体依赖发现、磁盘空间、可恢复回收站、
Explorer 定位、状态/缓存目录、注册表与 CEP 安装/升级/卸载适配，以及 Windows Adobe 实机测试。
本次只核查与修订交付说明，未把 Windows 移植列为已完成。

## 安装说明 r2 交付约束

- 用已发布 0.6.7 ZIP 为输入，仅替换安装说明并附入本报告，保留所有插件文件与脚本字节。
- 安装器、插件版本和标签不变；`install-r2` 表示文档交付修订，不是 0.6.8，也不包含后续工具栏修改。
- ZIP / DMG 输出使用新文件名，原始桌面包保留；上传前验证两种包和新 SHA-256 清单。
- Release 明确区分操作系统、压缩格式、Adobe 范围、外部依赖及未签名状态，说明书同时作为独立附件。
- 新手说明覆盖识别系统、下载正确附件、Homebrew/FFmpeg、系统安全提示、安装成功标志、首次测试、升级、卸载与排错。

## 验证边界

源码审计在 macOS 26.5.1 / arm64 上执行。原 0.6.7 构建已有 138 项测试及临时用户安装验收，
见同目录 `V0.6.7_RELEASE_TEST_REPORT.md` 和 `V0.6.7_PACKAGE_VERIFICATION.md`。
本次文档修订包的实际验证记录由打包工具输出 `verification.json`，核对完整插件与脚本未变、
ZIP 解压与 DMG 只读挂载内容一致，并在临时用户目录进行安装和卸载。未运行的检查不得记作通过。
未操作用户日常 Adobe 工程，也没有 Windows、第二台 Intel Mac 或新手真人安装试用结果。

## 官方资料

- [Homebrew 安装与系统要求](https://docs.brew.sh/Installation)
- [Apple 未签名软件提示](https://support.apple.com/zh-cn/102445)
- [Adobe CEP 12 Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md)
