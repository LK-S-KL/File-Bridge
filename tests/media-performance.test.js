const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const test = require("node:test");
const media = require("../extension/js/media-tools.js");
const worker = path.resolve(__dirname, "../extension/js/media-worker.pl");
const png = Buffer.from("89504e470d0a1a0a0000000049454e44ae426082", "hex");

function fixture(options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-performance-test-"));
  const cacheRoot = path.join(home, "Library", "Caches", "com.fnnas.fnosbridge.mvp");
  const source = path.join(home, "source.mov");
  fs.writeFileSync(source, "synthetic source");
  const runtime = { fs, path, os: { homedir: () => home }, crypto, childProcess, sourceValidationDelayMs: 60000,
    cacheSettings: { minimumFreeBytes: 0 }, ...options };
  const service = media.create(runtime);
  return { home, source, cacheRoot, service, runtime, cleanup() { fs.rmSync(home, { recursive: true, force: true }); } };
}
function seedAsset(f, overrides = {}) {
  const stat = fs.statSync(f.source);
  const id = crypto.createHash("sha1").update(path.resolve(f.source)).digest("hex");
  const image = path.join(f.cacheRoot, "posters", id + "-v4.png");
  fs.writeFileSync(image, png);
  const record = { version: 1, source: f.source, signature: stat.size + ":" + stat.mtimeMs,
    artifacts: { poster: { path: path.relative(f.cacheRoot, image) }, metadata: { metadata: { duration: 20, width: 1920 } } }, ...overrides };
  fs.writeFileSync(path.join(f.cacheRoot, "assets-v1", id + ".json"), JSON.stringify(record));
  return { image, record, index: path.join(f.cacheRoot, "assets-v1", id + ".json") };
}
function runWorker(home, output, trace, delay = .08, settings = {}) {
  const temporary = output + "." + crypto.randomBytes(6).toString("hex") + ".part";
  const code = 'my ($out,$trace,$delay)=@ARGV; open(my $log, ">>", $trace) or die $!; print $log "begin $$\\n"; close $log; select undef,undef,undef,$delay; open(my $f, ">", $out) or die $!; print $f "generated"; close $f; open($log, ">>", $trace) or die $!; print $log "end $$\\n"; close $log;';
  let child;
  const done = new Promise((resolve, reject) => {
    child = childProcess.execFile("/usr/bin/perl", [worker, path.join(home, "heavy.lock"), "/usr/bin/perl", temporary, output, String(settings.workerLimit || 10000), "1", settings.workerConfig ? JSON.stringify(settings.workerConfig) : "", "-e", code, temporary, trace, String(delay)], { detached: true, timeout: 3000, ...settings }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
  });
  return { child, done, temporary };
}
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) { throw new Error("TEST_WAIT_TIMEOUT"); } await new Promise(resolve => setTimeout(resolve, 5)); }
}

test("warm poster and metadata do not stat the source or resolve media binaries, including after a restart", async () => {
  let source, sourceReads = 0, resolverCalls = 0;
  const wrapped = Object.assign({}, fs, {
    stat(file, done) { if (file === source) { sourceReads++; } fs.stat(file, done); },
    statSync(file) { if (file === source) { sourceReads++; } return fs.statSync(file); }
  });
  const f = fixture({ fs: wrapped, resolveMediaTools() { resolverCalls++; throw new Error("OFFLINE_BINARIES"); } }); source = f.source;
  try {
    const seeded = seedAsset(f);
    await f.service.pruneCache();
    fs.unlinkSync(source);
    assert.equal((await f.service.cachedPreviewFor(source, "poster")).path, seeded.image);
    assert.equal(await f.service.posterFor(source), seeded.image);
    assert.equal((await f.service.metadataFor(source)).duration, 20);
    const restarted = media.create(f.runtime);
    assert.equal(await restarted.posterFor(source), seeded.image);
    assert.equal(sourceReads, 0);
    assert.equal(resolverCalls, 0);
  } finally { f.cleanup(); }
});

