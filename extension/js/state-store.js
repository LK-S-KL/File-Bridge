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
      zoom: 1
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
      result.preferences.zoom = Math.max(0, Math.min(2, Number(state.preferences.zoom) || 0));
    }
    return result;
  }

  function create(runtime) {
    var fs = runtime.fs;
    var path = runtime.path;
    var os = runtime.os;
    var directory = path.join(os.homedir(), "Library", "Application Support", "fnOS Bridge");
    var statePath = path.join(directory, "state.json");

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
      var latest = load();
      mutator(latest);
      return save(latest);
    }

    return {
      path: statePath,
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
