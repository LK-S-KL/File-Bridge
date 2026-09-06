const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packagerModule = require("../extension/js/project-packager.js");

function makeFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-package-"));
  const rootA = path.join(fixture, "团队素材 A");
  const rootB = path.join(fixture, "团队素材 B");
  fs.mkdirSync(path.join(rootA, "项目", "镜头"), { recursive: true });
  fs.mkdirSync(rootB, { recursive: true });
  fs.writeFileSync(path.join(rootA, "项目", "镜头", "used.mp4"), Buffer.alloc(256 * 1024, 7));
  fs.writeFileSync(path.join(rootA, "项目", "unused.mp4"), "must never be copied");
  fs.writeFileSync(path.join(rootB, "music.wav"), Buffer.alloc(128 * 1024, 11));
  return { fixture, rootA, rootB };
}

function createPackager() {
  return packagerModule.create({
    fs,
    path,
    platform: process.platform,
    now: () => new Date("2026-09-06T10:00:00.000Z")
  });
}

test("prepares only listed, in-scope, existing regular files", async () => {
  const item = makeFixture();
  const outside = path.join(item.fixture, "outside.mov");
  const missing = path.join(item.rootA, "项目", "offline.mov");
  fs.writeFileSync(outside, "outside");
  try {
    const used = path.join(item.rootA, "项目", "镜头", "used.mp4");
    const plan = await createPackager().prepare({
      flatten: false,
      roots: [
        { id: "a", path: item.rootA, label: "团队素材 A" },
        { id: "b", path: item.rootB, label: "团队素材 B" }
      ],
      media: [
        { path: used, rootId: "a", clipCount: 2, sequences: ["主时间线"] },
        { path: used, rootId: "a", clipCount: 2, sequences: ["主时间线"] },
        { path: missing, rootId: "a", offline: true },
        { path: outside, rootId: "a" }
      ]
    });
    assert.equal(plan.files.length, 1);
    assert.equal(plan.files[0].sourcePath, used);
    assert.equal(plan.files[0].destinationRelativePath, path.join("Media", "01-团队素材 A", "项目", "镜头", "used.mp4"));
    assert.equal(plan.offline.length, 1);
    assert.equal(plan.offline[0].reason, "SOURCE_UNAVAILABLE");
    assert.ok(plan.skipped.some((entry) => entry.path === outside && entry.reason === "OUT_OF_SCOPE"));
    assert.equal(plan.duplicatesRemoved, 1);
  } finally {
    fs.rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("packages used timeline media with byte progress and a deterministic manifest", async () => {
  const item = makeFixture();
  const destination = path.join(item.fixture, "交付包");
  const progress = [];
  try {
    const video = path.join(item.rootA, "项目", "镜头", "used.mp4");
    const audio = path.join(item.rootB, "music.wav");
    const result = await createPackager().packageProject({
      flatten: false,
      destination,
      roots: [
        { id: "a", path: item.rootA, label: "团队素材 A" },
        { id: "b", path: item.rootB, label: "团队素材 B" }
      ],
      media: [
        { path: video, rootId: "a", clipCount: 2, videoUses: 1, audioUses: 1, sequences: ["主时间线"] },
        { path: audio, rootId: "b", clipCount: 1, audioUses: 1, sequences: ["主时间线"] },
        { path: video, rootId: "a", clipCount: 2 }
      ],
      project: { projectName: "内测工程.prproj", sequencesScanned: 2, trackItemsScanned: 3 },
      onProgress: (event) => progress.push({ ...event })
    });

    const packagedVideo = path.join(destination, "Media", "01-团队素材 A", "项目", "镜头", "used.mp4");
    const packagedAudio = path.join(destination, "Media", "02-团队素材 B", "music.wav");
    const unrelated = path.join(destination, "Media", "01-团队素材 A", "项目", "unused.mp4");
    assert.equal(result.ok, true);
    assert.equal(result.copied.length, 2);
    assert.deepEqual(fs.readFileSync(packagedVideo), fs.readFileSync(video));
    assert.deepEqual(fs.readFileSync(packagedAudio), fs.readFileSync(audio));
    assert.equal(fs.existsSync(unrelated), false, "unlisted project-root files must never be copied");

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
    assert.equal(manifest.generatedAt, "2026-09-06T10:00:00.000Z");
    assert.equal(manifest.project.name, "内测工程.prproj");
    assert.equal(manifest.summary.listedByPremiere, 3);
    assert.equal(manifest.summary.copied, 2);
    assert.equal(manifest.summary.duplicatesRemoved, 1);
    assert.deepEqual(manifest.media.map((entry) => entry.sourcePath).sort(), [audio, video].sort());
    assert.ok(progress.some((entry) => entry.phase === "copy" && entry.bytesCompleted > 0));
    assert.equal(progress.at(-1).phase, "complete");
    assert.equal(progress.at(-1).percent, 1);
  } finally {
    fs.rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("uses a flat destination by default and disambiguates duplicate basenames", async () => {
  const item = makeFixture();
  const duplicate = path.join(item.rootB, "used.mp4");
  const destination = path.join(item.fixture, "扁平交付包");
  fs.writeFileSync(duplicate, Buffer.alloc(64, 19));
  try {
    const result = await createPackager().packageProject({
      destination,
      roots: [
        { id: "a", path: item.rootA, label: "团队素材 A" },
        { id: "b", path: item.rootB, label: "团队素材 B" }
      ],
      media: [
        { path: path.join(item.rootA, "项目", "镜头", "used.mp4"), rootId: "a" },
        { path: duplicate, rootId: "b" }
      ]
    });
    assert.equal(result.complete, true);
    assert.equal(fs.existsSync(path.join(destination, "used.mp4")), true);
    assert.equal(fs.existsSync(path.join(destination, "used-2.mp4")), true);
    assert.deepEqual(result.copied.map((entry) => entry.packagedPath).sort(), ["used-2.mp4", "used.mp4"]);
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
    assert.equal(manifest.layout, "flat");
    assert.ok(manifest.roots.every((root) => root.packageFolder === ""));
  } finally {
    fs.rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("does not collide on case-only names on macOS", () => {
  const seen = {};
  assert.equal(packagerModule.flatName(path, "/素材/A.MP4", seen, "darwin"), "A.MP4");
  assert.equal(packagerModule.flatName(path, "/素材/a.mp4", seen, "darwin"), "a-2.mp4");
});

test("reserves the package manifest filename when flattening", () => {
  const seen = {};
  assert.equal(packagerModule.flatName(path, "/素材/LK-File-Bridge-package.json", seen, "darwin"), "LK-File-Bridge-package-2.json");
});

test("includes an explicitly reported plugin screenshot root without scanning it", async () => {
  const item = makeFixture();
  const captureRoot = path.join(item.fixture, "Screenshots");
  const screenshot = path.join(captureRoot, "镜头_Screenshot_20260906-1432.png");
  const destination = path.join(item.fixture, "截图交付包");
  fs.mkdirSync(captureRoot);
  fs.writeFileSync(screenshot, "png fixture", "utf8");
  fs.writeFileSync(path.join(captureRoot, "unused.png"), "must not copy", "utf8");
  try {
    const result = await createPackager().packageProject({
      destination,
      roots: [{ id: "a", path: item.rootA, label: "团队素材 A" }],
      media: [{ path: screenshot, rootId: "capture", rootPath: captureRoot, rootLabel: "Plugin screenshots", pluginGenerated: true, sourceKind: "screenshot" }]
    });
    assert.equal(result.complete, true);
    assert.equal(fs.readFileSync(path.join(destination, path.basename(screenshot)), "utf8"), "png fixture");
    assert.equal(fs.existsSync(path.join(destination, "unused.png")), false);
    assert.equal(result.copied[0].pluginGenerated, true);
    assert.equal(result.copied[0].sourceKind, "screenshot");
  } finally {
    fs.rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("reports offline media without scanning or copying unrelated files", async () => {
  const item = makeFixture();
  const destination = path.join(item.fixture, "offline-package");
  try {
    const result = await createPackager().packageProject({
      destination,
      roots: [{ id: "a", path: item.rootA, label: "团队素材 A" }],
      media: [{ path: path.join(item.rootA, "missing.mp4"), rootId: "a", offline: true }],
      projectName: "Offline Test"
    });
    assert.equal(result.ok, false);
    assert.equal(result.complete, false);
    assert.equal(result.copied.length, 0);
    assert.equal(result.offline.length, 1);
    assert.equal(fs.existsSync(path.join(destination, "Media")), false);
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
    assert.equal(manifest.summary.offline, 1);
    assert.equal(manifest.summary.copied, 0);
  } finally {
    fs.rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("never overwrites a previous package manifest", async () => {
  const item = makeFixture();
  const destination = path.join(item.fixture, "existing-package");
  fs.mkdirSync(destination, { recursive: true });
  const manifestPath = path.join(destination, packagerModule.MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, "keep me", "utf8");
  try {
    await assert.rejects(createPackager().packageProject({
      destination,
      roots: [{ id: "a", path: item.rootA, label: "团队素材 A" }],
      media: [{ path: path.join(item.rootA, "项目", "镜头", "used.mp4"), rootId: "a" }]
    }), (error) => error && error.code === "PACKAGE_EXISTS");
    assert.equal(fs.readFileSync(manifestPath, "utf8"), "keep me");
    assert.equal(fs.existsSync(path.join(destination, "Media")), false);
  } finally {
    fs.rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("rejects cancellation before writing a package", async () => {
  const item = makeFixture();
  const destination = path.join(item.fixture, "cancelled-package");
  try {
    await assert.rejects(createPackager().packageProject({
      destination,
      roots: [{ id: "a", path: item.rootA }],
      media: [{ path: path.join(item.rootA, "项目", "镜头", "used.mp4"), rootId: "a" }],
      isCancelled: () => true
    }), (error) => error && error.code === "PACKAGING_CANCELLED");
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("does not follow a destination symlink outside the selected package folder", async (t) => {
  if (process.platform === "win32") { t.skip("symlink setup requires additional Windows privileges"); return; }
  const item = makeFixture();
  const destination = path.join(item.fixture, "symlink-package");
  const outsideDestination = path.join(item.fixture, "outside-destination");
  fs.mkdirSync(destination, { recursive: true });
  fs.mkdirSync(outsideDestination, { recursive: true });
  fs.symlinkSync(outsideDestination, path.join(destination, "Media"), "dir");
  try {
    const result = await createPackager().packageProject({
      flatten: false,
      destination,
      roots: [{ id: "a", path: item.rootA, label: "团队素材 A" }],
      media: [{ path: path.join(item.rootA, "项目", "镜头", "used.mp4"), rootId: "a" }]
    });
    assert.equal(result.ok, false);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].error.code, "DESTINATION_SYMLINK_ESCAPE");
    assert.deepEqual(fs.readdirSync(outsideDestination), []);
  } finally {
    fs.rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("removes a copied file when the source changes during packaging", async () => {
  const item = makeFixture();
  const destination = path.join(item.fixture, "changed-source-package");
  const source = path.join(item.rootA, "项目", "镜头", "used.mp4");
  const wrappedFs = Object.create(fs);
  wrappedFs.stat = function (value, callback) {
    fs.stat(value, function (error, sourceStat) {
      if (!error && value === source) {
        callback(null, { size: sourceStat.size + 1, mtimeMs: sourceStat.mtimeMs });
        return;
      }
      callback(error, sourceStat);
    });
  };
  try {
    const packager = packagerModule.create({ fs: wrappedFs, path, platform: process.platform });
    const result = await packager.packageProject({
      destination,
      roots: [{ id: "a", path: item.rootA, label: "团队素材 A" }],
      media: [{ path: source, rootId: "a" }]
    });
    const target = path.join(destination, "Media", "01-团队素材 A", "项目", "镜头", "used.mp4");
    assert.equal(result.ok, false);
    assert.equal(result.failed[0].error.code, "SOURCE_CHANGED");
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(item.fixture, { recursive: true, force: true });
  }
});
