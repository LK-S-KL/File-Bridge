const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const css = fs.readFileSync(new URL("../extension/css/panel.css", require("node:url").pathToFileURL(__filename)), "utf8");
const main = fs.readFileSync(new URL("../extension/js/main.js", require("node:url").pathToFileURL(__filename)), "utf8");

test("card grid keeps intrinsic rows and 16:9 thumbnails", () => {
  assert.match(css, /\.asset-thumb\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
  assert.match(css, /\.asset-grid:not\(\.is-list-view\)\s*\{[^}]*grid-auto-rows:\s*max-content/s);
  assert.doesNotMatch(css, /\.asset-card\s*\{[^}]*contain:\s*layout/s);
});

test("list mode owns its fixed row height separately from card mode", () => {
  assert.match(css, /\.asset-grid\.is-list-view\s*\{[^}]*grid-auto-rows:\s*74px/s);
  assert.match(css, /@media\s*\(max-width:\s*390px\)[\s\S]*\.asset-grid\.is-list-view\s*\{[^}]*grid-auto-rows:\s*62px/s);
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
