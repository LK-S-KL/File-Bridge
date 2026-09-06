const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const folderOps = require("../extension/js/plugin-folder-ops.js");
const stateStoreModule = require("../extension/js/state-store.js");

function model(folders, rootKeys) {
  return {
    pluginFolders: folders.map((folder) => ({
      id: folder.id,
      name: folder.id,
      parentId: "",
      assetKeys: folder.keys.slice()
    })),
    pluginRootAssetKeys: (rootKeys || []).slice()
  };
}

function folderKeys(result, id) {
  return result.pluginFolders.find((folder) => folder.id === id).assetKeys;
}

test("copies an implicit-root asset into a folder while preserving root visibility", () => {
  const input = model([{ id: "a", keys: [] }]);
  const clipboard = folderOps.makeClipboard("copy", ["/Media/one.mov"], "");
  const result = folderOps.paste(input, clipboard, "a");

  assert.deepEqual(folderKeys(result, "a"), ["/Media/one.mov"]);
  assert.deepEqual(result.pluginRootAssetKeys, ["/Media/one.mov"]);
  assert.equal(folderOps.isVisibleInScope(result, "/Media/one.mov", ""), true);
  assert.equal(folderOps.isVisibleInScope(result, "/Media/one.mov", "a"), true);
  assert.equal(result.clipboard.mode, "copy");
  assert.deepEqual(input, model([{ id: "a", keys: [] }]));
});

test("cuts an implicit-root asset into a folder and clears the cut clipboard", () => {
  const input = model([{ id: "a", keys: [] }]);
  const result = folderOps.paste(input, folderOps.makeClipboard("cut", ["/Media/one.mov"], ""), "a");

  assert.deepEqual(folderKeys(result, "a"), ["/Media/one.mov"]);
  assert.deepEqual(result.pluginRootAssetKeys, []);
  assert.equal(folderOps.isVisibleInScope(result, "/Media/one.mov", ""), false);
  assert.equal(result.clipboard.mode, "");
});

test("copy and cut between folders have distinct placement semantics", () => {
  const input = model([{ id: "a", keys: ["/Media/one.mov"] }, { id: "b", keys: [] }]);
  const copied = folderOps.paste(input, folderOps.makeClipboard("copy", ["/Media/one.mov"], "a"), "b");
  const cut = folderOps.paste(input, folderOps.makeClipboard("cut", ["/Media/one.mov"], "a"), "b");

  assert.deepEqual(folderKeys(copied, "a"), ["/Media/one.mov"]);
  assert.deepEqual(folderKeys(copied, "b"), ["/Media/one.mov"]);
  assert.deepEqual(folderKeys(cut, "a"), []);
  assert.deepEqual(folderKeys(cut, "b"), ["/Media/one.mov"]);
});

test("copy and cut from a folder back to root preserve the expected source placement", () => {
  const input = model([{ id: "a", keys: ["/Media/one.mov"] }]);
  const copied = folderOps.paste(input, folderOps.makeClipboard("copy", ["/Media/one.mov"], "a"), "");
  const cut = folderOps.paste(input, folderOps.makeClipboard("cut", ["/Media/one.mov"], "a"), "");

  assert.deepEqual(folderKeys(copied, "a"), ["/Media/one.mov"]);
  assert.deepEqual(copied.pluginRootAssetKeys, ["/Media/one.mov"]);
  assert.deepEqual(folderKeys(cut, "a"), []);
  assert.deepEqual(cut.pluginRootAssetKeys, []);
  assert.equal(folderOps.isVisibleInScope(cut, "/Media/one.mov", ""), true);
});

test("cutting one of several folder placements to root keeps an explicit root placement", () => {
  const input = model([
    { id: "a", keys: ["/Media/one.mov"] },
    { id: "b", keys: ["/Media/one.mov"] }
  ]);
  const result = folderOps.paste(input, folderOps.makeClipboard("cut", ["/Media/one.mov"], "a"), "");

  assert.deepEqual(folderKeys(result, "a"), []);
  assert.deepEqual(folderKeys(result, "b"), ["/Media/one.mov"]);
  assert.deepEqual(result.pluginRootAssetKeys, ["/Media/one.mov"]);
});

