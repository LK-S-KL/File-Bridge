# Rove

Rove 是面向 Adobe Premiere Pro 25.0 与 After Effects 25.0 的飞牛 NAS 素材面板。当前版本直接读取已经挂载到 Mac 的 SMB 文件夹，不调用 Seek 私有接口。

## v0.3 能力

- 同时添加多个素材文件夹；默认只读当前一组，也可自定义勾选一组/多组或读取全部位置
- SMB 目录异步分批扫描；单个位置离线不影响其他位置，也不会因一次全量同步读取锁死面板
- 工具栏放大镜浮层搜索；视频、图片、音频、LUT 分类
- 文件名、大小、类型、修改日期和时长排序，支持升序/降序
- 按文件大小、格式、本机色彩标签、素材位置和元数据状态筛选
- 88–260 px 连续缩略图大小调节
- 视频封面和 12 帧雪碧图滑动预览
- 音频波形
- 缩略图左下角显示视频/音频时长或图片分辨率，右上角常驻收藏星标与色彩标签
- 双击全屏预览视频、音频或图片；视频支持逐帧、源时间码（含 29.97/59.94 丢帧）、I/O 点、I/O 循环和原画/4K/1080p/720p/580p/360p 播放代理
- MOV 或浏览器不兼容的编码自动生成 H.264/AAC 兼容播放代理
- 预览画面可拖入 Premiere；按住 Alt 拖动视频时发送预先生成的纯音频副本
- 一键从原始视频生成原尺寸 PNG 并导入 Premiere 项目
- `.cube` LUT 解析、低对比风景样片、左右原图/LUT 对比和效果强度调节；可明确选择复制到 Lumetri Creative LUT 目录
- 右键悬浮查看格式、时长、码率、编码、分辨率、帧率、色彩空间、动态范围、Alpha、像素格式、位深、音频声道等元数据
- 右键把视频转码为 1080p、720p 或 360p MP4，输出到源文件当前目录；优先使用 macOS VideoToolbox
- 本机收藏和六种本机色彩标签；Premiere 与 AE 共用并跨重启保留
- Premiere：卡片可直接拖到素材箱、源监视器或时间线
- Premiere：右键导入项目或放到当前播放头
- After Effects：右键导入项目或加入当前合成
- Finder 定位、重命名、移到废纸篓

## LUT 与 Lumetri 的边界

Premiere CEP 没有稳定的公开接口，可让扩展面板把任意 `.cube` 路径直接交给 Lumetri 并返回原生渲染画面。Rove 因此在 Canvas 中做 8-bit sRGB 三线性插值预览，用于挑选方向；它不会伪装成最终调色结果。只有用户明确点击“复制到 Lumetri LUT 目录”时，才会写入 Adobe 用户级 `Creative` LUT 目录，重启 Premiere 后可在 Lumetri 中选择。

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
- 用户明确点击“截图入项目”后，原尺寸 PNG 保存在 `~/Pictures/fnOS Bridge Captures` 并导入项目，避免清理缓存后工程离线
- 多路径、收藏、标签和视图设置写入 `~/Library/Application Support/fnOS Bridge/state.json`
- 收藏和标签目前只在这台 Mac 生效，不会同步回 Seek
- 单纯浏览、双击预览、切换播放代理、设置 I/O 点或预览 LUT 都不会创建 Adobe ProjectItem，也不会给工程增加负担
- 只有明确拖放、右键导入/放置、“截图入项目”才会改变 Adobe 工程
- 重命名和“移到废纸篓”会操作 NAS 真实源文件，并在执行前明确警告
- 不允许通过面板更改扩展名
- 删除只调用 macOS Foundation 的安全废纸篓接口；共享盘不支持时直接失败，绝不降级成永久删除
- 已导入 Adobe 的素材被重命名或移走后，工程引用可能离线

## 打开方式

完整退出并重新打开 Adobe 软件，然后选择：

`窗口 > 扩展 > Rove`

## 开发检查

```bash
npm test
```

Premiere 与 AE 的调试端口分别为 `9360` 和 `9361`。

版本发布和日常维护分别参见 [`docs/RELEASING.md`](docs/RELEASING.md) 与 [`CONTRIBUTING.md`](CONTRIBUTING.md)。当前开发版内部 ID 暂时保留为 `com.fnnas.seekbridge.mvp`，避免破坏本机安装和数据；第一次正式发布前应确定并冻结最终 ID，发布后不要随意更换。

本轮逐项实现与宿主复核边界见 [`docs/V0.3_ACCEPTANCE.md`](docs/V0.3_ACCEPTANCE.md)。

## 卸载开发版

运行 `scripts/uninstall.command`。它只会把 Adobe 扩展目录中的开发软链接移到废纸篓，不会删除项目源代码、NAS 素材、本机收藏或派生媒体缓存。
