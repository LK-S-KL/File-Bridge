const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const css = fs.readFileSync(new URL("../extension/css/panel.css", require("node:url").pathToFileURL(__filename)), "utf8");
const main = fs.readFileSync(new URL("../extension/js/main.js", require("node:url").pathToFileURL(__filename)), "utf8");
const html = fs.readFileSync(new URL("../extension/index.html", require("node:url").pathToFileURL(__filename)), "utf8");
const uiCss = fs.readFileSync(new URL("../extension/css/ui-4.3.css", require("node:url").pathToFileURL(__filename)), "utf8");
const playerCss = fs.readFileSync(new URL("../extension/css/player-4.5.css", require("node:url").pathToFileURL(__filename)), "utf8");

test("card grid keeps intrinsic rows and 16:9 thumbnails", () => {
  assert.match(css, /\.asset-thumb\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
  assert.match(css, /\.asset-grid:not\(\.is-list-view\)\s*\{[^}]*grid-auto-rows:\s*max-content/s);
  assert.doesNotMatch(css, /\.asset-card\s*\{[^}]*contain:\s*layout/s);
});

test("list mode owns its fixed row height separately from card mode", () => {
  assert.match(css, /\.asset-grid\.is-list-view\s*\{[^}]*grid-auto-rows:\s*max-content/s);
  assert.match(css, /\.asset-grid\.is-list-view \.asset-card\s*\{[^}]*height:\s*74px/s);
  assert.match(css, /@media\s*\(max-width:\s*390px\)[\s\S]*\.asset-grid\.is-list-view \.asset-card\s*\{[^}]*height:\s*62px/s);
});

test("selected video preview uses an inline audible video from the first frame", () => {
  assert.match(main, /function\s+playSelectedVideoPreview\s*\(asset\)/);
  assert.match(main, /media\s*=\s*document\.createElement\("video"\)/);
  assert.match(main, /media\.muted\s*=\s*false/);
  assert.match(main, /media\.currentTime\s*=\s*0/);
  assert.match(main, /function\s+stopSelectedVideoPreview\s*\(\)/);
  assert.match(main, /fallbackSelectedVideoPreview\(asset, media, token\)/);
  assert.match(css, /\.asset-thumb \.selection-preview-video\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.asset-thumb\.is-selection-preview \.sprite-preview\s*\{[^}]*opacity:\s*0\s*!important/s);
});

test("plugin folders render as a collapsible hierarchy with a minimal back control", () => {
  assert.match(html, /id="folderScopeBar"/);
  assert.match(html, /id="folderBackButton"/);
  assert.doesNotMatch(html, /id="folderScopeLabel"|folder-scope-copy|当前文件夹/);
  assert.match(main, /function\s+createAssetGroupHeading\s*\(label, count, groupKey\)/);
  assert.match(main, /heading\.setAttribute\("aria-expanded", collapsed \? "false" : "true"\)/);
  assert.match(main, /function\s+toggleAssetGroup\s*\(groupKey\)/);
  assert.match(main, /function\s+renderPluginFolderPreview\s*\(asset, container, generation\)/);
  assert.match(main, /assetAssignedToPluginFolder\(asset\)/);
  assert.match(main, /parentId:\s*state\.folderScope && state\.folderScope\.pluginFolderId/);
  assert.match(css, /\.asset-group-heading\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(css, /\.folder-collage\s*\{/);
  assert.match(css, /\.folder-scope-bar\s*\{/);
  assert.match(css, /\.folder-empty-icon\s*\{/);
  assert.match(main, /parentId\s*=\s*pluginFolderParentId\(pluginFolder\)/);
  assert.match(main, /if \(!applyPluginFolderResult\(result\)\) \{ return false; \}\s*rebuildAssetMap\(\);/);
  assert.match(main, /item\.type\s*===\s*"audio"[\s\S]*?waveformFor\(item\.path\)/);
});

test("virtual files support copy, cut, paste, and root placement persistence", () => {
  assert.match(html, /id="copyAssetsButton"[^>]+data-command="copy-assets"/);
  assert.match(html, /id="cutAssetsButton"[^>]+data-command="cut-assets"/);
  assert.match(html, /id="pasteAssetsButton"[^>]+data-command="paste-assets"/);
  assert.match(html, /id="pasteAssetsFromResultsButton"/);
  assert.ok(html.indexOf('src="js/plugin-folder-ops.js"') < html.indexOf('src="js/main.js"'));
  assert.match(main, /pluginRootAssetKeys:\s*persisted\.pluginRootAssetKeys/);
  assert.match(main, /pluginFolderOps\.makeClipboard\(mode, keys, currentPluginFolderScopeId\(\)/);
  assert.match(main, /pluginFolderOps\.paste\(pluginFolderModel\(\), clipboard/);
  assert.match(main, /shortcut === "c"[\s\S]*shortcut === "x"[\s\S]*shortcut === "v"/);
});

test("ordinary selection never shows a checkbox outside selection mode", () => {
  assert.match(uiCss, /\.asset-select-check\s*\{[^}]*display:\s*none/s);
  assert.match(uiCss, /\.asset-card\.is-selection-mode \.asset-select-check\s*\{[^}]*display:\s*grid/s);
  assert.match(uiCss, /\.asset-card\.is-selection-mode\.is-selected \.asset-select-check/);
  assert.doesNotMatch(uiCss, /:not\(\.is-selection-mode\):not\(\.is-selected\)/);
  assert.match(main, /check\.textContent\s*=\s*selected \? "✓" : ""/);
});

test("viewer close control is compact and vertically aligned", () => {
  assert.match(uiCss, /\.viewer-header\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\) 24px[^}]*align-items:\s*center/s);
  assert.match(uiCss, /\.viewer-close\s*\{[^}]*position:\s*static[^}]*width:\s*24px[^}]*height:\s*24px/s);
});

test("blank grid clicks stop inline playback and list mode blocks clean cards", () => {
  assert.match(main, /\}\s*else\s*\{\s*stopAudioHover\(\);\s*stopSelectedVideoPreview\(\);\s*\}/s);
  assert.match(main, /var clean = !list && state\.preferences\.cardStyle === "clean"/);
  assert.match(main, /elements\.cardStyleButton\.disabled = list/);
  assert.match(main, /if \(state\.preferences\.viewMode === "list"\) \{ return; \}/);
});

test("category row has no vertical scrollbar and material source menu is simplified", () => {
  assert.match(uiCss, /\.filter-row\s*\{[^}]*overflow-y:\s*hidden/s);
  assert.match(uiCss, /\.filter-row::\-webkit-scrollbar\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(html, /utility-source-label|source-menu-actions|openLocationsSettingsButton|createFolderFromLocationsButton|uploadFolderFromLocationsButton/);
  assert.match(html, /id="locationsToolbarButton"[^>]+aria-label="管理素材来源"/);
});

test("labels use Chinese color names and LUT preview uses a bundled photo", () => {
  const lutSample = new URL("../extension/ui/assets/lut-preview-landscape-log.jpg", require("node:url").pathToFileURL(__filename));
  assert.doesNotMatch(main, /violet:\s*"Violet"|iris:\s*"Iris"|caribbean:\s*"Caribbean"/);
  assert.match(main, /violet:\s*"紫罗兰"[\s\S]*iris:\s*"靛蓝"/);
  assert.match(main, /LUT_SAMPLE_SOURCE\s*=\s*"ui\/assets\/lut-preview-landscape-log\.jpg"/);
  assert.ok(fs.statSync(lutSample).size > 100000);
  assert.match(main, /function\s+loadLutSampleImage\s*\(\)/);
  assert.match(main, /context\.drawImage\(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height\)/);
});

test("UI 4.3 toolbar keeps the designed control groups", () => {
  assert.match(html, /id="inlineSearchField"/);
  assert.match(html, /id="listModeButton"/);
  assert.match(html, /id="toolbarExportButton"/);
  assert.match(html, /id="previewDock"/);
  assert.match(uiCss, /\.toolbar-left #filterButton\s*\{[^}]*flex:\s*0 0 auto/s);
  assert.match(uiCss, /\.toolbar-left \.sort-trigger\s*\{[^}]*min-width:\s*72px/s);
  assert.match(uiCss, /\.ui-icon\[data-icon="download"\]/);
  assert.match(uiCss, /\.preview-dock\s*\{/);
});

test("player 4.5 follows the supplied five-control layout", () => {
  assert.match(html, /id="viewerBuffered"/);
  assert.match(html, /id="speedButton"/);
  assert.match(html, /id="viewerSpeedMenu"/);
  assert.match(html, /data-speed="0\.5"/);
  assert.match(html, /data-speed="2"/);
  assert.match(html, /data-quality="540"/);
  assert.ok(html.indexOf('href="css/player-4.5.css"') > html.indexOf('href="css/ui-4.3.css"'));
  assert.match(playerCss, /\.viewer-timeline\s*\{[^}]*min-height:\s*132px[^}]*grid-template-rows:\s*28px 24px 1fr/s);
  assert.match(playerCss, /\.viewer-timecode\s*\{[^}]*justify-self:\s*center[^}]*font:\s*13px\/22px Menlo/s);
  assert.match(playerCss, /\.viewer-buffered\s*\{/);
  assert.match(playerCss, /\.transport-right\s*\{[^}]*margin-left:\s*auto/s);
  assert.match(playerCss, /\.volume-control input\s*\{[^}]*width:\s*88px/s);
  assert.match(playerCss, /@media \(max-width:\s*560px\)[\s\S]*min-height:\s*176px[\s\S]*\.transport-right\s*\{[^}]*width:\s*312px/s);
  assert.match(main, /function\s+chooseViewerSpeed\s*\(event\)/);
  assert.match(main, /media\.playbackRate\s*=\s*viewerState\.playbackRate/);
  assert.match(main, /elements\.timelineTrackWrap\.style\.setProperty\("--viewer-buffered-end"/);
  assert.match(main, /formatViewerTimecode\(media\.currentTime\) \+ " \/ "[\s\S]*formatViewerTimecode\(duration\)/);
});
