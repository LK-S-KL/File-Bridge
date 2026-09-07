const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const test = require("node:test");
const offline = require("../extension/js/offline-precache.js");

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lk-offline-test-"));
  const queues = [];
  function create(extra = {}) {
    const queue = offline.create(Object.assign({ fs, path, crypto, cacheRoot: root, busyDelayMs: 10, processAsset: async () => ({}) }, overrides, extra));
    queues.push(queue);
    return queue;
  }
  return { root, create, async close() {
    await Promise.all(queues.map((queue) => queue.dispose()));
    fs.rmSync(root, { recursive: true, force: true });
  } };
}
function waitFor(predicate, timeout = 4000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (predicate()) { resolve(); return; }
      if (Date.now() - start > timeout) { reject(new Error("Timed out waiting for queue state")); return; }
      setTimeout(check, 5);
    }
    check();
  });
}
function asset(name) { return { path: "/unread-source/" + name + ".mp4", name: name + ".mp4", type: "video" }; }
function writeEnvelope(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, checksum: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"), payload }));
}

test("unchecked metadata and posters remain disabled after resume", async () => {
  const seen = [];
  const fx = fixture({ isBusy: () => true, processAsset: async (_asset, options) => { seen.push(options); return {}; } });
  const queue = fx.create();
  try {
    await queue.start([asset("only-sprites")], { metadata: false, posters: false, sprites: true });
    await queue.pause();
    await queue.resume();
    assert.equal(queue.snapshot().options.metadata, false);
    assert.equal(queue.snapshot().options.posters, false);
    assert.equal(queue.snapshot().options.sprites, true);
    await queue.cancel();
  } finally { await fx.close(); }
});

test("large warm batches checkpoint periodically instead of rewriting the entire list per asset", async () => {
  const wrapped = Object.create(fs);
  let publications = 0;
  wrapped.rename = (source, target, callback) => {
    if (target.endsWith('offline-precache-v1.json')) publications++;
    fs.rename(source, target, callback);
  };
  const fx = fixture({fs:wrapped,processAsset:async()=>({cached:true})});
  const queue = fx.create();
  try {
    await queue.start(Array.from({length:205},(_,i)=>asset('cached-'+i)));
    await waitFor(()=>queue.snapshot().status==='completed'&&!queue.snapshot().owned,10000);
    assert.equal(queue.snapshot().done,205);
    assert.ok(publications>=3&&publications<=5, 'expected start, periodic and final checkpoints, got '+publications);
    assert.equal(JSON.parse(fs.readFileSync(queue.path,'utf8')).payload.items.filter(i=>i.status==='done').length,205);
  }finally{await fx.close();}
});

test("runs bounded serial jobs with default metadata and posters and immutable snapshots", async () => {
  let concurrent = 0;
  let maximum = 0;
  const seen = [];
  const fx = fixture({ processAsset: async (item, options) => {
    concurrent += 1; maximum = Math.max(maximum, concurrent);
    seen.push({ path: item.path, options });
    item.path = "/mutated-by-worker";
    await new Promise((resolve) => setTimeout(resolve, 3));
    concurrent -= 1;
    return { cached: seen.length === 1 };
  } });
  const queue = fx.create();
  const originals = [Object.freeze(asset("a")), Object.freeze(asset("b"))];
  try {
    await queue.start(originals);
    await waitFor(() => queue.snapshot().status === "completed" && !queue.snapshot().owned);
    assert.equal(maximum, 1);
    assert.deepEqual(seen.map((entry) => entry.path), originals.map((entry) => entry.path));
    assert.deepEqual(seen[0].options, { metadata: true, posters: true, sprites: false, proxies: false, profile: "low", proxyQuality: "540", pin: true });
    const snapshot = queue.getSnapshot();
    assert.deepEqual([snapshot.total, snapshot.done, snapshot.cached, snapshot.failed], [2, 2, 1, 0]);
    snapshot.options.pin = false;
    assert.equal(queue.snapshot().options.pin, true);
    const stored = JSON.parse(fs.readFileSync(queue.path)).payload;
    assert.deepEqual(stored.items.map((item) => item.asset.path), originals.map((entry) => entry.path));
    assert.equal(fs.statSync(queue.path).mode & 0o777, 0o600);
    assert.equal(fs.readdirSync(fx.root).some((name) => name.endsWith(".tmp")), false);
  } finally { await fx.close(); }
});

