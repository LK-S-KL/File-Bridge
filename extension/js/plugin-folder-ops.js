(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.FnOSPluginFolderOps = api;
}(this, function () {
  "use strict";

  var ROOT_SCOPE = "";

  function makeError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function normalizeKey(value, options) {
    var key = String(value || "").replace(/\\/g, "/");
    return options && options.caseInsensitive ? key.toLocaleLowerCase() : key;
  }

  function uniqueKeys(values, options) {
    var seen = {};
    var keys = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var key = normalizeKey(value, options);
      if (!key || seen[key]) { return; }
      seen[key] = true;
      keys.push(key);
    });
    return keys;
  }

  function cloneFolder(folder, options) {
    return {
      id: String(folder && folder.id || ""),
      name: String(folder && folder.name || ""),
      parentId: String(folder && folder.parentId || ""),
      assetKeys: uniqueKeys(folder && folder.assetKeys, options)
    };
  }

  function normalizeModel(input, options) {
    var source = input || {};
    return {
      pluginFolders: (Array.isArray(source.pluginFolders) ? source.pluginFolders : []).filter(function (folder) {
        return folder && typeof folder.id === "string" && folder.id.length;
      }).map(function (folder) { return cloneFolder(folder, options); }),
      pluginRootAssetKeys: uniqueKeys(source.pluginRootAssetKeys, options)
    };
  }

  function normalizeScopeId(value) {
    return value === null || typeof value === "undefined" ? ROOT_SCOPE : String(value);
  }

  function folderById(model, folderId) {
    var id = normalizeScopeId(folderId);
    var i;
    for (i = 0; i < model.pluginFolders.length; i += 1) {
      if (model.pluginFolders[i].id === id) { return model.pluginFolders[i]; }
    }
    return null;
  }

  function hasKey(values, key) {
    return values.indexOf(key) !== -1;
  }

  function addKey(values, key) {
    if (hasKey(values, key)) { return false; }
    values.push(key);
    return true;
  }

  function removeKey(values, key) {
    var index = values.indexOf(key);
    if (index === -1) { return false; }
    values.splice(index, 1);
    return true;
  }

  function keyInAnyFolder(model, key) {
    return model.pluginFolders.some(function (folder) { return hasKey(folder.assetKeys, key); });
  }

  function isVisibleInScope(input, assetKey, folderId, options) {
    var model = normalizeModel(input, options);
    var key = normalizeKey(assetKey, options);
    var scopeId = normalizeScopeId(folderId);
    var folder;
    if (!key) { return false; }
    if (scopeId === ROOT_SCOPE) {
      return hasKey(model.pluginRootAssetKeys, key) || !keyInAnyFolder(model, key);
    }
    folder = folderById(model, scopeId);
    return !!folder && hasKey(folder.assetKeys, key);
  }

  function makeClipboard(mode, assetKeys, sourceFolderId, options) {
    var normalizedMode = mode === "copy" ? "copy" : mode === "cut" ? "cut" : "";
    return {
      mode: normalizedMode,
      assetKeys: normalizedMode ? uniqueKeys(assetKeys, options) : [],
      sourceFolderId: normalizedMode ? normalizeScopeId(sourceFolderId) : ROOT_SCOPE
    };
  }

  function emptyClipboard() {
    return makeClipboard("", [], ROOT_SCOPE);
  }

  function ensureFolder(model, folderId) {
    var id = normalizeScopeId(folderId);
    var folder;
    if (id === ROOT_SCOPE) { return null; }
    folder = folderById(model, id);
    if (!folder) { throw makeError("TARGET_FOLDER_NOT_FOUND", "目标插件文件夹不存在。"); }
    return folder;
  }

  function addToScope(model, folderId, key) {
    var id = normalizeScopeId(folderId);
    var folder;
    if (id === ROOT_SCOPE) {
      if (!keyInAnyFolder(model, key)) { return false; }
      return addKey(model.pluginRootAssetKeys, key);
    }
    folder = ensureFolder(model, id);
    return addKey(folder.assetKeys, key);
  }

  function removeFromScope(model, folderId, key) {
    var id = normalizeScopeId(folderId);
    var folder;
    if (id === ROOT_SCOPE) { return removeKey(model.pluginRootAssetKeys, key); }
    folder = folderById(model, id);
    return folder ? removeKey(folder.assetKeys, key) : false;
  }

  function compactRootKeys(model) {
    model.pluginRootAssetKeys = model.pluginRootAssetKeys.filter(function (key) {
      return keyInAnyFolder(model, key);
    });
  }

  function paste(input, clipboardInput, targetFolderId, options) {
    var model = normalizeModel(input, options);
    var clipboard = makeClipboard(clipboardInput && clipboardInput.mode, clipboardInput && clipboardInput.assetKeys, clipboardInput && clipboardInput.sourceFolderId, options);
    var targetId = normalizeScopeId(targetFolderId);
    var sourceId = clipboard.sourceFolderId;
    var changedKeys = [];
    var unchangedKeys = [];
    var available = options && Array.isArray(options.availableAssetKeys) ? uniqueKeys(options.availableAssetKeys, options) : null;
    var missingKeys = [];

    if (!clipboard.mode || !clipboard.assetKeys.length) {
      return { pluginFolders: model.pluginFolders, pluginRootAssetKeys: model.pluginRootAssetKeys, clipboard: clipboard, changed: false, changedAssetKeys: [], unchangedAssetKeys: [], missingAssetKeys: [] };
    }
    ensureFolder(model, targetId);

    clipboard.assetKeys.forEach(function (key) {
      var changed = false;
      if (available && !hasKey(available, key)) { missingKeys.push(key); return; }
      if (sourceId === targetId) { unchangedKeys.push(key); return; }

      if (clipboard.mode === "copy") {
        if (targetId === ROOT_SCOPE) {
          changed = addToScope(model, ROOT_SCOPE, key);
        } else {
          changed = addToScope(model, targetId, key);
          if (sourceId === ROOT_SCOPE) { changed = addKey(model.pluginRootAssetKeys, key) || changed; }
        }
      } else {
        changed = removeFromScope(model, sourceId, key) || changed;
        if (targetId === ROOT_SCOPE) {
          changed = addToScope(model, ROOT_SCOPE, key) || changed;
        } else {
          changed = addToScope(model, targetId, key) || changed;
        }
      }

      if (changed) { changedKeys.push(key); }
      else { unchangedKeys.push(key); }
    });

    compactRootKeys(model);
    return {
      pluginFolders: model.pluginFolders,
      pluginRootAssetKeys: model.pluginRootAssetKeys,
      clipboard: clipboard.mode === "cut" ? (missingKeys.length ? makeClipboard("cut", missingKeys, sourceId, options) : emptyClipboard()) : clipboard,
      changed: changedKeys.length > 0,
      changedAssetKeys: changedKeys,
      unchangedAssetKeys: unchangedKeys,
      missingAssetKeys: missingKeys
    };
  }

  function migrateAssetKey(input, oldValue, newValue, options) {
    var model = normalizeModel(input, options);
    var oldKey = normalizeKey(oldValue, options);
    var newKey = normalizeKey(newValue, options);
    var changed = false;
    if (!oldKey || !newKey || oldKey === newKey) {
      return { pluginFolders: model.pluginFolders, pluginRootAssetKeys: model.pluginRootAssetKeys, changed: false };
    }
    model.pluginFolders.forEach(function (folder) {
      if (removeKey(folder.assetKeys, oldKey)) { addKey(folder.assetKeys, newKey); changed = true; }
    });
    if (removeKey(model.pluginRootAssetKeys, oldKey)) { addKey(model.pluginRootAssetKeys, newKey); changed = true; }
    compactRootKeys(model);
    return { pluginFolders: model.pluginFolders, pluginRootAssetKeys: model.pluginRootAssetKeys, changed: changed };
  }

  function forgetAssetKeys(input, assetKeys, options) {
    var model = normalizeModel(input, options);
    var keys = uniqueKeys(assetKeys, options);
    var changed = false;
    model.pluginFolders.forEach(function (folder) {
      keys.forEach(function (key) { changed = removeKey(folder.assetKeys, key) || changed; });
    });
    keys.forEach(function (key) { changed = removeKey(model.pluginRootAssetKeys, key) || changed; });
    return { pluginFolders: model.pluginFolders, pluginRootAssetKeys: model.pluginRootAssetKeys, changed: changed };
  }

  return {
    ROOT_SCOPE: ROOT_SCOPE,
    normalizeKey: normalizeKey,
    normalizeModel: normalizeModel,
    makeClipboard: makeClipboard,
    emptyClipboard: emptyClipboard,
    isVisibleInScope: isVisibleInScope,
    paste: paste,
    migrateAssetKey: migrateAssetKey,
    forgetAssetKeys: forgetAssetKeys
  };
}));
