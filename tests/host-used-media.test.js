const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const hostSource = fs.readFileSync(path.join(__dirname, "..", "extension", "jsx", "host.jsx"), "utf8");

function collection(items, countProperty) {
  const result = items.slice();
  result[countProperty] = result.length;
  return result;
}

function projectItem(mediaPath, offline) {
  return {
    getMediaPath: () => mediaPath,
    isOffline: () => offline === true
  };
}

function clip(item) {
  return { projectItem: item };
}

function track(items) {
  return { clips: collection(items, "numItems") };
}

function sequence(name, videoTracks, audioTracks) {
  return {
    name,
    videoTracks: collection(videoTracks, "numTracks"),
    audioTracks: collection(audioTracks, "numTracks")
  };
}

function loadHost(sequences, withNativeJson, clock = Date) {
  function ExtendScriptFile(value) {
    this.fsName = String(value).replace(/\\/g, "/");
    this.name = path.basename(this.fsName);
    this.exists = true;
  }
  function ExtendScriptFolder() {}
  ExtendScriptFolder.fs = "Macintosh";
  const globalObject = {};
  const context = {
    $: { global: globalObject },
    app: {
      name: "Adobe Premiere Pro",
      project: {
        name: "第四版测试.prproj",
        rootItem: {},
        sequences: collection(sequences, "numSequences")
      }
    },
    BridgeTalk: { appName: "premierepro" },
    File: ExtendScriptFile,
    Folder: ExtendScriptFolder,
    JSON: withNativeJson ? JSON : undefined,
    isFinite,
    parseInt,
    Error,
    String,
    Number,
    Boolean,
    Math,
    RegExp,
    Array,
    Object
  };
  context.Date = clock;
  vm.createContext(context);
  vm.runInContext(hostSource, context, { filename: "host.jsx" });
  return context.$.global.SeekBridge;
}

test("Premiere host API returns only deduplicated timeline-used media inside configured roots", () => {
  const root = "/Volumes/团队素材";
  const nestedRoot = root + "/当前项目";
  const video = projectItem(nestedRoot + "/镜头/video.mov", false);
  const audio = projectItem(root + "/音乐/music.wav", true);
  const outside = projectItem("/Users/editor/Desktop/not-authorized.mp4", false);
  const nestedSequence = projectItem("", false);
  const host = loadHost([
    sequence("主时间线", [track([clip(video), clip(outside), clip(nestedSequence)])], [track([clip(video), clip(audio)])]),
    sequence("短版", [track([clip(video)])], [])
  ], false);
  const result = JSON.parse(host.listUsedPremiereMedia(JSON.stringify({
    roots: [
      { id: "all", path: root, label: "团队素材" },
      { id: "project", path: nestedRoot, label: "当前项目" }
    ]
  })));

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.sequencesScanned, 2);
  assert.equal(result.trackItemsScanned, 6);
  assert.equal(result.mediaCount, 2);
  assert.equal(result.offlineCount, 1);
  assert.equal(result.outOfScopeClipCount, 1);
  assert.equal(result.noMediaPathClipCount, 1);

  const videoResult = result.media.find((item) => item.path.endsWith("video.mov"));
  const audioResult = result.media.find((item) => item.path.endsWith("music.wav"));
  assert.equal(videoResult.rootId, "project", "the longest matching configured root should win");
  assert.equal(videoResult.clipCount, 3);
  assert.equal(videoResult.videoUses, 2);
  assert.equal(videoResult.audioUses, 1);
  assert.deepEqual(videoResult.sequences, ["主时间线", "短版"]);
  assert.equal(videoResult.offline, false);
  assert.equal(audioResult.rootId, "all");
  assert.equal(audioResult.offline, true);
});

test("host API rejects empty roots and remains compatible with native JSON", () => {
  const host = loadHost([], true);
  const result = JSON.parse(host.listUsedPremiereMedia('{"roots":[]}'));
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_ROOTS");
});

test("host API opts in plugin-generated screenshots outside configured media roots", () => {
  const screenshot = projectItem("/Users/editor/Pictures/LK‘s File Bridge Captures/镜头_Screenshot_20260906-1432.png", false);
  const host = loadHost([
    sequence("截图测试", [track([clip(screenshot)])], [])
  ], false);
  const result = JSON.parse(host.listUsedPremiereMedia(JSON.stringify({
    roots: [{ id: "media", path: "/Volumes/团队素材", label: "团队素材" }],
    captureRoots: [{ id: "capture", path: "/Users/editor/Pictures/LK‘s File Bridge Captures", label: "Plugin screenshots" }]
  })));

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.mediaCount, 1);
  assert.equal(result.media[0].pluginGenerated, true);
  assert.equal(result.media[0].sourceKind, "screenshot");
  assert.equal(result.media[0].rootId, "capture");
});

test("large Premiere inventory stops at the host time budget without returning a partial success", () => {
  let now = 0;
  function Clock() { this.getTime = () => { now += 2600; return now; }; }
  const host = loadHost([
    sequence("timeout", [track([clip(projectItem("/Volumes/media/a.mov", false))])], [])
  ], true, Clock);
  const result = JSON.parse(host.listUsedPremiereMedia('{"roots":[{"path":"/Volumes/media"}]}'));
  assert.equal(result.ok, false);
  assert.equal(result.code, "PROJECT_SCAN_TIMEOUT");
  assert.equal(result.media, undefined);
});
