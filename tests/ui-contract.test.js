const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const css = fs.readFileSync(new URL("../extension/css/panel.css", require("node:url").pathToFileURL(__filename)), "utf8");

test("card grid keeps intrinsic rows and 16:9 thumbnails", () => {
  assert.match(css, /\.asset-thumb\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
  assert.match(css, /\.asset-grid:not\(\.is-list-view\)\s*\{[^}]*grid-auto-rows:\s*max-content/s);
  assert.doesNotMatch(css, /\.asset-card\s*\{[^}]*contain:\s*layout/s);
});

test("list mode owns its fixed row height separately from card mode", () => {
  assert.match(css, /\.asset-grid\.is-list-view\s*\{[^}]*grid-auto-rows:\s*74px/s);
  assert.match(css, /@media\s*\(max-width:\s*390px\)[\s\S]*\.asset-grid\.is-list-view\s*\{[^}]*grid-auto-rows:\s*62px/s);
});