test("paste is idempotent, reports missing assets, and rejects an unknown target folder", () => {
  const input = model([{ id: "a", keys: ["/Media/one.mov"] }]);
  const sameScope = folderOps.paste(input, folderOps.makeClipboard("copy", ["/Media/one.mov"], "a"), "a");
  const missing = folderOps.paste(input, folderOps.makeClipboard("copy", ["/Media/missing.mov"], ""), "a", { availableAssetKeys: ["/Media/one.mov"] });

  assert.equal(sameScope.changed, false);
  assert.deepEqual(sameScope.unchangedAssetKeys, ["/Media/one.mov"]);
  assert.deepEqual(missing.missingAssetKeys, ["/Media/missing.mov"]);
  assert.throws(
    () => folderOps.paste(input, folderOps.makeClipboard("cut", ["/Media/one.mov"], "a"), "missing"),
    (error) => error.code === "TARGET_FOLDER_NOT_FOUND"
  );
});

test("a cut clipboard retains assets that are temporarily unavailable", () => {
  const input = model([{ id: "a", keys: [] }]);
  const result = folderOps.paste(
    input,
    folderOps.makeClipboard("cut", ["/Media/online.mov", "/Media/offline.mov"], ""),
    "a",
    { availableAssetKeys: ["/Media/online.mov"] }
  );

  assert.deepEqual(folderKeys(result, "a"), ["/Media/online.mov"]);
  assert.equal(result.clipboard.mode, "cut");
  assert.deepEqual(result.clipboard.assetKeys, ["/Media/offline.mov"]);
});

test("migrates and forgets asset keys across every virtual placement", () => {
  const input = model([
    { id: "a", keys: ["/old.mov"] },
    { id: "b", keys: ["/old.mov", "/new.mov"] }
  ], ["/old.mov"]);
  const migrated = folderOps.migrateAssetKey(input, "/old.mov", "/new.mov");
  const forgotten = folderOps.forgetAssetKeys(migrated, ["/new.mov"]);

  assert.deepEqual(folderKeys(migrated, "a"), ["/new.mov"]);
  assert.deepEqual(folderKeys(migrated, "b"), ["/new.mov"]);
  assert.deepEqual(migrated.pluginRootAssetKeys, ["/new.mov"]);
  assert.deepEqual(folderKeys(forgotten, "a"), []);
  assert.deepEqual(folderKeys(forgotten, "b"), []);
  assert.deepEqual(forgotten.pluginRootAssetKeys, []);
});

test("normalizes Windows-style keys case-insensitively when requested", () => {
  const input = model([{ id: "a", keys: ["C:\\Media\\ONE.MOV"] }]);
  const normalized = folderOps.normalizeModel(input, { caseInsensitive: true });

  assert.deepEqual(folderKeys(normalized, "a"), ["c:/media/one.mov"]);
  assert.equal(folderOps.isVisibleInScope(normalized, "C:\\MEDIA\\ONE.MOV", "a", { caseInsensitive: true }), true);
});

test("state storage persists explicit root placements and keeps old state compatible", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-plugin-root-"));
  const store = stateStoreModule.create({ fs, path, os: { homedir: () => fixture } });
  try {
    const legacy = stateStoreModule.normalize({
      pluginFolders: [{ id: "a", name: "A", assetKeys: ["/Media/one.mov"] }]
    });
    assert.deepEqual(legacy.pluginRootAssetKeys, []);

    const saved = store.save({
      pluginFolders: [{ id: "a", name: "A", assetKeys: ["/Media/one.mov"] }],
      pluginRootAssetKeys: ["/Media/one.mov", "/Media/one.mov", "", null]
    });
    assert.deepEqual(saved.pluginRootAssetKeys, ["/Media/one.mov"]);
    assert.deepEqual(store.load().pluginRootAssetKeys, ["/Media/one.mov"]);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