test("pauses immediately, requests cancellation, and resumes only pending assets", async () => {
  const started = [];
  let rejectJob;
  let firstSignal;
  let cancelled = 0;
  const fx = fixture({ processAsset: (item, options, signal) => {
    started.push(item.name);
    if (started.length === 1) {
      firstSignal = signal;
      signal.onCancel(() => { cancelled += 1; });
      return new Promise((resolve, reject) => { rejectJob = reject; });
    }
    return Promise.resolve({});
  } });
  const queue = fx.create();
  try {
    await queue.start([asset("a"), asset("b")]);
    await waitFor(() => started.length === 1);
    const paused = await queue.pause();
    assert.equal(paused.status, "paused");
    assert.equal(firstSignal.cancelled, true);
    assert.equal(cancelled, 1);
    await assert.rejects(queue.resume(), { code: "QUEUE_STOPPING" });
    rejectJob(Object.assign(new Error("interrupted at /private/source"), { code: "CANCELLED" }));
    await waitFor(() => !queue.snapshot().owned);
    assert.equal(queue.snapshot().failed, 0);
    assert.equal(started.length, 1);
    await queue.resume();
    await waitFor(() => queue.snapshot().status === "completed" && !queue.snapshot().owned);
    assert.deepEqual(started, ["a.mp4", "a.mp4", "b.mp4"]);
  } finally { await fx.close(); }
});

test("cancellation waits for in-flight output and cannot replace an unfinished batch", async () => {
  let complete;
  let started = false;
  const fx = fixture({ processAsset: () => { started = true; return new Promise((resolve) => { complete = resolve; }); } });
  const queue = fx.create();
  try {
    await queue.start([asset("a"), asset("b")]);
    await waitFor(() => started);
    let cancellationFinished = false;
    const cancellation = queue.cancel().then((value) => { cancellationFinished = true; return value; });
    await waitFor(() => queue.snapshot().status === "cancelling");
    await assert.rejects(queue.start([asset("new")]), { code: "BATCH_EXISTS" });
    assert.equal(cancellationFinished, false);
    complete({ cached: false });
    const result = await cancellation;
    assert.equal(result.status, "cancelled");
    assert.equal(result.done, 1, "a successfully published output remains complete after cancellation");
    assert.equal(result.owned, false);
    await queue.start([asset("new")]);
    await queue.pause();
  } finally { await fx.close(); }
});

test("an interrupted worker that resolves without an output remains pending", async () => {
  let started = false;
  const fx = fixture({ processAsset: (item, options, signal) => new Promise((resolve) => {
    started = true;
    signal.onCancel(() => resolve());
  }) });
  const queue = fx.create();
  try {
    await queue.start([asset("a")]);
    await waitFor(() => started);
    await queue.pause();
    await waitFor(() => !queue.snapshot().owned);
    assert.equal(queue.snapshot().done, 0);
    assert.equal(queue.snapshot().failed, 0);
    assert.equal(JSON.parse(fs.readFileSync(queue.path)).payload.items[0].status, "pending");
  } finally { await fx.close(); }
});

test("failures use bounded codes and retryFailed only retries failed assets", async () => {
  const calls = [];
  let failedOnce = false;
  const fx = fixture({ processAsset: async (item) => {
    calls.push(item.name);
    if (item.name === "b.mp4" && !failedOnce) { failedOnce = true; throw Object.assign(new Error("private path /Users/person/media"), { code: "EIO" }); }
    return { cached: false };
  } });
  const queue = fx.create();
  try {
    await queue.start([asset("a"), asset("b")]);
    await waitFor(() => queue.snapshot().status === "completed" && !queue.snapshot().owned);
    assert.equal(queue.snapshot().done, 1);
    assert.equal(queue.snapshot().failed, 1);
    assert.equal(queue.snapshot().failures[0].code, "EIO");
    assert.equal(fs.readFileSync(queue.path, "utf8").includes("/Users/person"), false);
    await queue.resume();
    await waitFor(() => queue.snapshot().status === "completed" && !queue.snapshot().owned);
    assert.deepEqual(calls, ["a.mp4", "b.mp4"], "ordinary resume does not silently retry failed jobs");
    await queue.retryFailed();
    await waitFor(() => queue.snapshot().status === "completed" && !queue.snapshot().owned);
    assert.deepEqual(calls, ["a.mp4", "b.mp4", "b.mp4"]);
    assert.equal(queue.snapshot().done, 2);
  } finally { await fx.close(); }
});

