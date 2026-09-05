(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.FnOSAssetOps = api;
}(this, function () {
  "use strict";

  var TRASH_SCRIPT = [
    'ObjC.import("Foundation");',
    'function run(argv){',
    'var source=$.NSURL.fileURLWithPath(argv[0]);',
    'var resulting=$();var error=$();',
    'var ok=$.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError(source,resulting,error);',
    'return JSON.stringify({ok:Boolean(ok),out:resulting.isNil()?"":ObjC.unwrap(resulting.path),error:error.isNil()?"":ObjC.unwrap(error.localizedDescription)});',
    '}'
  ].join("");

  var RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  var INVALID_NAME = /[\x00-\x1f<>:"/\\|?*]/;

  function makeError(code, message, cause) {
    var error = new Error(message);
    error.code = code;
    if (cause) { error.cause = cause; }
    return error;
  }

  function validateLeafName(value) {
    var rawName = String(value || "");
    var name = rawName.trim();
    if (!name || name !== rawName || name === "." || name === ".." || INVALID_NAME.test(name) || /[ .]$/.test(name)) {
      throw makeError("INVALID_NAME", "名称包含 SMB 不支持的字符，或结尾为空格/句点。");
    }
    if (RESERVED_NAME.test(name)) {
      throw makeError("INVALID_NAME", "这是 Windows/SMB 保留名称，请换一个名称。");
    }
    return name;
  }

  function isInside(path, child, parent, allowEqual) {
    var relative = path.relative(parent, child);
    if (!relative) { return !!allowEqual; }
    return relative !== ".." && relative.indexOf(".." + path.sep) !== 0 && !path.isAbsolute(relative);
  }

  function create(runtime) {
    var fs = runtime.fs;
    var path = runtime.path;
    var childProcess = runtime.childProcess;
    var trashItem = runtime.trashItem || runFoundationTrash;
    var platform = runtime.platform || (typeof process !== "undefined" ? process.platform : "");
    var copyExclusiveFlag = fs.constants && typeof fs.constants.COPYFILE_EXCL === "number" ? fs.constants.COPYFILE_EXCL : 1;

    function callFs(method, args) {
      return new Promise(function (resolve, reject) {
        var callback = function (error, value) {
          if (error) { reject(error); return; }
          resolve(value);
        };
        try { fs[method].apply(fs, args.concat(callback)); }
        catch (error) { reject(error); }
      });
    }

    function lstat(filePath) { return callFs("lstat", [filePath]); }
    function realpath(filePath) { return callFs("realpath", [filePath]); }
    function mkdir(filePath) { return callFs("mkdir", [filePath]); }
    function rename(source, destination) { return callFs("rename", [source, destination]); }
    function copyFile(source, destination) { return callFs("copyFile", [source, destination, copyExclusiveFlag]); }

    function emit(onProgress, operation, phase, completed, total, extra) {
      var payload = {
        operation: operation,
        phase: phase,
        completed: completed,
        total: total
      };
      var key;
      if (extra) {
        for (key in extra) {
          if (extra.hasOwnProperty(key)) { payload[key] = extra[key]; }
        }
      }
      if (typeof onProgress === "function") {
        try { onProgress(payload); } catch (ignoreProgressError) {}
      }
    }

    function progressFailure(onProgress, operation, completed, total, error, extra) {
      var details = extra || {};
      details.error = error;
      emit(onProgress, operation, "error", completed, total, details);
      throw error;
    }

    function rootById(roots, rootId) {
      var configured = Array.isArray(roots) ? roots : [];
      var match = configured.filter(function (item) {
        return item && String(item.id) === String(rootId) && typeof item.path === "string" && item.path;
      })[0];
      if (!match) { throw makeError("ROOT_NOT_CONFIGURED", "目标不属于已配置的素材位置。"); }
      return match;
    }

    function pathExists(filePath) {
      return lstat(filePath).then(function () { return true; }, function (error) {
        if (error && error.code === "ENOENT") { return false; }
        throw error;
      });
    }

    function validateRoot(roots, rootId) {
      var configured;
      var resolved;
      try {
        configured = rootById(roots, rootId);
        resolved = path.resolve(configured.path);
      } catch (error) {
        return Promise.reject(error);
      }
      return lstat(resolved).then(function (stat) {
        if (stat.isSymbolicLink()) { throw makeError("SYMLINK_FORBIDDEN", "素材位置不能是符号链接。"); }
        if (!stat.isDirectory()) { throw makeError("ROOT_NOT_DIRECTORY", "配置的素材位置不是文件夹。"); }
        return realpath(resolved);
      }).then(function (real) {
        return { configured: configured, resolved: resolved, real: real };
      }, function (error) {
        if (error && error.code === "ENOENT") {
          throw makeError("ROOT_OFFLINE", "素材位置已离线或不存在。", error);
        }
        throw error;
      });
    }

    function assertNoSymlinkChain(rootPath, candidatePath) {
      var relative = path.relative(rootPath, candidatePath);
      var pieces = relative ? relative.split(path.sep).filter(Boolean) : [];
      var current = rootPath;
      var chain = [rootPath];
      var index;
      for (index = 0; index < pieces.length; index += 1) {
        current = path.join(current, pieces[index]);
        chain.push(current);
      }
      return chain.reduce(function (promise, itemPath) {
        return promise.then(function () {
          return lstat(itemPath).then(function (stat) {
            if (stat.isSymbolicLink()) {
              throw makeError("SYMLINK_FORBIDDEN", "操作路径不能包含符号链接。");
            }
          });
        });
      }, Promise.resolve());
    }

    function validateExisting(roots, descriptor, expectedType, allowRoot) {
      var item = descriptor || {};
      var candidate;
      var rootInfo;
      if (!item.path || !item.rootId) {
        return Promise.reject(makeError("INVALID_TARGET", "缺少路径或素材位置标识。"));
      }
      return validateRoot(roots, item.rootId).then(function (validatedRoot) {
        rootInfo = validatedRoot;
        candidate = path.resolve(String(item.path));
        if (!isInside(path, candidate, rootInfo.resolved, allowRoot)) {
          throw makeError("PATH_OUTSIDE_ROOT", "操作路径不在已授权的素材位置内。");
        }
        return assertNoSymlinkChain(rootInfo.resolved, candidate);
      }).then(function () {
        return Promise.all([lstat(candidate), realpath(candidate)]);
      }).then(function (values) {
        var stat = values[0];
        var real = values[1];
        if (!isInside(path, real, rootInfo.real, allowRoot)) {
          throw makeError("PATH_OUTSIDE_ROOT", "操作路径不在已授权的素材位置内。");
        }
        if (stat.isSymbolicLink()) { throw makeError("SYMLINK_FORBIDDEN", "不能操作符号链接。"); }
        if (expectedType === "file" && !stat.isFile()) { throw makeError("NOT_A_FILE", "只能操作普通文件。"); }
        if (expectedType === "directory" && !stat.isDirectory()) { throw makeError("NOT_A_DIRECTORY", "目标不是文件夹。"); }
        if (expectedType === "file" && typeof item.size === "number" && stat.size !== item.size) {
          throw makeError("SOURCE_CHANGED", "文件在扫描后发生过变化，请先刷新再操作。");
        }
        if (expectedType === "file" && typeof item.modifiedMs === "number" && Math.abs((stat.mtimeMs || stat.mtime.getTime()) - item.modifiedMs) > 1) {
          throw makeError("SOURCE_CHANGED", "文件在扫描后发生过变化，请先刷新再操作。");
        }
        return { descriptor: item, root: rootInfo, path: candidate, real: real, stat: stat };
      });
    }

    function validateDirectory(roots, rootId, directoryPath) {
      return validateExisting(roots, { rootId: rootId, path: directoryPath }, "directory", true);
    }

    function validateExternalFile(sourcePath) {
      var resolved = path.resolve(String(sourcePath || ""));
      if (!sourcePath) { return Promise.reject(makeError("INVALID_SOURCE", "缺少要拷贝的外部文件路径。")); }
      return lstat(resolved).then(function (stat) {
        if (stat.isSymbolicLink()) { throw makeError("SYMLINK_FORBIDDEN", "不能导入符号链接。"); }
        if (!stat.isFile()) { throw makeError("NOT_A_FILE", "只能导入普通文件。"); }
        return { path: resolved, stat: stat };
      });
    }

    function splitName(fileName) {
      var extension = path.extname(fileName);
      return { stem: extension ? fileName.slice(0, -extension.length) : fileName, extension: extension };
    }

    function numberedName(fileName, index) {
      var parts = splitName(fileName);
      return index ? parts.stem + " (" + index + ")" + parts.extension : fileName;
    }

    function duplicateName(fileName, index) {
      var parts = splitName(fileName);
      return parts.stem + " 副本" + (index ? " (" + index + ")" : "") + parts.extension;
    }

    function copyWithUniqueName(sourcePath, destinationDirectory, initialName, duplicateStyle) {
      var index = 0;
      function attempt() {
        var candidateName = duplicateStyle ? duplicateName(initialName, index) : numberedName(initialName, index);
        var destination = path.join(destinationDirectory, candidateName);
        if (!isInside(path, destination, destinationDirectory, false)) {
          return Promise.reject(makeError("PATH_OUTSIDE_ROOT", "生成的目标路径无效。"));
        }
        return copyFile(sourcePath, destination).then(function () {
          return destination;
        }, function (error) {
          if (error && error.code === "EEXIST" && index < 9999) {
            index += 1;
            return attempt();
          }
          throw error;
        });
      }
      return attempt();
    }

    function nextAvailableMovePath(destinationDirectory, fileName) {
      var index = 0;
      function attempt() {
        var candidate = path.join(destinationDirectory, numberedName(fileName, index));
        return pathExists(candidate).then(function (exists) {
          if (!exists) { return candidate; }
          if (index >= 9999) { throw makeError("TOO_MANY_COLLISIONS", "目标文件夹中的同名文件过多。"); }
          index += 1;
          return attempt();
        });
      }
      return attempt();
    }

    function runFoundationTrash(sourcePath) {
      if (!childProcess || typeof childProcess.execFile !== "function") {
        return Promise.reject(makeError("TRASH_UNAVAILABLE", "当前环境不支持可恢复的废纸篓操作。"));
      }
      return new Promise(function (resolve, reject) {
        childProcess.execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", TRASH_SCRIPT, sourcePath], { timeout: 30000 }, function (error, stdout) {
          var result;
          if (error) { reject(error); return; }
          try { result = JSON.parse(stdout); }
          catch (parseError) { reject(parseError); return; }
          if (!result.ok) { reject(makeError("TRASH_FAILED", result.error || "共享盘不支持可恢复的废纸篓操作，原文件已保留。")); return; }
          resolve(result);
        });
      });
    }

    function confirmTrashed(sourcePath, result) {
      return pathExists(sourcePath).then(function (exists) {
        if (exists) { throw makeError("TRASH_FAILED", "共享盘没有完成废纸篓操作，原文件已保留。"); }
        return result;
      });
    }

    function validateFileList(assets, roots) {
      var list = Array.isArray(assets) ? assets : [];
      var seen = {};
      var validated = [];
      return list.reduce(function (promise, asset) {
        return promise.then(function () {
          return validateExisting(roots, asset, "file", false);
        }).then(function (item) {
          var key = platform === "win32" ? item.real.toLocaleLowerCase() : item.real;
          if (!seen[key]) { seen[key] = true; validated.push(item); }
        });
      }, Promise.resolve()).then(function () { return validated; });
    }

    function createFolder(options) {
      var settings = options || {};
      var operation = "create-folder";
      var folderName;
      var destination;
      emit(settings.onProgress, operation, "start", 0, 1);
      try { folderName = validateLeafName(settings.name); }
      catch (error) {
        emit(settings.onProgress, operation, "error", 0, 1, { error: error, path: settings.parentPath });
        return Promise.reject(error);
      }
      return validateDirectory(settings.roots, settings.rootId, settings.parentPath).then(function (parent) {
        destination = path.join(parent.path, folderName);
        if (!isInside(path, destination, parent.root.resolved, false)) {
          throw makeError("PATH_OUTSIDE_ROOT", "新文件夹必须位于已授权的素材位置内。");
        }
        return mkdir(destination);
      }).then(function () {
        return lstat(destination);
      }).then(function (stat) {
        if (!stat.isDirectory() || stat.isSymbolicLink()) { throw makeError("CREATE_FAILED", "没有创建出安全的普通文件夹。"); }
        emit(settings.onProgress, operation, "item", 1, 1, { path: destination });
        emit(settings.onProgress, operation, "complete", 1, 1, { path: destination });
        return { path: destination, name: folderName };
      }).catch(function (error) {
        return progressFailure(settings.onProgress, operation, 0, 1, error, { path: destination || settings.parentPath });
      });
    }

    function copyExternalFiles(options) {
      var settings = options || {};
      var operation = "copy-external";
      var sources = Array.isArray(settings.sourcePaths) ? settings.sourcePaths : [];
      var destination;
      var validatedSources = [];
      var results = [];
      var total = sources.length;
      emit(settings.onProgress, operation, "start", 0, total);
      if (!total) {
        emit(settings.onProgress, operation, "complete", 0, 0, { results: [] });
        return Promise.resolve([]);
      }
      return validateDirectory(settings.roots, settings.rootId, settings.destinationPath).then(function (validatedDestination) {
        destination = validatedDestination;
        return sources.reduce(function (promise, sourcePath) {
          return promise.then(function () { return validateExternalFile(sourcePath); }).then(function (source) { validatedSources.push(source); });
        }, Promise.resolve());
      }).then(function () {
        return validatedSources.reduce(function (promise, source, index) {
          return promise.then(function () {
            var name = validateLeafName(path.basename(source.path));
            return copyWithUniqueName(source.path, destination.path, name, false);
          }).then(function (copiedPath) {
            var result = { sourcePath: source.path, path: copiedPath, name: path.basename(copiedPath) };
            results.push(result);
            emit(settings.onProgress, operation, "item", index + 1, total, result);
          });
        }, Promise.resolve());
      }).then(function () {
        emit(settings.onProgress, operation, "complete", total, total, { results: results });
        return results;
      }).catch(function (error) {
        error.partialResults = results;
        return progressFailure(settings.onProgress, operation, results.length, total, error, { results: results });
      });
    }

    function createCopies(options) {
      var settings = options || {};
      var operation = "create-copies";
      var results = [];
      var total = Array.isArray(settings.assets) ? settings.assets.length : 0;
      emit(settings.onProgress, operation, "start", 0, total);
      if (!total) {
        emit(settings.onProgress, operation, "complete", 0, 0, { results: [] });
        return Promise.resolve([]);
      }
      return validateFileList(settings.assets, settings.roots).then(function (assets) {
        total = assets.length;
        return assets.reduce(function (promise, asset, index) {
          return promise.then(function () {
            return copyWithUniqueName(asset.path, path.dirname(asset.path), path.basename(asset.path), true);
          }).then(function (copiedPath) {
            var result = { sourcePath: asset.path, path: copiedPath, name: path.basename(copiedPath) };
            results.push(result);
            emit(settings.onProgress, operation, "item", index + 1, total, result);
          });
        }, Promise.resolve());
      }).then(function () {
        emit(settings.onProgress, operation, "complete", total, total, { results: results });
        return results;
      }).catch(function (error) {
        error.partialResults = results;
        return progressFailure(settings.onProgress, operation, results.length, total, error, { results: results });
      });
    }

    function moveAssetsToFolder(options) {
      var settings = options || {};
      var operation = "move-assets";
      var destination;
      var results = [];
      var total = Array.isArray(settings.assets) ? settings.assets.length : 0;
      emit(settings.onProgress, operation, "start", 0, total);
      if (!total) {
        emit(settings.onProgress, operation, "complete", 0, 0, { results: [] });
        return Promise.resolve([]);
      }
      return validateDirectory(settings.roots, settings.destinationRootId, settings.destinationPath).then(function (validatedDestination) {
        destination = validatedDestination;
        return validateFileList(settings.assets, settings.roots);
      }).then(function (assets) {
        total = assets.length;
        return assets.reduce(function (promise, asset, index) {
          return promise.then(function () {
            if (path.dirname(asset.path) === destination.path) {
              return { sourcePath: asset.path, path: asset.path, name: path.basename(asset.path), changed: false };
            }
            return nextAvailableMovePath(destination.path, path.basename(asset.path)).then(function (targetPath) {
              return rename(asset.path, targetPath).then(function () {
                return { sourcePath: asset.path, path: targetPath, name: path.basename(targetPath), changed: true };
              }, function (error) {
                if (!error || error.code !== "EXDEV") { throw error; }
                return copyFile(asset.path, targetPath).then(function () {
                  return trashItem(asset.path).then(function (trashResult) {
                    return confirmTrashed(asset.path, trashResult);
                  }).then(function () {
                    return { sourcePath: asset.path, path: targetPath, name: path.basename(targetPath), changed: true, copiedAcrossVolumes: true };
                  });
                });
              });
            });
          }).then(function (result) {
            results.push(result);
            emit(settings.onProgress, operation, "item", index + 1, total, result);
          });
        }, Promise.resolve());
      }).then(function () {
        emit(settings.onProgress, operation, "complete", total, total, { results: results });
        return results;
      }).catch(function (error) {
        error.partialResults = results;
        return progressFailure(settings.onProgress, operation, results.length, total, error, { results: results });
      });
    }

    function renameFolder(options) {
      var settings = options || {};
      var operation = "rename-folder";
      var newName;
      var destination;
      emit(settings.onProgress, operation, "start", 0, 1);
      try { newName = validateLeafName(settings.newName); }
      catch (error) {
        emit(settings.onProgress, operation, "error", 0, 1, { error: error, path: settings.folder && settings.folder.path });
        return Promise.reject(error);
      }
      return validateExisting(settings.roots, settings.folder, "directory", false).then(function (folder) {
        destination = path.join(path.dirname(folder.path), newName);
        if (!isInside(path, destination, folder.root.resolved, false)) {
          throw makeError("PATH_OUTSIDE_ROOT", "重命名后的文件夹必须位于已授权的素材位置内。");
        }
        if (destination === folder.path) {
          return { path: folder.path, oldPath: folder.path, name: newName, changed: false };
        }
        return pathExists(destination).then(function (exists) {
          if (exists) {
            if (path.basename(folder.path).toLocaleLowerCase() !== newName.toLocaleLowerCase()) {
              throw makeError("DESTINATION_EXISTS", "同一位置已存在同名文件夹。");
            }
            return Promise.all([lstat(destination), realpath(destination)]).then(function (values) {
              var destinationStat = values[0];
              var destinationReal = values[1];
              var sameInode = folder.stat.ino && destinationStat.ino && folder.stat.ino === destinationStat.ino && folder.stat.dev === destinationStat.dev;
              if (!sameInode && destinationReal !== folder.real) {
                throw makeError("DESTINATION_EXISTS", "同一位置已存在同名文件夹。");
              }
              return rename(folder.path, destination).then(function () {
                return { path: destination, oldPath: folder.path, name: newName, changed: true };
              });
            });
          }
          return rename(folder.path, destination).then(function () {
            return { path: destination, oldPath: folder.path, name: newName, changed: true };
          });
        });
      }).then(function (result) {
        emit(settings.onProgress, operation, "item", 1, 1, result);
        emit(settings.onProgress, operation, "complete", 1, 1, result);
        return result;
      }).catch(function (error) {
        return progressFailure(settings.onProgress, operation, 0, 1, error, { path: destination || (settings.folder && settings.folder.path) });
      });
    }

    function moveToTrash(options) {
      var settings = options || {};
      var operation = "trash";
      var targets = Array.isArray(settings.targets) ? settings.targets : [];
      var validated = [];
      var results = [];
      var seen = {};
      var total = targets.length;
      emit(settings.onProgress, operation, "start", 0, total);
      if (!total) {
        emit(settings.onProgress, operation, "complete", 0, 0, { results: [] });
        return Promise.resolve([]);
      }
      return targets.reduce(function (promise, target) {
        return promise.then(function () {
          return validateExisting(settings.roots, target, null, false);
        }).then(function (item) {
          var key;
          if (!item.stat.isFile() && !item.stat.isDirectory()) { throw makeError("INVALID_TARGET", "只能将普通文件或文件夹移到废纸篓。"); }
          key = platform === "win32" ? item.real.toLocaleLowerCase() : item.real;
          if (!seen[key]) { seen[key] = true; validated.push(item); }
        });
      }, Promise.resolve()).then(function () {
        total = validated.length;
        return validated.reduce(function (promise, item, index) {
          return promise.then(function () {
            return trashItem(item.path).then(function (trashResult) {
              return confirmTrashed(item.path, trashResult);
            });
          }).then(function (trashResult) {
            var result = { sourcePath: item.path, trashPath: trashResult && trashResult.out || "" };
            results.push(result);
            emit(settings.onProgress, operation, "item", index + 1, total, result);
          });
        }, Promise.resolve());
      }).then(function () {
        emit(settings.onProgress, operation, "complete", total, total, { results: results });
        return results;
      }).catch(function (error) {
        error.partialResults = results;
        return progressFailure(settings.onProgress, operation, results.length, total, error, { results: results });
      });
    }

    return {
      createFolder: createFolder,
      copyExternalFiles: copyExternalFiles,
      createCopies: createCopies,
      moveAssetsToFolder: moveAssetsToFolder,
      renameFolder: renameFolder,
      moveToTrash: moveToTrash
    };
  }

  return {
    create: create,
    validateLeafName: validateLeafName,
    TRASH_SCRIPT: TRASH_SCRIPT
  };
}));