test("malformed indexes, path escapes, missing files and invalid image headers are cache misses", async () => {
  const f = fixture();
  try {
    const seeded = seedAsset(f);
    for (const content of ["{broken", JSON.stringify({ ...seeded.record, source: "/another/source" }),
      JSON.stringify({ ...seeded.record, artifacts: { poster: { path: "../source.mov" } } }),
      JSON.stringify({ ...seeded.record, artifacts: { poster: { path: "posters/missing.png" } } })]) {
      fs.writeFileSync(seeded.index, content);
      assert.equal(await media.create(f.runtime).cachedPreviewFor(f.source, "poster"), null);
    }
    fs.writeFileSync(seeded.index, JSON.stringify(seeded.record));
    fs.writeFileSync(seeded.image, "broken image");
    assert.equal(await media.create(f.runtime).cachedPreviewFor(f.source, "poster"), null);
  } finally { f.cleanup(); }
});

test("source validation invalidates every old-version artifact together", async () => {
  const f = fixture();
  try {
    seedAsset(f);
    assert.ok(await f.service.cachedPreviewFor(f.source, "poster"));
    fs.appendFileSync(f.source, " changed");
    await f.service.validateCachedAsset(f.source);
    assert.equal(await f.service.cachedPreviewFor(f.source, "poster"), null);
    assert.equal(await f.service.cachedPreviewFor(f.source, "metadata"), null);
    assert.equal(await media.create(f.runtime).cachedPreviewFor(f.source, "poster"), null);
  } finally { f.cleanup(); }
});

test("offline producers validate a warm source version before accepting the cached artifact", async () => {
  const f = fixture({ resolveMediaTools: () => { throw new Error("BINARIES_UNAVAILABLE"); } });
  try {
    seedAsset(f);
    fs.appendFileSync(f.source, " newer");
    await assert.rejects(f.service.posterFor(f.source, { purpose: "offline" }), { code: "MEDIA_TOOLS_UNAVAILABLE" });
    assert.equal(await f.service.cachedPreviewFor(f.source, "poster"), null);
  } finally { f.cleanup(); }
});

test("simultaneous instances merge different artifacts in the same persistent asset index", async () => {
  const f = fixture();
  try {
    const seeded = seedAsset(f);
    const metadata = { ...seeded.record, artifacts: { metadata: { metadata: { duration: 30 } } } };
    const sprite = { ...seeded.record, artifacts: { sprite: { path: "sprites/" + "c".repeat(40) + "-v5.jpg", sampleTimes: Array(12).fill(1) } } };
    function write(record, suffix) {
      return new Promise((resolve, reject) => childProcess.execFile("/usr/bin/perl", [worker, "--index", seeded.index, seeded.index + suffix, JSON.stringify(record)], error => error ? reject(error) : resolve()));
    }
    await Promise.all([write(metadata, ".first"), write(sprite, ".second")]);
    const merged = JSON.parse(fs.readFileSync(seeded.index, "utf8"));
    assert.deepEqual(Object.keys(merged.artifacts).sort(), ["metadata", "poster", "sprite"]);
  } finally { f.cleanup(); }
});

test("proxy pressure cannot evict images from the dedicated image budget", async () => {
  const f = fixture({ cacheSettings: { maxBytes: 9 * 1024 * 1024, imageMaxBytes: 3 * 1024 * 1024, proxyMaxBytes: 6 * 1024 * 1024, minimumFreeBytes: 0 } });
  try {
    const seeded = seedAsset(f);
    await f.service.pruneCache();
    const proxy = path.join(f.cacheRoot, "proxies", "d".repeat(40) + "-v3-540.mp4");
    fs.writeFileSync(proxy, Buffer.alloc(7 * 1024 * 1024));
    const restarted = media.create(f.runtime);
    await restarted.pruneCache();
    assert.equal(fs.existsSync(proxy), false);
    assert.equal(fs.existsSync(seeded.image), true);
  } finally { f.cleanup(); }
});