test("busy foreground yields without starting a source job", async () => {
  let busy = true;
  let calls = 0;
  const fx = fixture({ isBusy: () => busy, processAsset: async () => { calls += 1; return {}; } });
  const queue = fx.create();
  try {
    await queue.start([asset("a")]);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(calls, 0);
    assert.equal(JSON.parse(fs.readFileSync(queue.path)).payload.items[0].status, "pending");
    busy = false;
    await waitFor(() => queue.snapshot().status === "completed" && !queue.snapshot().owned);
    assert.equal(calls, 1);
  } finally { await fx.close(); }
});

test("another live instance cannot replace, cancel or resume the runner batch", async () => {
  let complete;
  let started = false;
  const fx = fixture({ processAsset: () => { started = true; return new Promise((resolve) => { complete = resolve; }); } });
  const first = fx.create();
  const second = fx.create();
  try {
    await first.start([asset("a")]);
    await waitFor(() => started);
    const foreign = await second.load();
    assert.equal(foreign.status, "running");
    assert.equal(foreign.locked, true);
    assert.equal(foreign.owned, false);
    await assert.rejects(second.start([asset("b")]), { code: "QUEUE_BUSY" });
    await assert.rejects(second.pause(), { code: "QUEUE_BUSY" });
    await assert.rejects(second.cancel(), { code: "QUEUE_BUSY" });
    await assert.rejects(second.resume(), { code: "QUEUE_BUSY" });
    assert.equal(first.snapshot().status, "running");
    complete({});
    await waitFor(() => first.snapshot().status === "completed" && !first.snapshot().owned);
    assert.equal((await second.load()).done, 1);
  } finally { await fx.close(); }
});

test("a crashed process restores its running task to paused and requires explicit resume", async () => {
  let calls = 0;
  const fx = fixture({ processAsset: async () => { calls += 1; return {}; } });
  const queue = fx.create();
  const modulePath = path.resolve(__dirname, "../extension/js/offline-precache.js");
  const worker = "const fs=require('fs'),path=require('path'),crypto=require('crypto');const queue=require(process.argv[1]).create({fs,path,crypto,cacheRoot:process.argv[2],processAsset:()=>{process.exit(0)}});queue.start([{path:'/unread-source/a.mp4'}]);";
  try {
    await new Promise((resolve, reject) => childProcess.execFile(process.execPath, ["-e", worker, modulePath, fx.root], { timeout: 5000 }, (error) => error ? reject(error) : resolve()));
    assert.equal(JSON.parse(fs.readFileSync(queue.path)).payload.status, "running");
    const loaded = await queue.load();
    assert.equal(loaded.status, "paused");
    assert.equal(loaded.locked, false);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(calls, 0);
    await assert.rejects(queue.start([asset("replacement")]), { code: "BATCH_EXISTS" });
    await queue.resume();
    await waitFor(() => queue.snapshot().status === "completed" && !queue.snapshot().owned);
    assert.equal(calls, 1);
    assert.equal(fs.existsSync(queue.lockPath), false);
  } finally { await fx.close(); }
});

test("old lock age never displaces a live PID and a stale ownerless lock can be reclaimed", async () => {
  const fx = fixture({ isBusy: () => true });
  const queue = fx.create();
  try {
    fs.mkdirSync(queue.lockPath);
    fs.writeFileSync(path.join(queue.lockPath, "owner.json"), JSON.stringify({ pid: process.pid, token: "other-live-instance" }));
    fs.utimesSync(queue.lockPath, new Date(0), new Date(0));
    await assert.rejects(queue.start([asset("a")]), { code: "QUEUE_BUSY" });
    assert.equal(JSON.parse(fs.readFileSync(path.join(queue.lockPath, "owner.json"))).token, "other-live-instance");
    fs.unlinkSync(path.join(queue.lockPath, "owner.json"));
    fs.utimesSync(queue.lockPath, new Date(0), new Date(0));
    await queue.start([asset("a")]);
    assert.equal(queue.snapshot().owned, true);
    await queue.pause();
  } finally { await fx.close(); }
});

