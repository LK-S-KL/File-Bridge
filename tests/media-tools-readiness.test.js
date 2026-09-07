const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const test = require("node:test");
const media = require("../extension/js/media-tools.js");

function fixture(runtime = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-media-readiness-"));
  const extensionRoot = path.join(home, "Plugin Extension");
  const service = media.create({ fs, path, os: { homedir: () => home }, crypto, childProcess: {}, extensionRoot, ...runtime });
  return { home, extensionRoot, service, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

function pair(directory = "/test/extension/bin/darwin-arm64", source = "bundled", architecture = "arm64") {
  return { ok: true, source, architecture, version: "8.1", ffmpeg: path.join(directory, "ffmpeg"), ffprobe: path.join(directory, "ffprobe") };
}

test("binary discovery is asynchronous, coalesced, and only publishes a validated pair", async () => {
  let complete, attempts = 0;
  const f = fixture({ resolveMediaTools: () => { attempts++; return new Promise(resolve => { complete = resolve; }); } });
  try {
    assert.equal(f.service.getStatus().state, "idle");
    assert.equal(f.service.findBinary("ffmpeg"), null);
    const first = f.service.prepare(), second = f.service.prepare();
    assert.equal(first, second);
    assert.equal(attempts, 0, "checking must not block initial UI setup");
    assert.equal(f.service.getStatus().state, "checking");
    await Promise.resolve();
    assert.equal(attempts, 1);
    complete(pair());
    assert.equal((await first).state, "ready");
    assert.equal(f.service.findBinary("ffmpeg"), "/test/extension/bin/darwin-arm64/ffmpeg");
    assert.equal(f.service.findBinary("ffprobe"), "/test/extension/bin/darwin-arm64/ffprobe");
    assert.equal(f.service.findBinary("anything"), null);
    assert.equal(f.service.getStatus().source, "bundled");
  } finally { f.cleanup(); }
});

test("shared resolver receives actual extension root and user home without shell interpolation", async () => {
  const calls = [];
  const f = fixture({ childProcess: { execFile(binary, args, options, callback) {
    calls.push({ binary, args, options });
    queueMicrotask(() => callback(null, JSON.stringify(pair("/usr/local/bin", "system", "x64"))));
    return { kill() {} };
  } } });
  try {
    await f.service.prepare();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].binary, "/usr/bin/perl");
    assert.deepEqual(calls[0].args, [path.join(f.extensionRoot, "js", "resolve-media-tools.pl"), "--root", f.extensionRoot, "--home", f.home]);
    assert.equal(calls[0].options.timeout, 35000);
    assert.equal(f.service.findBinary("ffmpeg"), "/usr/local/bin/ffmpeg");
    assert.equal(f.service.findBinary("ffprobe"), "/usr/local/bin/ffprobe");
    assert.equal(f.service.getStatus().architecture, "x64");
  } finally { f.cleanup(); }
});

test("Node module resolution locates the sibling shared resolver by default", async () => {
  let resolverPath;
  const f = fixture({ extensionRoot: undefined, childProcess: { execFile(_binary, args, _options, callback) {
    resolverPath = args[0];
    queueMicrotask(() => callback(null, JSON.stringify(pair())));
    return { kill() {} };
  } } });
  try {
    await f.service.prepare();
    assert.equal(resolverPath, path.join(__dirname, "..", "extension", "js", "resolve-media-tools.pl"));
  } finally { f.cleanup(); }
});

test("invalid or mixed resolver selections are rejected without an existence-only fallback", async () => {
  for (const result of [
    { ok: false, message: "signature mismatch", attempts: [{ source: "bundled", reason: "checksum mismatch" }] },
    { ...pair(), ffprobe: "/different/bin/ffprobe" },
    { ...pair(), ffmpeg: "relative/ffmpeg" },
    { ...pair(), architecture: "unknown" },
    { ...pair(), ffprobe: "/test/extension/bin/darwin-arm64/not-ffprobe" }
  ]) {
    const f = fixture({ resolveMediaTools: () => result });
    try {
      await assert.rejects(f.service.prepare(), { code: "MEDIA_TOOLS_UNAVAILABLE" });
      assert.equal(f.service.getStatus().state, "unavailable");
      assert.equal(f.service.findBinary("ffmpeg"), null);
      assert.equal(f.service.findBinary("ffprobe"), null);
      await assert.rejects(f.service.metadataFor("/a.mp4"), { code: "MEDIA_TOOLS_UNAVAILABLE" });
    } finally { f.cleanup(); }
  }
});

test("explicit retry after repair can recover without retrying for every thumbnail", async () => {
  let calls = 0;
  const f = fixture({ resolveMediaTools: () => { calls++; return calls === 1 ? { ok: false, message: "missing" } : pair(); } });
  try {
    await assert.rejects(f.service.prepare(), { code: "MEDIA_TOOLS_UNAVAILABLE" });
    await assert.rejects(f.service.prepare(), { code: "MEDIA_TOOLS_UNAVAILABLE" });
    assert.equal(calls, 1);
    const first = f.service.prepare({ retry: true }), second = f.service.prepare({ retry: true });
    assert.equal(first, second);
    assert.equal((await first).state, "ready");
    assert.equal(calls, 2);
    await f.service.prepare({ retry: true });
    assert.equal(calls, 3, "explicit recheck validates again when no media job is running");
  } finally { f.cleanup(); }
});

