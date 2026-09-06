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

运行：

```bash
npm run package:internal
```

脚本会在桌面生成：

- `LK‘s File Bridge 0.6.2 v0.6迭代内测.dmg`
- `LK‘s File Bridge 0.6.2 v0.6迭代内测.zip`

这是未签名 CEP 内测包。给同事时优先发送 DMG；双击后运行“安装 LK‘s File Bridge.command”，再重启 Adobe 软件。安装脚本会自动开启 CSXS 12 的 PlayerDebugMode，并在覆盖旧版本前保留带时间戳的备份。

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