test("activity pauses new background work and cancellation removes the waiting item", async () => {
  const calls = [];
  const f = fixture({ resolveMediaTools: () => ({ ok: true, source: "system", architecture: "arm64", ffmpeg: "/test/ffmpeg", ffprobe: "/test/ffprobe" }),
    childProcess: { execFile(binary, args, options, callback) { calls.push({ binary, args, callback }); return { kill() {} }; } } });
  try {
    f.service.setActivity({ scrolling: true });
    const controller = new AbortController();
    const pending = f.service.posterFor(f.source, { purpose: "offline", signal: controller.signal }).catch(error => error);
    await until(() => f.service.getResourceStatus().queued === 1);
    assert.equal(calls.length, 0);
    controller.abort();
    assert.equal((await pending).code, "JOB_CANCELLED");
    f.service.setActivity({ scrolling: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 0);
    assert.equal(f.service.getResourceStatus().queued, 0);
  } finally { f.cleanup(); }
});

test("global advisory lock serializes separate workers and de-duplicates output after acquiring the lock", async () => {
  const f = fixture();
  try {
    const trace = path.join(f.home, "trace");
    const firstOutput = path.join(f.home, "one.output");
    const a = runWorker(f.home, firstOutput, trace), b = runWorker(f.home, firstOutput, trace);
    const values = await Promise.all([a.done, b.done]);
    assert.equal(values.filter(result => result.stdout.includes("LKFB_CACHE_HIT")).length, 1);
    assert.equal(fs.readFileSync(trace, "utf8").trim().split("\n").length, 2);
    const c = runWorker(f.home, path.join(f.home, "two.output"), trace);
    const d = runWorker(f.home, path.join(f.home, "three.output"), trace);
    await Promise.all([c.done, d.done]);
    assert.deepEqual(fs.readFileSync(trace, "utf8").trim().split("\n").map(line => line.split(" ")[0]), ["begin", "end", "begin", "end", "begin", "end"]);
  } finally { f.cleanup(); }
});

test("the global worker budget rejects a second instance before it can oversubscribe the proxy layer", async () => {
  const f = fixture();
  try {
    const trace = path.join(f.home, "trace");
    const settings = { workerLimit: 10, workerConfig: { budget: { root: f.cacheRoot, maxBytes: 15, images: 15, proxies: 15 } } };
    const firstOutput = path.join(f.cacheRoot, "proxies", "e".repeat(40) + "-v3-540.mp4");
    const secondOutput = path.join(f.cacheRoot, "proxies", "f".repeat(40) + "-v3-540.mp4");
    await runWorker(f.home, firstOutput, trace, .02, settings).done;
    await assert.rejects(runWorker(f.home, secondOutput, trace, .02, settings).done, /CACHE_BUDGET_EXCEEDED/);
    assert.equal(fs.existsSync(secondOutput), false);
    assert.equal(fs.statSync(firstOutput).size, 9);
    assert.equal(fs.readFileSync(trace, "utf8").trim().split("\n").length, 2);
  } finally { f.cleanup(); }
});

test("killing a worker group releases its OS lock without deleting or replacing the lock file", async () => {
  const f = fixture();
  try {
    const trace = path.join(f.home, "trace");
    const first = runWorker(f.home, path.join(f.home, "one.output"), trace, 2);
    const firstResult = first.done.catch(error => error);
    await until(() => fs.existsSync(trace));
    const before = fs.statSync(path.join(f.home, "heavy.lock"));
    process.kill(-first.child.pid, "SIGKILL");
    assert.ok(await firstResult);
    await runWorker(f.home, path.join(f.home, "two.output"), trace).done;
    assert.equal(fs.statSync(path.join(f.home, "heavy.lock")).ino, before.ino);
  } finally { f.cleanup(); }
});

test("pins survive another instance and pruning only touches recognized generated files", async () => {
  const f = fixture();
  try {
    const seeded = seedAsset(f);
    const unrelated = path.join(f.cacheRoot, "posters", "my-source.png");
    fs.writeFileSync(unrelated, png);
    await f.service.pruneCache();
    const second = media.create(f.runtime);
    await second.pinCachedAsset(f.source, true);
    await f.service.pruneCache({ clearUnused: true });
    assert.equal(fs.existsSync(seeded.image), true);
    assert.equal(fs.existsSync(unrelated), true);
    await second.pinCachedAsset(f.source, false);
    await f.service.pruneCache({ clearUnused: true });
    assert.equal(fs.existsSync(seeded.image), false);
    assert.equal(fs.existsSync(unrelated), true);
  } finally { f.cleanup(); }
});

test("active playback retained in another instance survives an explicit unused-cache cleanup", async () => {
  const f = fixture();
  try {
    const seeded = seedAsset(f);
    const second = media.create(f.runtime);
    await second.retainCacheFile(seeded.image);
    await f.service.pruneCache({ clearUnused: true });
    assert.equal(fs.existsSync(seeded.image), true);
    await second.releaseCacheFile(seeded.image);
    await f.service.pruneCache({ clearUnused: true });
    assert.equal(fs.existsSync(seeded.image), false);
  } finally { f.cleanup(); }
});

test("a configurable cache root uses a dedicated namespace and exposes separate budgets", async () => {
  const customRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-custom-cache-test-"));
  const f = fixture({ cacheSettings: { root: customRoot, maxBytes: 9000000, minimumFreeBytes: 0 } });
  try {
    assert.equal(f.service.cacheRoot, path.join(customRoot, "com.fnnas.fnosbridge.mvp"));
    assert.equal(f.service.cacheStats().layers.images.maxBytes, 3000000);
    assert.equal(f.service.cacheStats().layers.proxies.maxBytes, 6000000);
    await f.service.pruneCache();
  } finally {
    f.cleanup();
    fs.rmSync(customRoot, { recursive: true, force: true });
  }
});

test("short and long synthetic sprites use one decoder, bounded memory, and actual sampled timestamps", async (t) => {
  const ffmpeg = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find(candidate => fs.existsSync(candidate));
  if (!ffmpeg) { t.skip("FFmpeg is not installed"); return; }
  const measured = [];
  const wrappedProcess = Object.assign({}, childProcess, { execFile(binary, args, options, callback) {
    if (process.platform === "darwin" && args[0] === worker && args[1] !== "--index") {
      return childProcess.execFile("/usr/bin/time", ["-l", binary].concat(args), options, function (error, stdout, stderr) {
        const match = String(stderr).match(/(\d+)\s+maximum resident set size/);
        if (match) { measured.push(Number(match[1])); }
        callback(error, stdout, stderr);
      });
    }
    return childProcess.execFile(binary, args, options, callback);
  } });
  const f = fixture({ childProcess: wrappedProcess, resolveMediaTools: () => ({ ok: true, source: "system", architecture: process.arch === "arm64" ? "arm64" : "x64", ffmpeg, ffprobe: path.join(path.dirname(ffmpeg), "ffprobe") }) });
  try {
    for (const duration of [6, 120]) {
      const source = path.join(f.home, "synthetic-" + duration + ".mp4");
      const frameRate = duration === 6 ? 24 : 12;
      childProcess.execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=${frameRate}:duration=${duration}`, "-threads", "2", "-c:v", "libx264", "-preset", "ultrafast", "-g", "24", "-pix_fmt", "yuv420p", "-y", source], { timeout: 60000 });
      const started = Date.now();
      const sprite = await f.service.spriteFor(source);
      const expected = media.spriteSampleTimes(duration, 12, frameRate);
      assert.equal(sprite.approximateTimes, false);
      assert.equal(sprite.sampleTimes.length, 12);
      sprite.sampleTimes.forEach((actual, index) => {
        assert.ok(actual >= expected[index] - .001 && actual <= expected[index] + 1 / frameRate + .002, `sample ${index}: ${actual} must identify the frame returned at ${expected[index]}`);
      });
      assert.equal(f.service.getResourceStatus().maxActive, 1);
      if (process.platform === "darwin") { assert.ok(measured.at(-1) < 256 * 1024 * 1024, "single decoder sprite peak RSS must stay below 256 MiB for the synthetic 720p fixtures"); }
      t.diagnostic(JSON.stringify({ duration, elapsedMs: Date.now() - started, maximumRssBytes: measured.at(-1) || null, samples: sprite.sampleTimes }));
    }
    const offsetSource = path.join(f.home, "offset.ts");
    childProcess.execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", path.join(f.home, "synthetic-6.mp4"), "-c", "copy", "-output_ts_offset", "7", "-y", offsetSource], { timeout: 30000 });
    const offsetSprite = await f.service.spriteFor(offsetSource);
    assert.ok(offsetSprite.sampleTimes.every(time => time >= 0 && time < 6), "sample timestamps must be relative to the playback timeline even when source PTS starts above zero");
  } finally { f.cleanup(); }
});
