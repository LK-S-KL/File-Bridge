const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const hostSource = fs.readFileSync(path.join(__dirname, "..", "extension", "jsx", "host.jsx"), "utf8");

function loadHost() {
  const inserted = [];
  const mediaItem = { name: "clip.mp4", getMediaPath: () => "/tmp/clip.mp4" };
  function Time() { this.ticks = "0"; }
  function File(value) { this.fsName = String(value); this.name = path.basename(this.fsName); this.exists = true; }
  function Folder() {}
  Folder.fs = "Macintosh";
  const sequence = {
    end: "900",
    videoTracks: { numTracks: 1 },
    audioTracks: { numTracks: 1 },
    getPlayerPosition: () => ({ ticks: "100" }),
    insertClip: (_item, time) => { inserted.push(String(time.ticks)); return true; }
  };
  const rootItem = {
    children: { numItems: 0 },
    findItemsMatchingMediaPath: () => Object.assign([mediaItem], { numItems: 1 })
  };
  const context = {
    $: { global: {} },
    app: { name: "Adobe Premiere Pro", project: { rootItem, activeSequence: sequence, sequences: { numSequences: 0 } } },
    BridgeTalk: { appName: "premierepro" }, File, Folder, Time, JSON, isFinite, parseInt, Error, String, Number, Boolean, Math, RegExp, Array, Object
  };
  vm.createContext(context);
  vm.runInContext(hostSource, context, { filename: "host.jsx" });
  return { host: context.$.global.SeekBridge, inserted };
}

test("Premiere insertion supports current time, first frame, and sequence tail", () => {
  const { host, inserted } = loadHost();
  for (const position of ["current", "start", "end"]) {
    const result = JSON.parse(host.importMediaToSequence(JSON.stringify({ path: "/tmp/clip.mp4", position })));
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  assert.deepEqual(inserted, ["100", "0", "900"]);
});

test("Premiere imports plugin screenshots directly into the project root", () => {
  const importedInto = [];
  const mediaItem = { name: "镜头_Screenshot_20260906-1432.png", getMediaPath: () => "/tmp/镜头_Screenshot_20260906-1432.png" };
  let imported = false;
  function File(value) { this.fsName = String(value); this.name = path.basename(this.fsName); this.exists = true; }
  function Folder() {}
  Folder.fs = "Macintosh";
  const rootItem = {
    children: { numItems: 0 },
    findItemsMatchingMediaPath: () => {
      const result = imported ? [mediaItem] : [];
      result.numItems = result.length;
      return result;
    }
  };
  const context = {
    $: { global: {} },
    app: {
      name: "Adobe Premiere Pro",
      project: {
        rootItem,
        importFiles: (_paths, _suppressUI, destination) => { importedInto.push(destination); imported = true; return true; },
        sequences: { numSequences: 0 }
      }
    },
    BridgeTalk: { appName: "premierepro" }, File, Folder, JSON, isFinite, parseInt, Error, String, Number, Boolean, Math, RegExp, Array, Object
  };
  vm.createContext(context);
  vm.runInContext(hostSource, context, { filename: "host.jsx" });
  const result = JSON.parse(context.$.global.SeekBridge.importMedia(JSON.stringify({ path: "/tmp/镜头_Screenshot_20260906-1432.png" })));

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(importedInto[0], rootItem);
});

test("Premiere LUT application reports an empty video selection without touching the project", () => {
  function File(value) { this.fsName = String(value); this.name = path.basename(this.fsName); this.exists = true; }
  function Folder() {}
  Folder.fs = "Macintosh";
  const sequence = {
    videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: { isSelected: () => false } } } },
    audioTracks: { numTracks: 0 }
  };
  const context = {
    $: { global: {} },
    app: { name: "Adobe Premiere Pro", project: { rootItem: {}, activeSequence: sequence, sequences: { numSequences: 0 } } },
    BridgeTalk: { appName: "premierepro" }, File, Folder, JSON, isFinite, parseInt, Error, String, Number, Boolean, Math, RegExp, Array, Object
  };
  vm.createContext(context);
  vm.runInContext(hostSource, context, { filename: "host.jsx" });
  assert.equal(JSON.parse(context.$.global.SeekBridge.getSelectedVideoCount()).count, 0);
  const result = JSON.parse(context.$.global.SeekBridge.applyLutToActiveVideo(JSON.stringify({ path: "/tmp/look.cube" })));
  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_SELECTED_VIDEO");
});

test("Premiere import carries the plugin label index to the project item", () => {
  const labels = [];
  const mediaItem = { name: "clip.mp4", getMediaPath: () => "/tmp/clip.mp4", setColorLabel: (value) => labels.push(value) };
  function File(value) { this.fsName = String(value); this.name = path.basename(this.fsName); this.exists = true; }
  function Folder() {}
  Folder.fs = "Macintosh";
  const rootItem = { children: { numItems: 0 }, findItemsMatchingMediaPath: () => Object.assign([mediaItem], { numItems: 1 }) };
  const context = { $: { global: {} }, app: { name: "Adobe Premiere Pro", project: { rootItem, sequences: { numSequences: 0 } } }, BridgeTalk: { appName: "premierepro" }, File, Folder, JSON, isFinite, parseInt, Error, String, Number, Boolean, Math, RegExp, Array, Object };
  vm.createContext(context); vm.runInContext(hostSource, context, { filename: "host.jsx" });
  const result = JSON.parse(context.$.global.SeekBridge.importMedia(JSON.stringify({ path: "/tmp/clip.mp4", colorLabel: "rose" })));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(labels, [6]);
});