test("recovers backup and preserves corrupted primary before subsequent writes", async () => {
  const fx = fixture({ isBusy: () => true });
  const first = fx.create();
  const second = fx.create();
  try {
    await first.start([asset("a")]);
    await first.pause();
    fs.writeFileSync(first.path, "{truncated primary");
    const recovered = await second.load();
    assert.equal(recovered.status, "paused");
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.total, 1);
    await second.resume();
    await second.pause();
    const preserved = fs.readdirSync(fx.root).filter((name) => name.startsWith("offline-precache-v1.json.corrupt-"));
    assert.equal(preserved.length, 1);
    assert.equal(fs.readFileSync(path.join(fx.root, preserved[0]), "utf8"), "{truncated primary");
  } finally { await fx.close(); }
});

test("refuses corrupt or invalid-schema journals without overwriting either copy", async () => {
  const fx = fixture();
  const queue = fx.create();
  try {
    fs.writeFileSync(queue.path, "{}");
    fs.writeFileSync(queue.backupPath, "broken backup");
    const snapshot = await queue.load();
    assert.equal(snapshot.writable, false);
    assert.equal(snapshot.error, "JOURNAL_RECOVERY_REQUIRED");
    await assert.rejects(queue.start([asset("a")]), { code: "JOURNAL_RECOVERY_REQUIRED" });
    assert.equal(fs.readFileSync(queue.path, "utf8"), "{}");
    assert.equal(fs.readFileSync(queue.backupPath, "utf8"), "broken backup");
    assert.equal(fs.existsSync(queue.lockPath), false);
  } finally { await fx.close(); }
});

test("checksum mismatch and journals larger than the asset bound are invalid", async () => {
  const fx = fixture({ isBusy: () => true });
  const first = fx.create();
  const second = fx.create();
  try {
    await first.start([asset("a")]);
    await first.pause();
    const envelope = JSON.parse(fs.readFileSync(first.path));
    envelope.payload.items[0].asset.path = "/tampered-source";
    fs.writeFileSync(first.path, JSON.stringify(envelope));
    assert.equal((await second.load()).recovered, true);
    envelope.payload.items = Array.from({ length: 10001 }, () => ({ asset: asset("a"), status: "pending", cached: false, error: "" }));
    writeEnvelope(first.path, envelope.payload);
    writeEnvelope(first.backupPath, envelope.payload);
    assert.equal((await second.load()).writable, false);
  } finally { await fx.close(); }
});

test("rejects oversized input and deduplicates a repeated source path", async () => {
  const fx = fixture({ isBusy: () => true });
  const queue = fx.create();
  try {
    await assert.rejects(queue.start(Array.from({ length: 10001 }, () => asset("a"))), { code: "BATCH_TOO_LARGE" });
    assert.equal(fs.existsSync(queue.path), false);
    await queue.start([asset("a"), asset("a")]);
    assert.equal(queue.snapshot().total, 1);
    await queue.pause();
  } finally { await fx.close(); }
});

test("atomic publication failure preserves a valid prior journal and stops the queue", async () => {
  const wrapped = Object.create(fs);
  const fx = fixture({ fs: wrapped, isBusy: () => true });
  const queue = fx.create();
  try {
    await queue.start([asset("a")]);
    await queue.pause();
    const previous = fs.readFileSync(queue.path, "utf8");
    wrapped.rename = (source, target, callback) => target === queue.path ? callback(Object.assign(new Error("disk full"), { code: "ENOSPC" })) : fs.rename(source, target, callback);
    await assert.rejects(queue.resume(), { code: "ENOSPC" });
    assert.equal(fs.readFileSync(queue.path, "utf8"), previous);
    assert.equal(fs.readdirSync(fx.root).some((name) => name.endsWith(".tmp")), false);
    assert.equal(fs.existsSync(queue.lockPath), false);
    wrapped.rename = fs.rename;
  } finally { await fx.close(); }
});

test("dispose cancels the active worker and restart remains paused", async () => {
  let started = false;
  const fx = fixture({ processAsset: (item, options, signal) => new Promise((resolve, reject) => {
    started = true;
    signal.onCancel(() => reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" })));
  }) });
  const first = fx.create();
  const second = fx.create();
  try {
    await first.start([asset("a"), asset("b")]);
    await waitFor(() => started);
    await first.dispose();
    const loaded = await second.load();
    assert.equal(loaded.status, "paused");
    assert.equal(loaded.done, 0);
    assert.equal(loaded.failed, 0);
    await assert.rejects(first.resume(), { code: "QUEUE_DISPOSED" });
  } finally { await fx.close(); }
});
