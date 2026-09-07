(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.LKOfflinePrecache = api;
}(this, function () {
  "use strict";

  var MAX_ASSETS = 10000;
  var MAX_BYTES = 16 * 1024 * 1024;
  var TERMINAL = ["completed", "cancelled"];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function fault(code) { var error = new Error(code); error.code = code; return error; }
  function errorCode(error) {
    var code = error && typeof error.code === "string" ? error.code : "PREVIEW_FAILED";
    return /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : "PREVIEW_FAILED";
  }
  function optionsFor(options) {
    options = options || {};
    return { metadata: options.metadata !== false, posters: options.posters !== false, sprites: options.sprites === true, proxies: options.proxies === true,
      profile: options.profile === "balanced" ? "balanced" : "low",
      proxyQuality: options.proxyQuality === "720" ? "720" : "540", pin: options.pin !== false };
  }
  function assetFor(asset) {
    if (typeof asset === "string") { asset = { path: asset }; }
    if (!asset || typeof asset.path !== "string" || !asset.path || asset.path.length > 4096 || asset.path.indexOf("\0") !== -1) { throw fault("INVALID_ASSET"); }
    return { path: asset.path, name: String(asset.name || "").slice(0, 512), type: String(asset.type || "").slice(0, 32),
      extension: String(asset.extension || "").slice(0, 16), size: Math.max(0, Number(asset.size) || 0), modifiedMs: Number(asset.modifiedMs) || 0 };
  }
  function emptyState() { return { id: "", status: "idle", items: [], options: optionsFor(), createdAt: 0, updatedAt: 0, revision: 0 }; }

  function create(runtime) {
    var fs = runtime.fs;
    var path = runtime.path;
    var crypto = runtime.crypto;
    var hostProcess = runtime.process || (typeof process === "object" ? process : null);
    if (!runtime.cacheRoot || !crypto || !hostProcess || typeof runtime.processAsset !== "function") { throw fault("INVALID_RUNTIME"); }
    var directory = path.resolve(runtime.cacheRoot);
    var journalPath = path.join(directory, "offline-precache-v1.json");
    var backupPath = path.join(directory, "offline-precache-v1.last-good.json");
    var lockPath = path.join(directory, ".offline-precache-runner");
    var token = crypto.randomBytes(16).toString("hex");
    var state = emptyState();
    var listeners = [];
    var chain = Promise.resolve();
    var active = null;
    var timer = null;
    var ownsLock = false;
    var externalLock = false;
    var disposed = false;
    var recovered = false;
    var writable = true;
    var queueError = "";
    var serial = 0;
    var completedSinceCheckpoint = 0;
    var checkpointAt = 0;
    var busyDelay = Math.max(10, Number(runtime.busyDelayMs) || 300);

    function call(method, args) {
      return new Promise(function (resolve, reject) {
        fs[method].apply(fs, args.concat([function (error, value) { if (error) { reject(error); } else { resolve(value); } }]));
      });
    }
    function enqueue(action) {
      var result = chain.then(action);
      chain = result.catch(function () {});
      return result;
    }
    function missing(error) { return error && error.code === "ENOENT"; }
    function remove(filePath) { return call("unlink", [filePath]).catch(function (error) { if (!missing(error)) { throw error; } }); }
    function processAlive(pid) {
      if (typeof runtime.isProcessAlive === "function") { return runtime.isProcessAlive(pid); }
      try { hostProcess.kill(pid, 0); return true; }
      catch (error) { return error.code !== "ESRCH"; }
    }
    function readOwner() {
      return call("readFile", [path.join(lockPath, "owner.json"), "utf8"]).then(function (raw) {
        try {
          var owner = JSON.parse(raw);
          if (!owner || !Number.isInteger(owner.pid) || owner.pid < 1 || typeof owner.token !== "string" || !owner.token) { return { raw: raw, owner: null }; }
          return { raw: raw, owner: owner };
        } catch (ignore) { return { raw: raw, owner: null }; }
      }).catch(function (error) { if (missing(error)) { return { raw: "", owner: null }; } throw error; });
    }
    function lockInfo() {
      return call("stat", [lockPath]).then(function (stat) {
        return readOwner().then(function (record) {
          record.exists = true;
          record.stale = record.owner ? !processAlive(record.owner.pid) : Date.now() - stat.mtimeMs > 30000;
          record.identity = String(stat.dev) + ":" + String(stat.ino) + ":" + String(stat.birthtimeMs);
          return record;
        });
      }).catch(function (error) { if (missing(error)) { return { exists: false, stale: false }; } throw error; });
    }
    function reclaimLock(info) {
      var marker = path.join(lockPath, ".reclaim");
      // One contender retires this exact dead owner's directory; a new token is never age-evicted.
      return call("writeFile", [marker, token, { flag: "wx", mode: 0o600 }]).then(function () {
        return lockInfo().then(function (current) {
          if (!current.exists || current.identity !== info.identity || (current.owner && !current.stale) || current.raw !== info.raw || (info.owner && current.owner.token !== info.owner.token)) { throw fault("QUEUE_BUSY"); }
          var retired = lockPath + ".stale-" + token;
          return call("rename", [lockPath, retired]).then(function () {
            return remove(path.join(retired, "owner.json")).then(function () { return remove(path.join(retired, ".reclaim")); })
              .then(function () { return call("rmdir", [retired]); });
          });
        });
      }).catch(function (error) {
        return call("readFile", [marker, "utf8"]).then(function (owner) { if (owner === token) { return remove(marker); } }).catch(function () {})
          .then(function () { if (error.code === "EEXIST" || missing(error)) { throw fault("QUEUE_BUSY"); } throw error; });
      });
    }
    function acquireLock() {
      if (ownsLock) { return assertOwnership(); }
      return call("mkdir", [directory, { recursive: true }]).then(function () {
        return call("mkdir", [lockPath]).catch(function (error) {
          if (error.code !== "EEXIST") { throw error; }
          return lockInfo().then(function (info) {
            if (!info.exists) { return; }
            if (!info.stale) { externalLock = true; throw fault("QUEUE_BUSY"); }
            return reclaimLock(info);
          }).then(function () { return call("mkdir", [lockPath]); });
        });
      }).then(function () {
        return call("writeFile", [path.join(lockPath, "owner.json"), JSON.stringify({ pid: hostProcess.pid, token: token }), { flag: "wx", mode: 0o600 }]);
      }).then(function () { ownsLock = true; externalLock = false; });
    }
    function assertOwnership() {
      return readOwner().then(function (record) {
        if (!ownsLock || !record.owner || record.owner.token !== token || record.owner.pid !== hostProcess.pid) {
          ownsLock = false; externalLock = true; throw fault("QUEUE_OWNERSHIP_LOST");
        }
      });
    }
    function releaseLock() {
      if (!ownsLock) { return Promise.resolve(); }
      return assertOwnership().then(function () { return remove(path.join(lockPath, "owner.json")); })
        .then(function () { return call("rmdir", [lockPath]); })
        .then(function () { ownsLock = false; }, function (error) { ownsLock = false; throw error; });
    }
    function encode(value) {
      var payload = JSON.stringify(value);
      if (encodeURIComponent(payload).replace(/%[A-F0-9]{2}/g, "x").length > MAX_BYTES) { throw fault("BATCH_TOO_LARGE"); }
      return JSON.stringify({ schemaVersion: 1, checksum: crypto.createHash("sha256").update(payload, "utf8").digest("hex"), payload: value });
    }
    function validState(value) {
      return value && typeof value.id === "string" && value.id.length <= 128 &&
        ["idle", "running", "paused", "cancelling", "completed", "cancelled"].indexOf(value.status) !== -1 &&
        Number.isInteger(value.revision) && value.revision >= 0 && Array.isArray(value.items) && value.items.length <= MAX_ASSETS &&
        value.items.every(function (item) {
          try { assetFor(item.asset); } catch (ignore) { return false; }
          return ["pending", "running", "done", "failed"].indexOf(item.status) !== -1 && typeof item.cached === "boolean" &&
            typeof item.error === "string" && item.error.length <= 64;
        });
    }
    function readJournal(filePath) {
      return call("stat", [filePath]).then(function (stat) {
        if (stat.size > MAX_BYTES * 2) { throw fault("INVALID_JOURNAL"); }
        return call("readFile", [filePath, "utf8"]);
      }).then(function (raw) {
        var envelope = JSON.parse(raw);
        if (envelope.schemaVersion !== 1 || !validState(envelope.payload) ||
            crypto.createHash("sha256").update(JSON.stringify(envelope.payload), "utf8").digest("hex") !== envelope.checksum) { throw fault("INVALID_JOURNAL"); }
        return { valid: true, state: envelope.payload, raw: raw, path: filePath };
      }).catch(function (error) { return { valid: false, missing: missing(error), path: filePath }; });
    }
    function inspect() {
      return Promise.all([readJournal(journalPath), readJournal(backupPath)]).then(function (records) {
        return { primary: records[0], backup: records[1], state: records[0].valid ? records[0].state : (records[1].valid ? records[1].state : emptyState()) };
      });
    }
    function adopt(records, preserveId) {
      var oldId = state.id;
      state = clone(records.state);
      state.options = optionsFor(state.options);
      recovered = !records.primary.valid && records.backup.valid;
      writable = records.primary.valid || records.backup.valid || (records.primary.missing && records.backup.missing);
      queueError = writable ? "" : "JOURNAL_RECOVERY_REQUIRED";
      if (!externalLock) {
        if (state.status === "running" || state.status === "cancelling") { state.status = "paused"; }
        state.items.forEach(function (item) { if (item.status === "running") { item.status = "pending"; } });
      }
      if (preserveId && oldId && oldId !== state.id) { throw fault("BATCH_CHANGED"); }
      if (!writable) { throw fault(queueError); }
    }
    function atomicWrite(filePath, contents) {
      serial += 1;
      var temporary = path.join(directory, ".offline-precache-" + token + "-" + serial + ".tmp");
      var descriptor;
      // Publish only a complete, flushed document; the last valid primary becomes the backup.
      return call("open", [temporary, "wx", 0o600]).then(function (fd) {
        descriptor = fd;
        return call("writeFile", [fd, contents, "utf8"]);
      }).then(function () { return call("fsync", [descriptor]); })
        .then(function () { return call("close", [descriptor]); })
        .then(function () { descriptor = undefined; return call("rename", [temporary, filePath]); })
        .then(function () {}, function (error) {
          var close = descriptor === undefined ? Promise.resolve() : call("close", [descriptor]).catch(function () {});
          return close.then(function () { return remove(temporary).catch(function () {}); }).then(function () { throw error; });
        });
    }
    function preserve(record) {
      if (record.valid || record.missing) { return Promise.resolve(); }
      serial += 1;
      return call("copyFile", [record.path, record.path + ".corrupt-" + token + "-" + serial, fs.constants.COPYFILE_EXCL]);
    }
    function persist() {
      if (!writable) { return Promise.reject(fault("JOURNAL_RECOVERY_REQUIRED")); }
      state.updatedAt = Date.now(); state.revision += 1;
      var contents;
      try { contents = encode(state); } catch (error) { return Promise.reject(error); }
      return assertOwnership().then(inspect).then(function (records) {
        return preserve(records.primary).then(function () { return preserve(records.backup); }).then(function () {
          if (records.primary.valid) { return atomicWrite(backupPath, records.primary.raw); }
          if (!records.backup.valid) { return atomicWrite(backupPath, contents); }
        }).then(function () { return atomicWrite(journalPath, contents); }).then(function () {
          completedSinceCheckpoint = 0; checkpointAt = Date.now();
        });
      });
    }
    function snapshot() {
      var result = { id: state.id, status: state.status, total: state.items.length, done: 0, cached: 0, failed: 0,
        current: active ? clone(active.item.asset) : null, options: clone(state.options), createdAt: state.createdAt,
        updatedAt: state.updatedAt, owned: ownsLock, locked: externalLock, recovered: recovered, writable: writable,
        error: queueError, failures: [] };
      state.items.forEach(function (item) {
        if (!result.current && item.status === "running") { result.current = clone(item.asset); }
        if (item.status === "done") { result.done += 1; if (item.cached) { result.cached += 1; } }
        if (item.status === "failed") {
          result.failed += 1;
          if (result.failures.length < 100) { result.failures.push({ asset: clone(item.asset), code: item.error }); }
        }
      });
      return result;
    }
    function notify() {
      listeners.slice().forEach(function (listener) { try { listener(snapshot()); } catch (ignoreListener) {} });
    }
    function stopTimer() { if (timer !== null) { clearTimeout(timer); timer = null; } }
    function interrupt() {
      stopTimer();
      if (!active || active.signal.cancelled) { return; }
      active.signal.cancelled = true;
      active.hooks.slice().forEach(function (hook) { try { hook(); } catch (ignoreCancel) {} });
    }
    function schedule(delay) {
      if (timer !== null || disposed || state.status !== "running" || active) { return; }
      timer = setTimeout(function () {
        timer = null;
        enqueue(beginNext).catch(function (error) { enqueue(function () { return stopForError(error); }); });
      }, delay || 0);
    }
    function stopForError(error) {
      queueError = errorCode(error); state.status = "paused"; interrupt(); notify();
      if (!active) { return releaseLock().catch(function () {}); }
    }
    function finishJob(job, result, error) {
      if (active !== job) { return; }
      if (!error && job.signal.cancelled && (!result || result.cancelled || result.interrupted)) { job.item.status = "pending"; job.item.error = ""; }
      else if (!error) { job.item.status = "done"; job.item.cached = !!(result && result.cached); job.item.error = ""; }
      else if (job.signal.cancelled) { job.item.status = "pending"; job.item.error = ""; }
      else { job.item.status = "failed"; job.item.error = errorCode(error); }
      active = null;
      if (state.status === "cancelling") { state.status = "cancelled"; }
      if (state.status === "running" && !state.items.some(function (item) { return item.status === "pending"; })) { state.status = "completed"; }
      completedSinceCheckpoint += 1;
      // Rechecking recent cached outputs after a crash is cheaper than rewriting
      // a 10,000-item journal twice for every finished asset.
      var checkpoint = state.status !== "running" || completedSinceCheckpoint >= 100 || Date.now() - checkpointAt >= 30000;
      return (checkpoint ? persist() : assertOwnership()).then(function () {
        if (state.status !== "running") { return releaseLock(); }
      }).then(function () { notify(); schedule(); }).catch(stopForError);
    }
    function beginNext() {
      if (disposed || state.status !== "running" || active) { return; }
      if (runtime.isBusy && runtime.isBusy()) { schedule(busyDelay); return; }
      var item = state.items.filter(function (candidate) { return candidate.status === "pending"; })[0];
      if (!item) {
        state.status = "completed";
        return persist().then(releaseLock).then(notify);
      }
      var job = { item: item, hooks: [], signal: { cancelled: false }, done: null };
      job.signal.onCancel = function (hook) {
        if (typeof hook !== "function") { return function () {}; }
        if (job.signal.cancelled) { hook(); return function () {}; }
        job.hooks.push(hook);
        return function () { var index = job.hooks.indexOf(hook); if (index !== -1) { job.hooks.splice(index, 1); } };
      };
      active = job; item.status = "running";
      return assertOwnership().then(function () {
        notify();
        job.done = Promise.resolve().then(function () {
          if (job.signal.cancelled) { throw fault("CANCELLED"); }
          return runtime.processAsset(clone(item.asset), clone(state.options), job.signal);
        }).then(function (result) { return enqueue(function () { return finishJob(job, result, null); }); },
          function (error) { return enqueue(function () { return finishJob(job, null, error); }); });
      }).catch(function (error) { active = null; item.status = "pending"; return stopForError(error); });
    }
    function withOwnership(action, preserveId) {
      if (disposed) { return Promise.reject(fault("QUEUE_DISPOSED")); }
      var alreadyOwned = ownsLock;
      return acquireLock().then(function () {
        if (alreadyOwned) { return; }
        return inspect().then(function (records) { adopt(records, preserveId); });
      }).then(action).catch(function (error) {
        var commandError = ["QUEUE_BUSY", "QUEUE_STOPPING", "BATCH_EXISTS", "BATCH_CHANGED", "NO_RESUMABLE_BATCH", "JOURNAL_RECOVERY_REQUIRED"].indexOf(error.code) !== -1;
        var stopping = commandError ? Promise.resolve() : Promise.resolve(stopForError(error));
        return stopping.then(function () {
          if ((!alreadyOwned || !commandError) && !active) { return releaseLock().catch(function () {}); }
        }).then(function () { notify(); throw error; });
      });
    }
    function load() {
      return enqueue(function () {
        if (ownsLock || active) { return snapshot(); }
        return lockInfo().then(function (info) { externalLock = info.exists && !info.stale; return inspect(); }).then(function (records) {
          try { adopt(records, false); } catch (error) { if (error.code !== "JOURNAL_RECOVERY_REQUIRED") { throw error; } }
          notify(); return snapshot();
        });
      });
    }
    function start(assets, options) {
      return enqueue(function () {
        if (!Array.isArray(assets) || !assets.length) { throw fault("EMPTY_BATCH"); }
        if (assets.length > MAX_ASSETS) { throw fault("BATCH_TOO_LARGE"); }
        var seen = Object.create(null);
        var items = assets.map(assetFor).filter(function (asset) { if (seen[asset.path]) { return false; } seen[asset.path] = true; return true; })
          .map(function (asset) { return { asset: asset, status: "pending", cached: false, error: "" }; });
        return withOwnership(function () {
          if (state.id && TERMINAL.indexOf(state.status) === -1) { throw fault("BATCH_EXISTS"); }
          state = { id: crypto.randomBytes(12).toString("hex"), status: "running", items: items, options: optionsFor(options), createdAt: Date.now(), updatedAt: 0, revision: 0 };
          return persist().then(function () { notify(); schedule(); return snapshot(); });
        }, false);
      });
    }
    function pause() {
      interrupt();
      return enqueue(function () {
        return withOwnership(function () {
          if (state.status !== "running" && state.status !== "paused") { return releaseLock().then(snapshot); }
          state.status = "paused";
          return persist().then(function () { if (!active) { return releaseLock(); } }).then(function () { notify(); return snapshot(); });
        }, true);
      });
    }
    function resume(retry) {
      return enqueue(function () {
        return withOwnership(function () {
          if (active) { throw fault("QUEUE_STOPPING"); }
          if (!state.id || state.status === "cancelled" || state.status === "cancelling") { throw fault("NO_RESUMABLE_BATCH"); }
          if (retry) { state.items.forEach(function (item) { if (item.status === "failed") { item.status = "pending"; item.error = ""; } }); }
          state.status = "running"; queueError = "";
          return persist().then(function () { notify(); schedule(); return snapshot(); });
        }, true);
      });
    }
    function cancel() {
      var pendingJob;
      interrupt();
      return enqueue(function () {
        return withOwnership(function () {
          state.status = active ? "cancelling" : "cancelled";
          return persist().then(function () { if (!active) { return releaseLock(); } }).then(function () { notify(); pendingJob = active ? active.done : null; });
        }, true);
      }).then(function () { return pendingJob; }).then(function () { return snapshot(); });
    }
    function dispose() {
      interrupt();
      return enqueue(function () {
        disposed = true;
        if (!ownsLock) { listeners = []; return; }
        if (state.status === "running") { state.status = "paused"; }
        return persist().then(function () { if (!active) { return releaseLock(); } });
      }).then(function () {
        return active && active.done ? active.done : null;
      }).then(function () { listeners = []; });
    }

    return { path: journalPath, backupPath: backupPath, lockPath: lockPath, load: load, start: start, pause: pause,
      resume: function () { return resume(false); }, cancel: cancel, retryFailed: function () { return resume(true); },
      snapshot: snapshot, getSnapshot: snapshot,
      subscribe: function (listener) { listeners.push(listener); return function () { var index = listeners.indexOf(listener); if (index !== -1) { listeners.splice(index, 1); } }; }, dispose: dispose };
  }

  return { create: create, MAX_ASSETS: MAX_ASSETS };
}));
