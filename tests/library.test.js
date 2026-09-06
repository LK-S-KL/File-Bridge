const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const childProcess = require("node:child_process");
const EventEmitter = require("node:events");

const library = require("../extension/js/library.js");

test("recognizes supported media without case sensitivity", () => {
  assert.equal(library.typeOf("clip.MP4"), "video");
  assert.equal(library.typeOf("still.PSD"), "image");
  assert.equal(library.typeOf("voice.WAV"), "audio");
  assert.equal(library.typeOf("cinematic.CUBE"), "lut");
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

test("cooperative scan keeps every supported file across small batches", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fnos-library-async-"));
  try {
    fs.mkdirSync(path.join(fixture, "A", "nested"), { recursive: true });
    fs.mkdirSync(path.join(fixture, "B"), { recursive: true });

    const expected = [
      "root-01.mp4",
      "root-02.mov",
      "root-03.wav",
      "root-04.png",
      "root-05.cube",
      path.join("A", "a-01.mp4"),
      path.join("A", "a-02.jpg"),
      path.join("A", "nested", "n-01.aiff"),
      path.join("A", "nested", "n-02.CUBE"),
      path.join("B", "b-01.webm"),
      path.join("B", "b-02.psd")
    ];
    expected.forEach((relativePath) => {
      fs.writeFileSync(path.join(fixture, relativePath), relativePath, "utf8");
    });
    fs.writeFileSync(path.join(fixture, "ignored.txt"), "ignore", "utf8");
    fs.writeFileSync(path.join(fixture, ".hidden.mp4"), "ignore", "utf8");

    const progress = [];
    const result = await library.scanLibraryAsync(
      fixture,
      { fs, path },
      { maxFiles: 100, maxDepth: 5, batchSize: 2 },
      (snapshot) => progress.push(snapshot)
    );

    assert.equal(result.offline, false);
    assert.equal(result.truncated, false);
    assert.equal(result.assets.length, expected.length);
    assert.deepEqual(
      result.assets.map((asset) => asset.relativePath).sort(),
      expected.slice().sort()
    );
    assert.ok(progress.length >= 2, "small batches should yield observable progress");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("cooperative scan reports an unavailable root as offline", async () => {
  const missing = path.join(os.tmpdir(), "fnos-missing-" + Date.now(), "not-mounted");
  const result = await library.scanLibraryAsync(missing, { fs, path }, { batchSize: 1 });
  assert.equal(result.offline, true);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.assets, []);
  assert.deepEqual(result.warnings, []);
});

test("cooperative scan can be cancelled before starting another SMB directory", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fnos-library-cancel-"));
  const signal = { cancelled: false };
  try {
    fs.mkdirSync(path.join(fixture, "A"));
    fs.mkdirSync(path.join(fixture, "B"));
    fs.writeFileSync(path.join(fixture, "A", "a.mp4"), "a");
    fs.writeFileSync(path.join(fixture, "B", "b.mp4"), "b");
    const result = await library.scanLibraryAsync(fixture, { fs, path }, { batchSize: 1, cancelSignal: signal }, () => { signal.cancelled = true; });
    assert.equal(result.cancelled, true);
    assert.equal(result.offline, false);
    assert.equal(result.assets.length, 0);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("cooperative scan can include folders without losing recursive media", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-library-folders-"));
  try {
    fs.mkdirSync(path.join(fixture, "素材夹", "子目录"), { recursive: true });
    fs.writeFileSync(path.join(fixture, "素材夹", "子目录", "clip.mp4"), "video");
    const result = await library.scanLibraryAsync(fixture, { fs, path }, { includeDirectories: true, batchSize: 1 });
    assert.equal(result.assets.filter((asset) => asset.type === "folder").length, 2);
    assert.equal(result.assets.some((asset) => asset.name === "clip.mp4"), true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("hung directory reads time out and ignore late callbacks", async () => {
  let callback;
  const fakeFs = {
    stat: (file, done) => done(null, { isDirectory: () => true }),
    readdir: (file, options, done) => { callback = done; }
  };
  const result = await library.scanLibraryAsync("/hung", { fs: fakeFs, path }, { operationTimeoutMs: 25 });
  assert.equal(result.offline, true);
  assert.match(result.warnings[0], /SCAN_TIMEOUT/);
  callback(null, [{ name: "late.mp4", isFile: () => true, isDirectory: () => false }]);
  assert.deepEqual(result.assets, []);
});

test("cancellation settles while filesystem callback never fires", async () => {
  const signal = { cancelled: false };
  const request = library.scanLibraryAsync("/hung", { fs: { stat() {} }, path }, { cancelSignal: signal, cancelPollMs: 5, operationTimeoutMs: 1000 });
  setTimeout(() => { signal.cancelled = true; }, 10);
  const result = await request;
  assert.equal(result.cancelled, true);
  assert.equal(result.offline, false);
});

test("EIO and ESTALE mark a scan offline and a healthy root can still finish", async () => {
  for (const code of ["EIO", "ESTALE"]) {
    const fakeFs = {
      stat: (file, done) => done(null, { isDirectory: () => true }),
      readdir: (file, options, done) => done(Object.assign(new Error(code), { code }))
    };
    const result = await library.scanLibraryAsync("/offline", { fs: fakeFs, path });
    assert.equal(result.offline, true);
  }
  const healthy = await library.scanLibraryAsync(os.tmpdir(), { fs, path }, { maxDepth: 0, maxFiles: 2 });
  assert.equal(healthy.offline, false);
});

test("isolated scan preserves Unicode paths and flattens files while skipping symlinks", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-isolated-scan-"));
  try {
    fs.mkdirSync(path.join(fixture, "素材"));
    fs.writeFileSync(path.join(fixture, "素材", "风景.mp4"), "media");
    fs.symlinkSync(path.join(fixture, "素材"), path.join(fixture, "shortcut"));
    const result = await library.scanLibraryAsync(fixture, { fs, path, childProcess, scanWorkerPath: path.resolve(__dirname, "../extension/js/scan-worker.pl") }, { includeDirectories: false });
    assert.equal(result.offline, false);
    assert.deepEqual(result.assets.map(asset => asset.relativePath), ["素材/风景.mp4"]);
    assert.equal(result.assets[0].path, path.join(fixture, "素材", "风景.mp4"));
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test("isolated hung worker gets TERM then KILL and scan settles on deadline", async () => {
  const signals = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter(); child.kill = signal => signals.push(signal);
  const result = await library.scanLibraryAsync("/hung", { path, childProcess: { spawn: () => child }, scanWorkerPath: "/worker.pl" }, { operationTimeoutMs: 20 });
  assert.equal(result.offline, true);
  assert.deepEqual(signals, ["SIGTERM"]);
  await new Promise(resolve => setTimeout(resolve, 320));
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  child.stdout.emit("data", JSON.stringify({ type: "progress", assets: [{ name: "late.mp4" }] }) + "\n");
  assert.deepEqual(result.assets, []);
});