test("a failed explicit recheck clears the stale executable selection", async () => {
  let available = true;
  const f = fixture({ resolveMediaTools: () => available ? pair() : { ok: false } });
  try {
    await f.service.prepare();
    available = false;
    await assert.rejects(f.service.prepare({ retry: true }), { code: "MEDIA_TOOLS_UNAVAILABLE" });
    assert.equal(f.service.findBinary("ffmpeg"), null);
    assert.equal(f.service.getStatus().state, "unavailable");
  } finally { f.cleanup(); }
});

test("malformed output and subprocess failures become actionable readiness errors", async () => {
  for (const output of ["not json", JSON.stringify({ ok: false, message: "architecture unavailable", attempts: [{ source: "bundled", reason: "wrong architecture" }] })]) {
    const f = fixture({ childProcess: { execFile(_binary, _args, _options, callback) {
      queueMicrotask(() => callback(new Error("PROCESS_FAILURE"), output));
      return { kill() {} };
    } } });
    try {
      await assert.rejects(f.service.prepare(), { code: "MEDIA_TOOLS_UNAVAILABLE" });
      assert.equal(f.service.getStatus().state, "unavailable");
      assert.equal(f.service.findBinary("ffmpeg"), null);
      assert.ok(f.service.getStatus().error.message.length > 0);
    } finally { f.cleanup(); }
  }
});

test("a hung resolver is killed and late completion cannot mark the tools ready", async () => {
  let callback;
  const signals = [];
  const f = fixture({ mediaToolsTimeoutMs: 15, childProcess: { execFile(_binary, _args, _options, done) {
    callback = done;
    return { kill: signal => signals.push(signal) };
  } } });
  try {
    await assert.rejects(f.service.prepare(), { code: "MEDIA_TOOLS_UNAVAILABLE" });
    assert.deepEqual(signals, ["SIGKILL"]);
    callback(null, JSON.stringify(pair()));
    assert.equal(f.service.getStatus().state, "unavailable");
    assert.equal(f.service.findBinary("ffmpeg"), null);
  } finally { f.cleanup(); }
});

test("all media producers await readiness; failed detection cannot create media or output files", async () => {
  let rejectCheck;
  const f = fixture({ resolveMediaTools: () => new Promise((_resolve, reject) => { rejectCheck = reject; }) });
  const source = path.join(f.home, "source.mov"), destination = path.join(f.home, "transcoded.mp4");
  fs.writeFileSync(source, "source");
  try {
    const requests = [
      f.service.metadataFor(source), f.service.posterFor(source), f.service.waveformFor(source),
      f.service.previewStillFor(source), f.service.spriteFor(source), f.service.previewProxyFor(source, "720"),
      f.service.audioProxyFor(source), f.service.frameFor(source, 0),
      f.service.captureFrameForProject(source, 0), f.service.transcodeTo(source, destination, "720")
    ].map(request => request.then(() => null, error => error));
    while (!rejectCheck) { await new Promise(resolve => setImmediate(resolve)); }
    rejectCheck(new Error("missing binaries"));
    const results = await Promise.all(requests);
    assert.ok(results.every(error => error && error.code === "MEDIA_TOOLS_UNAVAILABLE"));
    assert.equal(fs.existsSync(destination), false);
    assert.equal(fs.existsSync(f.service.captureDirectory), false);
  } finally { f.cleanup(); }
});

test("previews cancelled during dependency resolution never restart when detection finishes", async () => {
  let resolveCheck;
  const f = fixture({ resolveMediaTools: () => new Promise(resolve => { resolveCheck = resolve; }) });
  try {
    const source = path.join(f.home, "does-not-exist.mov");
    const preview = f.service.previewProxyFor(source, "720").catch(error => error);
    const audio = f.service.audioProxyFor(source).catch(error => error);
    const poster = f.service.posterFor(source).catch(error => error);
    while (!resolveCheck) { await new Promise(resolve => setImmediate(resolve)); }
    f.service.cancelViewerJobs(source);
    f.service.prioritizeViewer();
    resolveCheck(pair());
    assert.equal((await preview).code, "JOB_CANCELLED");
    assert.equal((await audio).code, "JOB_CANCELLED");
    assert.equal((await poster).code, "JOB_CANCELLED");
    assert.equal(f.service.getStatus().state, "ready");
    await assert.rejects(f.service.previewProxyFor(source, "720"), /ENOENT|FILE_NOT_FOUND/);
  } finally { f.cleanup(); }
});

test("cancelling while the source stat is pending also prevents a late media job", async () => {
  let sourcePath, statDone;
  const wrappedFs = Object.assign({}, fs, { stat(file, callback) {
    if (file === sourcePath) { statDone = callback; return; }
    fs.stat(file, callback);
  } });
  const f = fixture({ fs: wrappedFs, resolveMediaTools: () => pair() });
  try {
    sourcePath = path.join(f.home, "source.mov");
    fs.writeFileSync(sourcePath, "media");
    const request = f.service.previewProxyFor(sourcePath, "720").catch(error => error);
    await f.service.prepare();
    while (!statDone) { await new Promise(resolve => setImmediate(resolve)); }
    assert.equal(typeof statDone, "function");
    f.service.cancelViewerJobs(sourcePath);
    statDone(null, fs.statSync(sourcePath));
    assert.equal((await request).code, "JOB_CANCELLED");
    assert.equal(f.service.cacheStats().reservedBytes, 0);
  } finally { f.cleanup(); }
});
