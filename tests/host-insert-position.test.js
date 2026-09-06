const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const hostSource = fs.readFileSync(path.join(__dirname, "..", "extension", "jsx", "host.jsx"), "utf8");

function loadHost(options = {}) {
  const inserted = [];
  const mediaItem = { name: "clip.mp4", getMediaPath: () => "/tmp/clip.mp4" };
  function Time() { this.ticks = "0"; }
  function File(value) { this.fsName = String(value); this.name = path.basename(this.fsName); this.exists = true; }
  function Folder() {}
  Folder.fs = "Macintosh";
  const sequence = {
    end: "900",
    videoTracks: { numTracks: 1, 0: {} },
    audioTracks: { numTracks: 1, 0: {} },
    getPlayerPosition: () => ({ ticks: "100" }),
    insertClip: (_item, time) => { inserted.push(String(time.ticks)); return true; }
  };
  const rootItem = {
    children: { numItems: 0 },
    findItemsMatchingMediaPath: () => options.matches === undefined ? [mediaItem] : options.matches,
    ...options.rootItem
  };
  const context = {
    $: { global: {} },
    app: { name: "Adobe Premiere Pro", project: { rootItem, activeSequence: sequence, sequences: { numSequences: 0 } } },
    BridgeTalk: { appName: "premierepro" }, File, Folder, Time, JSON, isFinite, parseInt, Error, String, Number, Boolean, Math, RegExp, Array, Object
  };
  vm.createContext(context);
  vm.runInContext(hostSource, context, { filename: "host.jsx" });
  return { host: context.$.global.SeekBridge, inserted, sequence, rootItem };
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
      return imported ? [mediaItem] : [];
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
  const mediaItem = { name: "clip.mp4", getMediaPath: () => "/tmp/clip.mp4", setColorLabel: (value) => { labels.push(value); return 0; } };
  function File(value) { this.fsName = String(value); this.name = path.basename(this.fsName); this.exists = true; }
  function Folder() {}
  Folder.fs = "Macintosh";
  const rootItem = { children: { numItems: 0 }, findItemsMatchingMediaPath: () => [mediaItem] };
  const context = { $: { global: {} }, app: { name: "Adobe Premiere Pro", project: { rootItem, sequences: { numSequences: 0 } } }, BridgeTalk: { appName: "premierepro" }, File, Folder, JSON, isFinite, parseInt, Error, String, Number, Boolean, Math, RegExp, Array, Object };
  vm.createContext(context); vm.runInContext(hostSource, context, { filename: "host.jsx" });
  const result = JSON.parse(context.$.global.SeekBridge.importMedia(JSON.stringify({ path: "/tmp/clip.mp4", colorLabel: "rose" })));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(labels, [6]);
  assert.equal(result.labelApplied, true);
});

test("Premiere path fast lookup accepts real arrays without traversing the project", () => {
  const { host, rootItem } = loadHost();
  Object.defineProperty(rootItem, "children", { get() { throw new Error("slow traversal reached"); } });
  const result = JSON.parse(host.importMedia('{"path":"/tmp/clip.mp4"}'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.imported, false);
});

test("Premiere path lookup accepts 0, empty arrays, and legacy collections", () => {
  const mediaItem = { name: "clip.mp4", getMediaPath: () => "/tmp/clip.mp4" };
  for (const matches of [0, [], { numItems: 1, 0: mediaItem }]) {
    const { host } = loadHost({ matches, rootItem: { children: { numItems: 1, 0: mediaItem } } });
    const result = JSON.parse(host.importMedia('{"path":"/tmp/clip.mp4"}'));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.imported, false);
  }
});

test("Premiere uses unlocked targeted tracks instead of V1/A1", () => {
  const { host, sequence } = loadHost();
  sequence.videoTracks = { numTracks: 2, 0: { isLocked: () => true }, 1: { isLocked: () => false, isTargeted: () => true } };
  sequence.audioTracks = { numTracks: 3, 0: {}, 1: {}, 2: { isTargeted: () => true } };
  const calls = [];
  sequence.insertClip = (_item, _time, video, audio) => { calls.push([video, audio]); return true; };
  const result = JSON.parse(host.importMediaToSequence('{"path":"/tmp/clip.mp4"}'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(calls, [[1, 2]]);
});

test("Premiere refuses locked targets before importing or writing labels", () => {
  const { host, sequence, rootItem } = loadHost();
  rootItem.findItemsMatchingMediaPath = () => { throw new Error("lookup must not run"); };
  sequence.videoTracks = { numTracks: 2, 0: { isLocked: () => true, isTargeted: () => true }, 1: {} };
  const result = JSON.parse(host.importMediaToSequence('{"path":"/tmp/clip.mp4"}'));
  assert.equal(result.ok, false);
  assert.equal(result.code, "TARGET_TRACK_LOCKED");
});

test("Premiere inserts audio and still images only on their corresponding usable track", () => {
  for (const [filename, kind] of [["sound.wav", "audio"], ["still.png", "video"]]) {
    const { host, sequence } = loadHost();
    const calls = [];
    const track = { insertClip: (...args) => calls.push(args) };
    sequence.videoTracks = { numTracks: kind === "video" ? 1 : 0, 0: track };
    sequence.audioTracks = { numTracks: kind === "audio" ? 1 : 0, 0: track };
    const result = JSON.parse(host.importMediaToSequence(JSON.stringify({ path: "/tmp/" + filename })));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(calls[0].slice(2), kind === "audio" ? [-1, 0] : [0, -1]);
  }
});
