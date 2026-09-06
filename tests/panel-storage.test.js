const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const folderOps = require("../extension/js/plugin-folder-ops.js");
const stateStore = require("../extension/js/state-store.js");

const main = fs.readFileSync(path.join(__dirname, "../extension/js/main.js"), "utf8");
function functionSource(name) {
  const start = main.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1);
  const end = main.indexOf("\n  function ", start + 1);
  return main.slice(start, end === -1 ? main.indexOf('\n  if (document.readyState', start) : end);
}

function fixture() {
  let writes = 0;
  let scans = 0;
  let fail = true;
  let disk = stateStore.defaults();
  disk.pluginFolders = [{ id: "folder", name: "Original folder", parentId: "", assetKeys: [] }];
  const state = {
    ...structuredClone(disk), assets: [{ domId: "asset", path: "/media/clip.mp4", type: "video" }],
    assetClipboard: folderOps.makeClipboard("cut", ["/media/clip.mp4"], ""),
    selectedIds: { asset: true }, selectedId: "asset", selectionAnchorId: "asset", folderScope: null
  };
  const notices = [];
  const context = {
    state, persisted: structuredClone(disk), pluginFolderOps: folderOps,
    stateStore: { mutate(update) { writes += 1; if (fail) { throw Object.assign(new Error("storage unavailable"), { code: "STATE_RECOVERY_REQUIRED" }); } const next = structuredClone(disk); update(next); disk = structuredClone(next); return next; } },
    elements: { dialogConfirmButton: { disabled: false }, renameInput: { value: "New folder" }, fileActionDialog: { hidden: false } },
    notices, showNotice: (message) => notices.push(message), friendlyError: (error) => error.message,
    assetForId: (id) => id === "folder-card" ? { type: "plugin-folder", pluginFolderId: "folder" } : state.assets.find((asset) => asset.domId === id),
    rebuildAssetMap() {}, applyFilters() {}, renderAssets() {}, renderLocations() {}, renderFolderScopeBar() {},
    scrollAssetIntoView() {}, scanAssets() { scans += 1; }, setTimeout() {},
    assetOps: { renameAsset: async () => ({ changed: true, oldPath: "/media/clip.mp4", path: "/media/new.mp4", name: "new.mp4" }) }
  };
  vm.createContext(context);
  ["persistPluginFolders", "persistState", "normalizeAssetKey", "FolderPlatformIsWindows", "pluginFolderParentId", "pluginFolderChildren", "pluginFolderById", "pluginFolderModel", "pluginFolderOptions", "currentPluginFolderScopeId", "applyPluginFolderResult", "assignPathsToPluginFolder", "pasteAssetClipboard", "closeDialog", "confirmDialogAction", "migrateLocalMeta", "performRename"].forEach((name) => vm.runInContext(functionSource(name), context));
  return { context, state, notices, setWritable() { fail = false; }, writes: () => writes, scans: () => scans, disk: () => disk };
}

test("failed cut-paste preserves folder model, root placement and clipboard for retry", () => {
  const item = fixture();
  const before = JSON.stringify(item.state);
  assert.equal(item.context.pasteAssetClipboard("folder"), false);
  assert.equal(JSON.stringify(item.state), before);
  assert.equal(item.notices.some((notice) => notice.startsWith("已粘贴")), false);
  item.setWritable();
  assert.equal(item.context.pasteAssetClipboard("folder"), true);
  assert.deepEqual(Array.from(item.state.pluginFolders[0].assetKeys), ["/media/clip.mp4"]);
  assert.equal(item.state.assetClipboard.assetKeys.length, 0);
  assert.equal(item.writes(), 2, "each paste commits once");
});

test("failed drag assignment retains original virtual model and clipboard", () => {
  const item = fixture();
  const before = JSON.stringify(item.state);
  assert.equal(item.context.assignPathsToPluginFolder("folder", ["/media/clip.mp4"]), false);
  assert.equal(JSON.stringify(item.state), before);
});

test("failed folder create, rename and delete keep the dialog open and do not claim success", () => {
  for (const action of [
    { type: "create-plugin-folder" },
    { type: "rename-plugin-folder", assetId: "folder-card" },
    { type: "delete-plugin-folder", pluginFolderId: "folder" }
  ]) {
    const item = fixture();
    const before = JSON.stringify(item.state.pluginFolders);
    item.state.dialogAction = action;
    item.context.confirmDialogAction();
    assert.equal(JSON.stringify(item.state.pluginFolders), before);
    assert.equal(item.state.dialogAction, action);
    assert.equal(item.context.elements.fileActionDialog.hidden, false);
    assert.equal(item.context.elements.dialogConfirmButton.disabled, false);
    assert.equal(item.notices.some((notice) => /已创建|已重命名|已删除/.test(notice)), false);
  }
});

test("physical rename reports reference-save partial failure and still refreshes the real file", async () => {
  const item = fixture();
  item.state.assetMeta["/media/clip.mp4"] = { favorite: true };
  item.state.pluginFolders[0].assetKeys = ["/media/clip.mp4"];
  item.state.dialogAction = { type: "rename", assetId: "asset" };
  item.context.performRename(item.state.assets[0]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(item.scans(), 1);
  assert.equal(item.context.elements.fileActionDialog.hidden, true);
  assert.equal(item.context.elements.dialogConfirmButton.disabled, false);
  assert.equal(item.state.assetMeta["/media/new.mp4"].favorite, true);
  assert.deepEqual(Array.from(item.state.pluginFolders[0].assetKeys), ["/media/new.mp4"]);
  assert.ok(item.notices.some((notice) => notice.includes("文件已重命名") && notice.includes("未能保存")));
  assert.equal(item.notices.some((notice) => notice.startsWith("重命名失败")), false);
});
