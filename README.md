# Rove

File Bridge 是面向 Adobe Premiere Pro 25.0 与 After Effects 25.0 的飞牛 NAS 素材面板。当前版本直接读取已经挂载到 Mac 的 SMB 文件夹。

## v0.2 能力

- 同时添加多个素材文件夹；单个位置离线不影响其他位置
- 文件名和所在文件夹搜索
- 视频、图片、音频分类
- 文件名、大小、类型、修改日期和时长排序，支持升序/降序
- 按文件大小、格式、本机色彩标签、素材位置和元数据状态筛选
- 三档缩略图大小
- 视频封面和 12 帧雪碧图滑动预览
- 音频波形
- 双击在插件内全屏预览视频、音频或图片
- 右键查看格式、时长、码率、编码、分辨率、帧率、色彩空间、动态范围、Alpha、像素格式、位深、音频声道等元数据
- 本机收藏和六种本机色彩标签；Premiere 与 AE 共用
- Premiere：卡片可直接拖到素材箱、源监视器或时间线
- Premiere：按钮导入项目或放到当前播放头
- After Effects：按钮导入项目或加入当前合成
- Finder 定位、重命名、移到废纸篓

## Adobe 拖拽边界

Premiere Pro 25.0 的 CEP 支持文件从扩展面板拖到宿主：

- 拖到项目面板：导入工程
- 拖到源监视器：打开源素材
- 拖到时间线：导入并放入时间线

After Effects 没有可靠的扩展面板文件拖入协议，因此 AE 中卡片不会宣称可拖，使用“导入项目”或“加入当前合成”。

## 数据与文件安全

- 浏览、搜索、缩略图、雪碧图、波形和 ffprobe 元数据不会修改源素材
- 派生媒体只写入 `~/Library/Caches/com.fnnas.fnosbridge.mvp`
- 多路径、收藏、标签和视图设置写入 `~/Library/Application Support/fnOS Bridge/state.json`
- 收藏和标签目前只在这台 Mac 生效，不会同步回 Seek
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

## 卸载开发版

运行 `scripts/uninstall.command`。它只会把 Adobe 扩展目录中的开发软链接移到废纸篓，不会删除项目源代码、NAS 素材、本机收藏或派生媒体缓存。
