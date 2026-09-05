const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const library = require("../extension/js/library.js");

test("recognizes supported media without case sensitivity", () => {
  assert.equal(library.typeOf("clip.MP4"), "video");
  assert.equal(library.typeOf("still.PSD"), "image");
  assert.equal(library.typeOf("voice.WAV"), "audio");
  assert.equal(library.typeOf("notes.txt"), null);
});

test("scans supported files recursively and ignores hidden content", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "seek-bridge-test-"));
  try {
    fs.mkdirSync(path.join(fixture, "视频"));
    fs.mkdirSync(path.join(fixture, ".hidden"));
    fs.writeFileSync(path.join(fixture, "视频", "测试 01.MP4"), "video");
    fs.writeFileSync(path.join(fixture, "封面图.png"), "image");
    fs.writeFileSync(path.join(fixture, "readme.txt"), "ignore");
    fs.writeFileSync(path.join(fixture, ".hidden", "secret.mov"), "ignore");

    const result = library.scanLibrary(fixture, { fs, path }, { maxFiles: 20, maxDepth: 4 });
    assert.equal(result.offline, false);
    assert.equal(result.assets.length, 2);
    assert.deepEqual(result.assets.map((asset) => asset.name).sort(), ["封面图.png", "测试 01.MP4"].sort());
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("searches file names and relative folders", () => {
  const asset = {
    name: "采访_A机位.mp4",
    relativePath: "发布会/采访_A机位.mp4",
    type: "video"
  };
  assert.equal(library.matches(asset, "采访", "all"), true);
  assert.equal(library.matches(asset, "发布会", "video"), true);
  assert.equal(library.matches(asset, "发布会", "image"), false);
  assert.equal(library.matches(asset, "不存在", "all"), false);
});

test("encodes local file URLs and formats sizes", () => {
  const url = library.fileUrl("/Volumes/团队 文件/镜头#1.png");
  assert.equal(url, "file:///Volumes/%E5%9B%A2%E9%98%9F%20%E6%96%87%E4%BB%B6/%E9%95%9C%E5%A4%B4%231.png");
  assert.equal(library.formatBytes(1536), "1.5 KB");
});

test("reports an unavailable root without throwing", () => {
  const result = library.scanLibrary("/definitely/not/a/seek/path", { fs, path });
  assert.equal(result.offline, true);
  assert.deepEqual(result.assets, []);
});
