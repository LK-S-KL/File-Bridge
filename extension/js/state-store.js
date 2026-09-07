(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.FnOSStateStore = api;
}(this, function () {
  "use strict";

  var DEFAULT_STATE = {
    schemaVersion: 1,
    roots: [],
    assetMeta: {},
    pluginFolders: [],
    pluginRootAssetKeys: [],
    libraryCache: {},
    preferences: {
      sortBy: "modified",
      sortDirection: "desc",
      zoom: 128,
      scanMode: "single",
      activeRootId: "",
      viewMode: "card",
      cardStyle: "info",
      searchOpen: false,
      colorManagementNoticeSeen: false,
      previewCacheRoot: "",
      previewCacheMaxGiB: 12,
      previewPerformance: "low"
    }
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function validStoredState(state) {
    return isRecord(state) && state.schemaVersion === 1 && Array.isArray(state.roots) && isRecord(state.assetMeta) &&
      state.roots.every(function (item) { return isRecord(item) && typeof item.path === "string" && item.path.length > 0; }) &&
      (!Object.prototype.hasOwnProperty.call(state, "preferences") || isRecord(state.preferences)) &&
      (!Object.prototype.hasOwnProperty.call(state, "libraryCache") || isRecord(state.libraryCache)) &&
      (!Object.prototype.hasOwnProperty.call(state, "pluginFolders") || (Array.isArray(state.pluginFolders) && state.pluginFolders.every(function (folder) {
        return isRecord(folder) && typeof folder.id === "string" && typeof folder.name === "string" && folder.name.length > 0 &&
          Array.isArray(folder.assetKeys) && folder.assetKeys.every(function (key) { return typeof key === "string"; });
      }))) &&
      (!Object.prototype.hasOwnProperty.call(state, "pluginRootAssetKeys") || (Array.isArray(state.pluginRootAssetKeys) && state.pluginRootAssetKeys.every(function (key) { return typeof key === "string"; })));
  }

  function normalize(state) {
    var result = clone(DEFAULT_STATE);
    if (!state || typeof state !== "object") {
      return result;
    }
    if (Array.isArray(state.roots)) {
      result.roots = state.roots.filter(function (item) {
        return item && typeof item.path === "string" && item.path.length;
      }).map(function (item) {
        return {
          id: String(item.id || item.path),
          path: item.path,
          label: String(item.label || ""),
          enabled: item.enabled !== false
        };
      });
    }
    if (state.assetMeta && typeof state.assetMeta === "object") {
      result.assetMeta = state.assetMeta;
    }
    if (Array.isArray(state.pluginFolders)) {
      result.pluginFolders = state.pluginFolders.slice(0, 256).filter(function (folder) {
        return folder && typeof folder.id === "string" && typeof folder.name === "string" && folder.name.length;
      }).map(function (folder) {
        return { id: folder.id, name: folder.name, parentId: String(folder.parentId || ""), assetKeys: Array.isArray(folder.assetKeys) ? folder.assetKeys.slice(0, 20000).filter(function (key) { return typeof key === "string"; }) : [] };
      });
    }
    if (Array.isArray(state.pluginRootAssetKeys)) {
      var seenRootAssetKeys = {};
      result.pluginRootAssetKeys = state.pluginRootAssetKeys.slice(0, 20000).filter(function (key) {
        if (typeof key !== "string" || !key.length || seenRootAssetKeys[key]) { return false; }
        seenRootAssetKeys[key] = true;
        return true;
      });
    }
    if (state.libraryCache && typeof state.libraryCache === "object") {
      Object.keys(state.libraryCache).slice(0, 128).forEach(function (rootId) {
        var items = state.libraryCache[rootId];
        if (!Array.isArray(items)) { return; }
        result.libraryCache[rootId] = items.slice(0, 10000).filter(function (item) { return item && typeof item.path === "string" && typeof item.name === "string"; }).map(function (item) {
          return {
            name: item.name, path: item.path, relativePath: String(item.relativePath || item.name), folder: String(item.folder || "根目录"),
            extension: String(item.extension || ""), type: String(item.type || ""), size: Number(item.size) || 0,
            modifiedMs: Number(item.modifiedMs) || 0
          };
        });
      });
    }
    if (state.preferences && typeof state.preferences === "object") {
      result.preferences.sortBy = state.preferences.sortBy || result.preferences.sortBy;
      result.preferences.sortDirection = state.preferences.sortDirection === "asc" ? "asc" : "desc";
      /* Migrate the original three-position 0/1/2 preference to pixel sizing. */
      if (Number(state.preferences.zoom) >= 0 && Number(state.preferences.zoom) <= 2) {
        result.preferences.zoom = [96, 128, 176][Number(state.preferences.zoom)] || 128;
      } else {
        result.preferences.zoom = Math.max(88, Math.min(260, Number(state.preferences.zoom) || 128));
      }
      result.preferences.scanMode = ["single", "selected", "all"].indexOf(state.preferences.scanMode) !== -1 ? state.preferences.scanMode : result.preferences.scanMode;
      result.preferences.activeRootId = String(state.preferences.activeRootId || "");
      result.preferences.viewMode = state.preferences.viewMode === "list" ? "list" : "card";
      result.preferences.cardStyle = state.preferences.cardStyle === "clean" ? "clean" : "info";
      result.preferences.searchOpen = state.preferences.searchOpen === true;
      result.preferences.colorManagementNoticeSeen = state.preferences.colorManagementNoticeSeen === true;
      result.preferences.previewCacheRoot = typeof state.preferences.previewCacheRoot === "string" ? state.preferences.previewCacheRoot.slice(0, 4096) : "";
      var cacheMaxGiB = Number(state.preferences.previewCacheMaxGiB);
      result.preferences.previewCacheMaxGiB = isFinite(cacheMaxGiB) ? Math.max(2, Math.min(128, cacheMaxGiB)) : 12;
      result.preferences.previewPerformance = state.preferences.previewPerformance === "balanced" ? "balanced" : "low";
    }
    return result;
  }

  function create(runtime) {
    var fs = runtime.fs;
    var path = runtime.path;
    var os = runtime.os;
    var directory = path.join(os.homedir(), "Library", "Application Support", "fnOS Bridge");
    var statePath = path.join(directory, "state.json");
    var backupPath = path.join(directory, "state.last-good.json");
    var lockPath = path.join(directory, ".state-write-lock");
    var serial = 0;
    var status = { ok: true, writable: true, recovered: false, code: "NEW_STATE", source: "defaults", path: statePath, backupPath: backupPath };

    function pause(milliseconds) {
      var start;
      if (typeof SharedArrayBuffer === "function" && typeof Atomics === "object" && typeof Atomics.wait === "function") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
        return;
      }
      start = Date.now(); while (Date.now() - start < milliseconds) {}
    }

    function acquireLock() {
      var attempt;
      var stat;
      fs.mkdirSync(directory, { recursive: true });
      for (attempt = 0; attempt < 100; attempt += 1) {
        try { fs.mkdirSync(lockPath); return; }
        catch (error) {
          if (error.code !== "EEXIST") { throw error; }
          try {
            stat = fs.statSync(lockPath);
            if (Date.now() - stat.mtimeMs > 5000) { fs.rmdirSync(lockPath); continue; }
          } catch (ignoreStaleLockError) {}
          pause(5);
        }
      }
      throw new Error("STATE_BUSY");
    }

    function releaseLock() {
      try { fs.rmdirSync(lockPath); } catch (ignoreReleaseError) {}
    }

    function readSnapshot(filePath) {
      try {
        var contents = fs.readFileSync(filePath, "utf8");
        var parsed = JSON.parse(contents);
        if (!validStoredState(parsed)) { throw new Error("INVALID_STATE_SCHEMA"); }
        return { valid: true, state: normalize(parsed), path: filePath };
      } catch (error) {
        return { valid: false, missing: error.code === "ENOENT", error: error, path: filePath };
      }
    }

    function inspect() {
      var primary = readSnapshot(statePath);
      var backup = readSnapshot(backupPath);
      var fresh = primary.missing && backup.missing;
      status = {
        ok: primary.valid || fresh,
        writable: primary.valid || backup.valid || fresh,
        recovered: !primary.valid && backup.valid,
        code: primary.valid ? "OK" : (backup.valid ? "STATE_RECOVERED" : (fresh ? "NEW_STATE" : "STATE_RECOVERY_REQUIRED")),
        source: primary.valid ? "primary" : (backup.valid ? "backup" : "defaults"),
        path: statePath,
        backupPath: backupPath,
        message: primary.valid || fresh ? "" : (backup.valid ? "本地配置损坏，已读取最近有效备份。" : "本地配置与备份无法读取，已暂停保存。原文件已保留，请恢复有效备份。")
      };
      return { primary: primary, backup: backup, state: clone(primary.valid ? primary.state : (backup.valid ? backup.state : DEFAULT_STATE)) };
    }

    function load() { return inspect().state; }

    function atomicWrite(filePath, state) {
      serial += 1;
      var temporaryPath = path.join(directory, ".state-" + process.pid + "-" + Date.now() + "-" + serial + ".tmp");
      try {
        fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
        fs.renameSync(temporaryPath, filePath);
      } finally {
        try { fs.unlinkSync(temporaryPath); } catch (ignoreMissingTemporary) {}
      }
    }

    function preserveInvalid(snapshot) {
      if (snapshot.valid || snapshot.missing) { return; }
      serial += 1;
      var preservedPath = snapshot.path + ".corrupt-" + Date.now() + "-" + process.pid + "-" + serial;
      fs.copyFileSync(snapshot.path, preservedPath, fs.constants.COPYFILE_EXCL);
    }

    function assertWritable() {
      if (status.writable) { return; }
      var error = new Error(status.message);
      error.code = "STATE_RECOVERY_REQUIRED";
      error.status = clone(status);
      throw error;
    }

    function persist(state, snapshots) {
      var normalized = normalize(state);
      assertWritable();
      preserveInvalid(snapshots.primary);
      preserveInvalid(snapshots.backup);
      // Keep a validated prior state before replacing the primary file.
      if (snapshots.primary.valid) { atomicWrite(backupPath, snapshots.primary.state); }
      else if (!snapshots.backup.valid) { atomicWrite(backupPath, normalized); }
      atomicWrite(statePath, normalized);
      inspect();
      return normalized;
    }

    function save(state) {
      acquireLock();
      try { return persist(state, inspect()); }
      finally { releaseLock(); }
    }

    function mutate(mutator) {
      var snapshots;
      acquireLock();
      try {
        snapshots = inspect();
        assertWritable();
        mutator(snapshots.state);
        return persist(snapshots.state, snapshots);
      } finally { releaseLock(); }
    }

    return {
      path: statePath,
      backupPath: backupPath,
      lockPath: lockPath,
      getStatus: function () { return clone(status); },
      load: load,
      save: save,
      mutate: mutate
    };
  }

  return {
    create: create,
    normalize: normalize,
    defaults: function () { return clone(DEFAULT_STATE); }
  };
}));
