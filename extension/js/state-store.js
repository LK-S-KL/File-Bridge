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
    preferences: {
      sortBy: "modified",
      sortDirection: "desc",
      zoom: 128,
      scanMode: "single",
      activeRootId: "",
      searchOpen: false,
      colorManagementNoticeSeen: false
    }
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
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
      result.preferences.searchOpen = state.preferences.searchOpen === true;
      result.preferences.colorManagementNoticeSeen = state.preferences.colorManagementNoticeSeen === true;
    }
    return result;
  }

  function create(runtime) {
    var fs = runtime.fs;
    var path = runtime.path;
    var os = runtime.os;
    var directory = path.join(os.homedir(), "Library", "Application Support", "fnOS Bridge");
    var statePath = path.join(directory, "state.json");
    var lockPath = path.join(directory, ".state-write-lock");

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

    function load() {
      try {
        return normalize(JSON.parse(fs.readFileSync(statePath, "utf8")));
      } catch (error) {
        return clone(DEFAULT_STATE);
      }
    }

    function save(state) {
      var temporaryPath;
      fs.mkdirSync(directory, { recursive: true });
      temporaryPath = path.join(directory, ".state-" + process.pid + "-" + Date.now() + ".tmp");
      fs.writeFileSync(temporaryPath, JSON.stringify(normalize(state), null, 2), { encoding: "utf8", mode: 0o600 });
      try {
        fs.chmodSync(temporaryPath, 0o600);
      } catch (ignoreModeError) {}
      fs.renameSync(temporaryPath, statePath);
      return normalize(state);
    }

    function mutate(mutator) {
      var latest;
      acquireLock();
      try {
        latest = load();
        mutator(latest);
        return save(latest);
      } finally { releaseLock(); }
    }

    return {
      path: statePath,
      lockPath: lockPath,
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
