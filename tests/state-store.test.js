const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
      preferences: { sortBy: "size", sortDirection: "asc", zoom: 2 }
    });
    const loaded = store.load();
    assert.equal(loaded.roots.length, 2);
    assert.equal(loaded.assetMeta["/Volumes/素材一/a.mp4"].favorite, true);
    assert.equal(loaded.preferences.sortBy, "size");
    assert.equal(loaded.preferences.zoom, 2);
    assert.equal(fs.statSync(store.path).mode & 0o777, 0o600);
    const leftovers = fs.readdirSync(path.dirname(store.path)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
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
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
