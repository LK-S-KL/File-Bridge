const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const EventEmitter = require("node:events");
const childProcess = require("node:child_process");
const test = require("node:test");
const media = require("../extension/js/media-tools.js");

function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-media-stability-"));
  fs.mkdirSync(path.join(directory, ".local", "bin"), { recursive: true });
  fs.writeFileSync(path.join(directory, ".local", "bin", "ffmpeg"), "test binary");
  fs.writeFileSync(path.join(directory, ".local", "bin", "ffprobe"), "test binary");
  const sources = ["first.mov", "second.mov", "third.mov"].map(name => path.join(directory, name));
  sources.forEach(file => fs.writeFileSync(file, "test media"));
  const calls = [];
  const processRuntime = {
    execFile(binary, args, execOptions, callback) {
      if (args[0] && args[0].endsWith("media-worker.pl") && args[1] === "--index") { return childProcess.execFile(binary, args, execOptions, callback); }
      if (options.spawnError) { options.spawnError = false; throw new Error("SPAWN_FAILURE"); }
      if (args[0] && args[0].endsWith("media-worker.pl")) { binary = args[2]; args = args.slice(8); }
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.signals = []; child.kill = signal => child.signals.push(signal);
      const call = { binary, args, callback, child };
      calls.push(call);
      if (binary.endsWith("ffprobe")) {
        queueMicrotask(() => callback(null, JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 320, height: 180 }], format: { duration: "10" } }), ""));
      } else if (options.autoComplete) {
        queueMicrotask(() => { fs.writeFileSync(args.at(-1), "output"); callback(null, "", ""); });
      }
      return child;
    }
  };
  const service = media.create({ fs, path, os: { homedir: () => directory }, crypto, childProcess: processRuntime, resolveMediaTools: () => ({ ok: true, source: "system", architecture: "arm64", ffmpeg: path.join(directory, ".local", "bin", "ffmpeg"), ffprobe: path.join(directory, ".local", "bin", "ffprobe"), version: "test" }), terminationGraceMs: 25, sourceStatTtlMs: 0, cacheSettings: { minimumFreeBytes: 0, ...(options.cacheSettings || {}) }, ...options.runtime });
  return { directory, sources, calls, service, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) { throw new Error("TEST_WAIT_TIMEOUT"); }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test("cancelled media jobs settle immediately, escalate KILL, and recover the single decoder slot", async () => {
  const f = fixture();
  try {
    const first = f.service.previewProxyFor(f.sources[0], "720").then(() => null, error => error);
    const second = f.service.previewProxyFor(f.sources[1], "720").then(() => null, error => error);
    const third = f.service.previewProxyFor(f.sources[2], "720");
    await until(() => f.calls.length === 1);
    await assert.rejects(f.service.prepare({ retry: true }), { code: "MEDIA_TOOLS_BUSY" });
    assert.equal(f.service.getStatus().state, "ready");
    f.service.cancelViewerJobs(f.sources[0]); f.service.cancelViewerJobs(f.sources[1]);
    assert.equal((await first).code, "JOB_CANCELLED");
    assert.equal((await second).code, "JOB_CANCELLED");
    await until(() => f.calls.length === 2);
    assert.deepEqual(f.calls[0].child.signals, ["SIGTERM", "SIGKILL"]);
    const current = f.calls[1];
    fs.writeFileSync(current.args.at(-1), "finished output"); current.callback(null, "", "");
    assert.equal(fs.existsSync(await third), true);
    f.calls[0].callback(null, "late", "");
    assert.equal(f.calls.length, 2, "queued cancellation and active cancellation must not start software fallback");
  } finally { f.cleanup(); }
});

test("cancelling a poster never starts another frame or proxy fallback", async () => {
  const f = fixture();
  try {
    const request = f.service.posterFor(f.sources[0]).then(() => null, error => error);
    await until(() => f.calls.some(call => call.binary.endsWith("ffmpeg")));
    const count = f.calls.length;
    f.service.prioritizeViewer();
    assert.equal((await request).code, "JOB_CANCELLED");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(f.calls.length, count);
  } finally { f.cleanup(); }
});

test("synchronous process spawn failure releases metadata queue slot", async () => {
  const f = fixture({ spawnError: true });
  try {
    await assert.rejects(f.service.metadataFor(f.sources[0]), /SPAWN_FAILURE/);
    const result = await f.service.metadataFor(f.sources[1]);
    assert.equal(result.width, 320);
  } finally { f.cleanup(); }
});

