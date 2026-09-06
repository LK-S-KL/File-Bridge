# LK File Bridge UI 4.3 接入记录

## 来源

本次视觉资源来自 `/Users/lk/Downloads/LK-File-Bridge-UI-Project.zip`，运行时资源位于 `extension/ui/`。

- `extension/ui/icons/`：统一 24px viewBox、1.75 描边的公共 SVG 图标。
- `extension/ui/design-tokens.json`：颜色、间距、工具栏与缩略图规范。
- `extension/ui/specs/design-tokens.css`：设计变量原始定义。
- `extension/css/ui-4.3.css`：CEP 原生 DOM 的运行时适配层。

## 运行时映射

- 工具栏：`index.html` 的 `.topbar`、`.toolbar`、`.filter-row` 对应 UI 4.3 的 utility、browsing、category 三层布局。
- 素材卡片：`main.js` 动态创建的 `.asset-card` 使用 UI 4.2 通透缩略图规则，收藏、置顶、勾选和时间码由状态驱动。
- 预览区：选中素材后由 `syncPreviewDock()` 更新右侧预览和信息；双击仍进入完整播放器。
- 图标：`ui-4.3.css` 使用本地 SVG mask，动态颜色由 CSS tokens 控制，不依赖远程字体或网络资源。

## 验证

- `npm test`：64/64 通过。
- 浏览器烟测：常驻搜索、素材位置菜单、卡片/列表切换、选中预览、右键菜单和 420px 窄宽度布局通过。
- CEP 业务逻辑未替换：扫描、代理、播放、文件操作、标签、文件夹层级和项目打包继续使用原实现。
