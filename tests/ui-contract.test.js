const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const css = fs.readFileSync(new URL("../extension/css/panel.css", require("node:url").pathToFileURL(__filename)), "utf8");
const main = fs.readFileSync(new URL("../extension/js/main.js", require("node:url").pathToFileURL(__filename)), "utf8");
const html = fs.readFileSync(new URL("../extension/index.html", require("node:url").pathToFileURL(__filename)), "utf8");
const uiCss = fs.readFileSync(new URL("../extension/css/ui-4.3.css", require("node:url").pathToFileURL(__filename)), "utf8");

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

test("plugin folders render as a separate hierarchy with a visible back control", () => {
  assert.match(html, /id="folderScopeBar"/);
  assert.match(html, /id="folderBackButton"/);
  assert.match(main, /function\s+createAssetGroupHeading\s*\(label, count\)/);
  assert.match(main, /function\s+renderPluginFolderPreview\s*\(asset, container, generation\)/);
  assert.match(main, /assetAssignedToPluginFolder\(asset\)/);
  assert.match(main, /parentId:\s*state\.folderScope && state\.folderScope\.pluginFolderId/);
  assert.match(css, /\.asset-group-heading\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(css, /\.folder-collage\s*\{/);
  assert.match(css, /\.folder-scope-bar\s*\{/);
  assert.match(css, /\.folder-empty-icon\s*\{/);
  assert.match(main, /parentId\s*=\s*pluginFolderParentId\(pluginFolder\)/);
  assert.match(main, /persistPluginFolders\(\);\s*rebuildAssetMap\(\);/);
  assert.match(main, /item\.type\s*===\s*"audio"[\s\S]*?waveformFor\(item\.path\)/);
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