test("cache pruning removes fresh files above budget but preserves active playback", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-cache-budget-"));
  const cacheRoot = path.join(directory, "Library", "Caches", "com.fnnas.fnosbridge.mvp");
  const proxies = path.join(cacheRoot, "proxies");
  fs.mkdirSync(proxies, { recursive: true });
  const active = path.join(proxies, "a".repeat(40) + "-v3-720.mp4"), unused = path.join(proxies, "b".repeat(40) + "-v3-720.mp4");
  fs.writeFileSync(active, Buffer.alloc(60)); fs.writeFileSync(unused, Buffer.alloc(60));
  const service = media.create({ fs, path, os: { homedir: () => directory }, crypto, childProcess: {}, cacheSettings: { maxBytes: 100, targetBytes: 70, minimumFreeBytes: 0 } });
  service.retainCacheFile(active);
  try {
    const result = await service.pruneCache();
    assert.ok(result.bytes <= 100);
    assert.equal(fs.existsSync(active), true);
    assert.equal(fs.existsSync(unused), false);
    service.releaseCacheFile(active);
    await service.pruneCache({ clearUnused: true });
    assert.equal(fs.existsSync(active), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("low disk space refuses new proxies before spawning a media process", async () => {
  const f = fixture({ cacheSettings: { minimumFreeBytes: 100 }, runtime: { availableCacheBytes: () => 50 } });
  try {
    await assert.rejects(f.service.previewProxyFor(f.sources[0], "720"), /CACHE_DISK_FULL/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.service.cacheStats().reservedBytes, 0);
  } finally { f.cleanup(); }
});

test("cache budget overflow refuses output without retrying or leaving a partial file", async () => {
  const f = fixture({ cacheSettings: { maxBytes: 100, targetBytes: 70, proxyReservationBytes: 80 } });
  try {
    const request = f.service.previewProxyFor(f.sources[0], "720").then(() => null, error => error);
    await until(() => f.calls.length === 1);
    fs.writeFileSync(f.calls[0].args.at(-1), Buffer.alloc(81));
    f.calls[0].callback(null, "", "");
    assert.match((await request).message, /CACHE_OUTPUT_LIMIT/);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(fs.readdirSync(path.join(f.service.cacheRoot, "proxies")), []);
    assert.equal(f.service.cacheStats().reservedBytes, 0);
  } finally { f.cleanup(); }
});

test("active playback exceeding cache budget blocks new output without deleting playback", async () => {
  const f = fixture({ cacheSettings: { maxBytes: 100, targetBytes: 70, proxyReservationBytes: 80 } });
  try {
    await f.service.pruneCache();
    // Exercise the publication path so the service accounts the active file.
    const first = f.service.previewProxyFor(f.sources[0], "720");
    await until(() => f.calls.length === 1);
    fs.writeFileSync(f.calls[0].args.at(-1), Buffer.alloc(60)); f.calls[0].callback(null, "", "");
    const published = await first;
    f.service.retainCacheFile(published);
    await assert.rejects(f.service.previewProxyFor(f.sources[1], "720"), /CACHE_BUDGET_EXCEEDED/);
    assert.equal(fs.existsSync(published), true);
    assert.equal(f.calls.length, 1);
  } finally { f.cleanup(); }
});

test("stale nested still-cache work directories are cleaned without touching symlink targets", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-cache-stale-"));
  const cacheRoot = path.join(directory, "Library", "Caches", "com.fnnas.fnosbridge.mvp");
  const work = path.join(cacheRoot, "stills", "." + "a".repeat(40) + "-999999999-1");
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "preview.png"), "old cache");
  const source = path.join(directory, "original.png"); fs.writeFileSync(source, "source");
  fs.symlinkSync(source, path.join(work, "linked.png"));
  const old = new Date(Date.now() - 7200000);
  fs.utimesSync(path.join(work, "preview.png"), old, old); fs.utimesSync(work, old, old);
  const service = media.create({ fs, path, os: { homedir: () => directory }, crypto, childProcess: {}, cacheSettings: { minimumFreeBytes: 0 } });
  try {
    await service.pruneCache();
    assert.equal(fs.existsSync(work), false);
    assert.equal(fs.readFileSync(source, "utf8"), "source");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("successful cache writes are accounted and stable size/mtime survives inode replacement", async () => {
  const f = fixture({ autoComplete: true });
  try {
    const source = f.sources[0];
    const before = fs.statSync(source);
    const first = await f.service.metadataFor(source);
    fs.writeFileSync(source + ".new", "test media");
    fs.utimesSync(source + ".new", before.atime, before.mtime);
    fs.renameSync(source + ".new", source);
    const second = await f.service.metadataFor(source);
    assert.equal(first.width, second.width);
    assert.equal(f.calls.filter(call => call.binary.endsWith("ffprobe")).length, 1);
    const output = await f.service.previewProxyFor(source, "720");
    assert.ok(f.service.cacheStats().bytes >= fs.statSync(output).size);
    assert.equal(f.service.cacheStats().reservedBytes, 0);
  } finally { f.cleanup(); }
});

test("failed PDF and Quick Look previews clean owned temporary directories", async () => {
  const f = fixture();
  try {
    const source = path.join(f.directory, "design.ai"); fs.writeFileSync(source, "design");
    const request = f.service.previewStillFor(source).then(() => null, error => error);
    let completed = 0;
    while (true) {
      await until(() => f.calls.length > completed);
      const call = f.calls[completed++]; call.callback(new Error("RENDER_FAILURE"));
      if (call.binary.endsWith("qlmanage")) { break; }
    }
    assert.match((await request).message, /RENDER_FAILURE/);
    assert.deepEqual(fs.readdirSync(path.join(f.service.cacheRoot, "stills")), []);
    assert.equal(f.service.cacheStats().reservedBytes, 0);
  } finally { f.cleanup(); }
});
