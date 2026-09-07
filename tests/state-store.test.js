const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const test = require("node:test");

const stateStoreModule = require("../extension/js/state-store.js");

test("persists multiple roots and local asset metadata atomically", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fnos-state-"));
  const store = stateStoreModule.create({ fs, path, os: { homedir: () => fixture } });
  try {
    store.save({
      schemaVersion: 1,
      roots: [
        { id: "one", path: "/Volumes/素材一", label: "素材一", enabled: true },
        { id: "two", path: "/Volumes/素材二", label: "素材二", enabled: true }
      ],
      assetMeta: { "/Volumes/素材一/a.mp4": { favorite: true, label: "blue" } },
      pluginFolders: [{ id: "pf-one", name: "精选", parentId: "", assetKeys: ["/Volumes/素材一/a.mp4"] }],
      libraryCache: { one: [{ name: "a.mp4", path: "/Volumes/素材一/a.mp4", relativePath: "a.mp4", folder: "根目录", extension: "mp4", type: "video", size: 12, modifiedMs: 20 }] },
      preferences: {
        sortBy: "size",
        sortDirection: "asc",
        zoom: 176,
        scanMode: "selected",
        activeRootId: "two",
        viewMode: "list",
        cardStyle: "clean"
      }
    });
    const loaded = store.load();
    assert.equal(loaded.roots.length, 2);
    assert.equal(loaded.assetMeta["/Volumes/素材一/a.mp4"].favorite, true);
    assert.equal(loaded.pluginFolders[0].name, "精选");
    assert.equal(loaded.preferences.sortBy, "size");
    assert.equal(loaded.preferences.zoom, 176);
    assert.equal(loaded.preferences.scanMode, "selected");
    assert.equal(loaded.preferences.activeRootId, "two");
    assert.equal(loaded.preferences.viewMode, "list");
    assert.equal(loaded.preferences.cardStyle, "clean");
    assert.equal(loaded.libraryCache.one[0].name, "a.mp4");
    assert.equal(fs.statSync(store.path).mode & 0o777, 0o600);
    const leftovers = fs.readdirSync(path.dirname(store.path)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("migrates the original three-position zoom preference to pixels", () => {
  assert.equal(stateStoreModule.normalize({ preferences: { zoom: 0 } }).preferences.zoom, 96);
  assert.equal(stateStoreModule.normalize({ preferences: { zoom: 1 } }).preferences.zoom, 128);
  assert.equal(stateStoreModule.normalize({ preferences: { zoom: 2 } }).preferences.zoom, 176);
});

test("defaults and normalizes offline preview cache preferences", () => {
  const defaults = stateStoreModule.defaults().preferences;
  assert.equal(defaults.previewCacheRoot, "");
  assert.equal(defaults.previewCacheMaxGiB, 12);
  assert.equal(defaults.previewPerformance, "low");
  const preferences = stateStoreModule.normalize({ preferences: { previewCacheRoot: "/Volumes/Preview SSD", previewCacheMaxGiB: 256, previewPerformance: "balanced" } }).preferences;
  assert.equal(preferences.previewCacheRoot, "/Volumes/Preview SSD");
  assert.equal(preferences.previewCacheMaxGiB, 128);
  assert.equal(preferences.previewPerformance, "balanced");
  assert.equal(stateStoreModule.normalize({ preferences: { previewCacheMaxGiB: -1 } }).preferences.previewCacheMaxGiB, 2);
  const invalid = stateStoreModule.normalize({ preferences: { previewCacheRoot: {}, previewCacheMaxGiB: "bad", previewPerformance: "maximum" } }).preferences;
  assert.equal(invalid.previewCacheRoot, "");
  assert.equal(invalid.previewCacheMaxGiB, 12);
  assert.equal(invalid.previewPerformance, "low");
});

test("recovers safely from a corrupt state file", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fnos-state-corrupt-"));
  const store = stateStoreModule.create({ fs, path, os: { homedir: () => fixture } });
  try {
    fs.mkdirSync(path.dirname(store.path), { recursive: true });
    fs.writeFileSync(store.path, "not json", "utf8");
    const loaded = store.load();
    assert.deepEqual(loaded.roots, []);
    assert.deepEqual(loaded.assetMeta, {});
    assert.equal(store.getStatus().writable, false);
    assert.equal(store.getStatus().code, "STATE_RECOVERY_REQUIRED");
    assert.throws(() => store.mutate((state) => { state.assetMeta.new = { favorite: true }; }), { code: "STATE_RECOVERY_REQUIRED" });
    assert.throws(() => store.save(stateStoreModule.defaults()), { code: "STATE_RECOVERY_REQUIRED" });
    assert.equal(fs.readFileSync(store.path, "utf8"), "not json");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("restores a validated last-good backup without losing the corrupt original", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fnos-state-backup-"));
  const store = stateStoreModule.create({ fs, path, os: { homedir: () => fixture } });
  try {
    const initial = stateStoreModule.defaults();
    initial.assetMeta.keep = { favorite: true };
    initial.pluginFolders.push({ id: "folder", name: "Keep", parentId: "", assetKeys: ["keep"] });
    store.save(initial);
    store.mutate((state) => { state.assetMeta.later = { label: "blue" }; });
    assert.equal(JSON.parse(fs.readFileSync(store.backupPath, "utf8")).assetMeta.later, undefined, "backup must precede mutation");
    fs.writeFileSync(store.path, "{truncated primary");
    assert.deepEqual(store.load().assetMeta, initial.assetMeta);
    assert.equal(store.getStatus().recovered, true);
    const recovered = store.mutate((state) => { state.assetMeta.next = { label: "green" }; });
    assert.equal(recovered.pluginFolders[0].assetKeys[0], "keep");
    assert.equal(recovered.assetMeta.keep.favorite, true);
    const preserved = fs.readdirSync(path.dirname(store.path)).filter((name) => name.startsWith("state.json.corrupt-"));
    assert.equal(preserved.length, 1);
    assert.equal(fs.readFileSync(path.join(path.dirname(store.path), preserved[0]), "utf8"), "{truncated primary");
    assert.equal(store.getStatus().writable, true);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test("rejects valid JSON with an invalid state schema and preserves both failed copies", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fnos-state-invalid-"));
  const store = stateStoreModule.create({ fs, path, os: { homedir: () => fixture } });
  try {
    store.save(stateStoreModule.defaults());
    fs.writeFileSync(store.path, "{}");
    fs.writeFileSync(store.backupPath, "[]");
    store.load();
    let called = false;
    assert.throws(() => store.mutate(() => { called = true; }), { code: "STATE_RECOVERY_REQUIRED" });
    assert.equal(called, false);
    assert.equal(fs.readFileSync(store.path, "utf8"), "{}");
    assert.equal(fs.readFileSync(store.backupPath, "utf8"), "[]");
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test("a failed atomic primary replacement leaves valid primary and backup and removes temporary files", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fnos-state-write-failure-"));
  const wrappedFs = Object.create(fs);
  const store = stateStoreModule.create({ fs: wrappedFs, path, os: { homedir: () => fixture } });
  try {
    const initial = stateStoreModule.defaults();
    initial.assetMeta.keep = { favorite: true };
    store.save(initial);
    wrappedFs.renameSync = (source, target) => {
      if (target === store.path) { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); }
      return fs.renameSync(source, target);
    };
    assert.throws(() => store.mutate((state) => { state.assetMeta.bad = { label: "blue" }; }), { code: "ENOSPC" });
    assert.deepEqual(store.load().assetMeta, initial.assetMeta);
    assert.deepEqual(JSON.parse(fs.readFileSync(store.backupPath, "utf8")).assetMeta, initial.assetMeta);
    assert.equal(fs.readdirSync(path.dirname(store.path)).some((name) => name.endsWith(".tmp")), false);
    assert.equal(fs.existsSync(store.lockPath), false);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test("serializes concurrent Premiere and After Effects style metadata writes", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fnos-state-concurrent-"));
  const store = stateStoreModule.create({ fs, path, os: { homedir: () => fixture } });
  const modulePath = path.resolve(__dirname, "../extension/js/state-store.js");
  const worker = [
    "const fs=require('node:fs'),path=require('node:path');",
    "const args=process.argv.slice(1),mod=require(args[0]);",
    "const store=mod.create({fs,path,os:{homedir:()=>args[1]}});",
    "for(let i=0;i<20;i+=1){store.mutate(s=>{s.assetMeta[args[2]+'-'+i]={favorite:true,label:args[2]};});}"
  ].join("");
  function run(prefix) {
    return new Promise((resolve, reject) => {
      childProcess.execFile(process.execPath, ["-e", worker, modulePath, fixture, prefix], { timeout: 15000 }, (error) => error ? reject(error) : resolve());
    });
  }
  try {
    store.save(stateStoreModule.defaults());
    await Promise.all([run("premiere"), run("aftereffects")]);
    const result = store.load();
    assert.equal(Object.keys(result.assetMeta).length, 40);
    assert.equal(result.assetMeta["premiere-19"].favorite, true);
    assert.equal(result.assetMeta["aftereffects-19"].label, "aftereffects");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
