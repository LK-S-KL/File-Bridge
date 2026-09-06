(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.FnOSProjectPackager = api;
}(this, function () {
  "use strict";

  var MANIFEST_FILENAME = "LK-File-Bridge-package.json";
  var OPERATION = "package-project";

  function codedError(code, message, cause) {
    var error = new Error(message);
    error.code = code;
    if (cause) { error.cause = cause; }
    return error;
  }

  function safeSegment(value, fallback) {
    var result = String(value || "")
      .replace(/[\x00-\x1f<>:"/\\|?*]/g, "-")
      .replace(/[ .]+$/g, "")
      .replace(/^\s+|\s+$/g, "")
      .replace(/\s+/g, " ");
    if (!result || result === "." || result === "..") { result = fallback; }
    return result.slice(0, 80);
  }

  function pathKey(path, value, platform) {
    var resolved = path.resolve(String(value || ""));
    /* The CEP target is commonly macOS on a case-insensitive volume. Treat
       planned destination names case-insensitively there so two clips such
       as A.MP4/a.mp4 never race into the same output path. */
    return platform === "win32" || platform === "darwin" ? resolved.toLowerCase() : resolved;
  }

  function isInside(path, child, rootPath) {
    var relative = path.relative(rootPath, child);
    return !!relative && relative !== ".." && relative.indexOf(".." + path.sep) !== 0 && !path.isAbsolute(relative);
  }

  function isInsideOrEqual(path, child, rootPath) {
    return path.resolve(child) === path.resolve(rootPath) || isInside(path, child, rootPath);
  }

  function normalizeRoots(path, roots, platform) {
    var seen = {};
    var normalized = [];
    (roots || []).forEach(function (root, index) {
      var rootPath;
      var key;
      if (!root || typeof root.path !== "string" || !path.isAbsolute(root.path) || root.path.indexOf("\u0000") !== -1) { return; }
      rootPath = path.resolve(root.path);
      key = pathKey(path, rootPath, platform);
      if (seen[key]) { return; }
      seen[key] = true;
      normalized.push({
        id: String(root.id || "root-" + (index + 1)),
        path: rootPath,
        label: String(root.label || path.basename(rootPath) || "Media " + (index + 1)),
        packageFolder: (normalized.length + 1 < 10 ? "0" : "") + (normalized.length + 1) + "-" + safeSegment(root.label || path.basename(rootPath), "Media")
      });
    });
    if (!normalized.length) { throw codedError("INVALID_ROOTS", "至少需要一个有效的素材位置。"); }
    return normalized;
  }

  function flatName(path, sourcePath, seen, platform) {
    var original = safeSegment(path.basename(sourcePath), "media");
    var extension = path.extname(original);
    var stem = extension ? original.slice(0, -extension.length) : original;
    var candidate = original;
    var index = 2;
    var key = pathKey(path, candidate, platform);
    while (seen[key] || candidate === MANIFEST_FILENAME) {
      candidate = stem + "-" + index + extension;
      key = pathKey(path, candidate, platform);
      index += 1;
    }
    seen[key] = true;
    return candidate;
  }

  function findRoot(path, item, roots) {
    var sourcePath = path.resolve(item.path);
    var preferred = null;
    var match = null;
    roots.forEach(function (root) {
      if (root.id === item.rootId && isInside(path, sourcePath, root.path)) { preferred = root; }
      if (isInside(path, sourcePath, root.path) && (!match || root.path.length > match.path.length)) { match = root; }
    });
    return preferred || match;
  }

  function emit(onProgress, payload) {
    payload.operation = OPERATION;
    if (typeof onProgress === "function") {
      try { onProgress(payload); } catch (ignoreProgressHandlerError) {}
    }
  }

  function serializeError(error) {
    return {
      code: String(error && error.code || "COPY_FAILED"),
      message: String(error && error.message || error || "未知错误")
    };
  }

  function create(runtime) {
    var fs = runtime.fs;
    var path = runtime.path;
    var platform = runtime.platform || (runtime.process && runtime.process.platform) || (typeof process !== "undefined" ? process.platform : "darwin");
    var now = runtime.now || function () { return new Date(); };

    function cancelled(options) {
      return !!((options.signal && options.signal.aborted) || (typeof options.isCancelled === "function" && options.isCancelled()));
    }

    function throwIfCancelled(options) {
      if (cancelled(options)) { throw codedError("PACKAGING_CANCELLED", "项目素材打包已取消。"); }
    }

    function callbackPromise(invoker) {
      return new Promise(function (resolve, reject) {
        invoker(function (error, value) {
          if (error) { reject(error); } else { resolve(value); }
        });
      });
    }

    function realpath(value) {
      return callbackPromise(function (done) { fs.realpath(value, done); });
    }

    function lstat(value) {
      return callbackPromise(function (done) { fs.lstat(value, done); });
    }

    function stat(value) {
      return callbackPromise(function (done) { fs.stat(value, done); });
    }

    function mkdir(value) {
      return callbackPromise(function (done) { fs.mkdir(value, { recursive: true }, function (error) { done(error); }); });
    }

    function mkdirSingle(value) {
      return callbackPromise(function (done) {
        fs.mkdir(value, function (error) {
          if (error && error.code !== "EEXIST") { done(error); } else { done(null, !error); }
        });
      });
    }

    function writeFileExclusive(value, contents) {
      return callbackPromise(function (done) { fs.writeFile(value, contents, { encoding: "utf8", flag: "wx", mode: 0o600 }, function (error) { done(error); }); });
    }

    function unlinkCreated(value) {
      return callbackPromise(function (done) {
        fs.unlink(value, function (error) {
          if (error && error.code !== "ENOENT") { done(error); } else { done(null); }
        });
      });
    }

    function preserveTimes(value, sourceStat) {
      return callbackPromise(function (done) {
        fs.utimes(value, sourceStat.atime, sourceStat.mtime, function (error) { done(error); });
      }).catch(function () {
        return null;
      });
    }

    function rootState(root) {
      return realpath(root.path).then(function (rootRealPath) {
        return { root: root, realPath: rootRealPath, available: true };
      }, function (error) {
        return { root: root, realPath: "", available: false, error: error };
      });
    }

    function classifyMedia(media, roots, options) {
      var lexicalSeen = {};
      var candidates = [];
      var skipped = [];
      var duplicatesRemoved = 0;
      (media || []).forEach(function (item, index) {
        var sourcePath;
        var key;
        var rootMatch;
        var relativePath;
        if (!item || typeof item.path !== "string" || !path.isAbsolute(item.path) || item.path.indexOf("\u0000") !== -1) {
          skipped.push({ path: item && item.path ? String(item.path) : "", reason: "INVALID_PATH" });
          return;
        }
        sourcePath = path.resolve(item.path);
        key = pathKey(path, sourcePath, platform);
        if (lexicalSeen[key]) {
          duplicatesRemoved += 1;
          return;
        }
        lexicalSeen[key] = true;
        rootMatch = findRoot(path, { path: sourcePath, rootId: item.rootId }, roots);
        if (!rootMatch) {
          skipped.push({ path: sourcePath, reason: "OUT_OF_SCOPE" });
          return;
        }
        relativePath = path.relative(rootMatch.path, sourcePath);
        if (!relativePath || relativePath === ".." || relativePath.indexOf(".." + path.sep) === 0 || path.isAbsolute(relativePath)) {
          skipped.push({ path: sourcePath, reason: "UNSAFE_RELATIVE_PATH" });
          return;
        }
        candidates.push({
          sourcePath: sourcePath,
          root: rootMatch,
          relativePath: relativePath,
          hostReportedOffline: item.offline === true,
          clipCount: Number(item.clipCount) || 0,
          videoUses: Number(item.videoUses) || 0,
          audioUses: Number(item.audioUses) || 0,
          sequences: item.sequences instanceof Array ? item.sequences.slice() : [],
          pluginGenerated: item.pluginGenerated === true,
          sourceKind: String(item.sourceKind || "media"),
          sourceIndex: index
        });
      });
      return { candidates: candidates, skipped: skipped, duplicatesRemoved: duplicatesRemoved };
    }

    function prepare(options) {
      var roots;
      var classified;
      var rootStatesById = {};
      var inspected = [];
      var offline = [];
      var skipped;
      var realSeen = {};
      var destinationSeen = {};
      var completed = 0;

      options = options || {};
      var rootInputs = Array.isArray(options.roots) ? options.roots.slice() : [];
      var extraRoots = Array.isArray(options.extraRoots) ? options.extraRoots : [];
      extraRoots.forEach(function (root) { rootInputs.push(root); });
      /* Plugin-generated files (for example project screenshots) are allowed
         to contribute their explicitly reported root without scanning it. */
      if (Array.isArray(options.media)) {
        options.media.forEach(function (item) {
          if (!item || item.pluginGenerated !== true || typeof item.rootPath !== "string") { return; }
          rootInputs.push({ id: item.rootId, path: item.rootPath, label: item.rootLabel || "Plugin files" });
        });
      }
      roots = normalizeRoots(path, rootInputs, platform);
      if (!(options.media instanceof Array)) { return Promise.reject(codedError("INVALID_MEDIA_LIST", "Premiere 时间线素材清单无效。")); }
      classified = classifyMedia(options.media, roots, options);
      skipped = classified.skipped.slice();
      emit(options.onProgress, { phase: "inspect", completed: 0, total: classified.candidates.length, percent: 0 });

      return Promise.all(roots.map(function (root) {
        return rootState(root).then(function (state) {
          rootStatesById[root.id + "\u0000" + root.path] = state;
          return state;
        });
      })).then(function () {
        var chain = Promise.resolve();
        classified.candidates.forEach(function (candidate) {
          chain = chain.then(function () {
            var state = rootStatesById[candidate.root.id + "\u0000" + candidate.root.path];
            var sourceStat;
            var sourceRealPath;
            var destinationRelativePath;
            var destinationKey;
            throwIfCancelled(options);
            if (!state || !state.available) {
              offline.push({ path: candidate.sourcePath, rootId: candidate.root.id, reason: "ROOT_UNAVAILABLE", hostReportedOffline: candidate.hostReportedOffline });
              return null;
            }
            return lstat(candidate.sourcePath).then(function (value) {
              sourceStat = value;
              if (sourceStat.isSymbolicLink()) { throw codedError("SYMLINK_SOURCE", "为避免越界，打包不会复制符号链接素材。"); }
              if (!sourceStat.isFile()) { throw codedError("NOT_A_FILE", "素材不是普通文件。"); }
              return realpath(candidate.sourcePath);
            }).then(function (value) {
              sourceRealPath = value;
              if (!isInside(path, sourceRealPath, state.realPath)) { throw codedError("REALPATH_OUT_OF_SCOPE", "素材真实路径不在已授权位置内。"); }
              if (realSeen[pathKey(path, sourceRealPath, platform)]) {
                classified.duplicatesRemoved += 1;
                return null;
              }
              realSeen[pathKey(path, sourceRealPath, platform)] = true;
              destinationRelativePath = options.flatten === false ? path.join("Media", candidate.root.packageFolder, candidate.relativePath) : flatName(path, candidate.sourcePath, destinationSeen, platform);
              destinationKey = pathKey(path, destinationRelativePath, platform);
              if (options.flatten === false && destinationSeen[destinationKey]) {
                throw codedError("DESTINATION_COLLISION", "两个素材会写入同一个打包位置。");
              }
              destinationSeen[destinationKey] = true;
              inspected.push({
                sourcePath: candidate.sourcePath,
                sourceRealPath: sourceRealPath,
                rootId: candidate.root.id,
                rootPath: candidate.root.path,
                rootLabel: candidate.root.label,
                relativePath: candidate.relativePath,
                destinationRelativePath: destinationRelativePath,
                size: Number(sourceStat.size) || 0,
                modifiedMs: Number(sourceStat.mtimeMs) || Number(sourceStat.mtime) || 0,
                sourceStat: sourceStat,
                hostReportedOffline: candidate.hostReportedOffline,
                clipCount: candidate.clipCount,
                videoUses: candidate.videoUses,
                audioUses: candidate.audioUses,
                sequences: candidate.sequences,
                pluginGenerated: candidate.pluginGenerated,
                sourceKind: candidate.sourceKind
              });
              return null;
            }).catch(function (error) {
              var reason = error && error.code;
              if (reason === "ENOENT" || reason === "ENOTDIR" || reason === "EIO" || reason === "ENXIO" || reason === "ESTALE") {
                offline.push({ path: candidate.sourcePath, rootId: candidate.root.id, reason: "SOURCE_UNAVAILABLE", hostReportedOffline: candidate.hostReportedOffline });
              } else {
                skipped.push({ path: candidate.sourcePath, rootId: candidate.root.id, reason: reason || "SOURCE_REJECTED", message: String(error && error.message || error) });
              }
              return null;
            });
          }).then(function () {
            completed += 1;
            emit(options.onProgress, {
              phase: "inspect",
              completed: completed,
              total: classified.candidates.length,
              percent: classified.candidates.length ? completed / classified.candidates.length : 1
            });
          });
        });
        return chain;
      }).then(function () {
        inspected.sort(function (first, second) {
          return first.destinationRelativePath < second.destinationRelativePath ? -1 : (first.destinationRelativePath > second.destinationRelativePath ? 1 : 0);
        });
        return {
          roots: roots,
          files: inspected,
          offline: offline,
          skipped: skipped,
          duplicatesRemoved: classified.duplicatesRemoved,
          totalBytes: inspected.reduce(function (total, file) { return total + file.size; }, 0)
        };
      });
    }

    function ensureDestination(destination, created) {
      var destinationPath;
      var existed = false;
      if (typeof destination !== "string" || !path.isAbsolute(destination) || destination.indexOf("\u0000") !== -1) {
        return Promise.reject(codedError("INVALID_DESTINATION", "请选择一个有效的绝对路径作为打包位置。"));
      }
      destinationPath = path.resolve(destination);
      return lstat(destinationPath).then(function () { existed = true; }, function (error) {
        if (!error || error.code !== "ENOENT") { throw error; }
      }).then(function () { return mkdir(destinationPath); }).then(function () {
        if (!existed) { return lstat(destinationPath).then(function (entryStat) { created.push({ path: destinationPath, stat: entryStat, directory: true }); }); }
        return null;
      }).then(function () {
        return realpath(destinationPath);
      }).then(function (destinationRealPath) {
        var manifestPath = path.join(destinationPath, MANIFEST_FILENAME);
        return lstat(manifestPath).then(function () {
          throw codedError("PACKAGE_EXISTS", "所选文件夹中已经存在 LK‘s File Bridge 打包清单，请选择一个新文件夹。");
        }, function (error) {
          if (error && error.code !== "ENOENT") { throw error; }
          return { path: destinationPath, realPath: destinationRealPath };
        });
      });
    }

    function ensureSafeParent(destinationState, targetPath, created) {
      var parentPath = path.dirname(targetPath);
      var relativeParent;
      var segments;
      var currentPath;
      var chain;
      if (!isInside(path, targetPath, destinationState.path)) {
        return Promise.reject(codedError("UNSAFE_DESTINATION", "打包目标越出了所选文件夹。"));
      }
      relativeParent = path.relative(destinationState.path, parentPath);
      if (relativeParent === ".." || relativeParent.indexOf(".." + path.sep) === 0 || path.isAbsolute(relativeParent)) {
        return Promise.reject(codedError("UNSAFE_DESTINATION", "打包目标越出了所选文件夹。"));
      }
      segments = relativeParent ? relativeParent.split(path.sep) : [];
      currentPath = destinationState.path;
      chain = Promise.resolve();
      segments.forEach(function (segment) {
        chain = chain.then(function () {
          currentPath = path.join(currentPath, segment);
          return lstat(currentPath).then(function (entryStat) {
            if (entryStat.isSymbolicLink()) { throw codedError("DESTINATION_SYMLINK_ESCAPE", "打包目录包含符号链接，已停止写入。"); }
            if (!entryStat.isDirectory()) { throw codedError("DESTINATION_NOT_DIRECTORY", "打包路径中存在同名文件。"); }
            return null;
          }, function (error) {
            if (!error || error.code !== "ENOENT") { throw error; }
            var wasCreated = false;
            return mkdirSingle(currentPath).then(function (made) { wasCreated = made; return lstat(currentPath); }).then(function (entryStat) {
              if (entryStat.isSymbolicLink() || !entryStat.isDirectory()) {
                throw codedError("DESTINATION_SYMLINK_ESCAPE", "打包目录不安全，已停止写入。");
              }
              if (wasCreated) { created.push({ path: currentPath, stat: entryStat, directory: true }); }
              return null;
            });
          });
        });
      });
      return chain.then(function () { return realpath(parentPath); }).then(function (parentRealPath) {
        if (!isInsideOrEqual(path, parentRealPath, destinationState.realPath)) {
          throw codedError("DESTINATION_SYMLINK_ESCAPE", "打包目录包含指向外部位置的符号链接。");
        }
        return parentPath;
      });
    }

    function copyWithProgress(source, destination, sourceStat, progress, options, created) {
      return new Promise(function (resolve, reject) {
        var readStream;
        var writeStream;
        var transferred = 0;
        var lastReportedAt = 0;
        var settled = false;
        var opened = false;
        var cancelTimer;

        function stopCancellationWatch() {
          if (cancelTimer) { clearInterval(cancelTimer); cancelTimer = null; }
        }

        function cleanupAndReject(error) {
          function removePartialCopy() {
            fs.unlink(destination, function (cleanupError) {
              if (cleanupError && cleanupError.code !== "ENOENT") { error.residualPaths = [destination]; }
              reject(error);
            });
          }
          if (settled) { return; }
          settled = true;
          stopCancellationWatch();
          if (readStream) { readStream.destroy(); }
          if (!opened) { reject(error); return; }
          if (writeStream) {
            writeStream.once("close", removePartialCopy);
            writeStream.destroy();
          } else {
            removePartialCopy();
          }
        }

        throwIfCancelled(options);
        fs.open(destination, "wx", sourceStat.mode & 0o666, function (openError, fileDescriptor) {
          if (openError) { cleanupAndReject(openError); return; }
          opened = true;
          if (cancelled(options)) {
            fs.close(fileDescriptor, function () { cleanupAndReject(codedError("PACKAGING_CANCELLED", "项目素材打包已取消。")); });
            return;
          }
          fs.fstat(fileDescriptor, function (statError, destinationStat) {
            if (statError) { fs.close(fileDescriptor, function () { cleanupAndReject(statError); }); return; }
            created.push({ path: destination, stat: destinationStat, directory: false });
            readStream = fs.createReadStream(source);
            writeStream = fs.createWriteStream(destination, { fd: fileDescriptor, autoClose: true });
            cancelTimer = setInterval(function () {
              if (cancelled(options)) { cleanupAndReject(codedError("PACKAGING_CANCELLED", "项目素材打包已取消。")); }
            }, 100);
            readStream.on("data", function (chunk) {
              var currentTime = Date.now();
              transferred += chunk.length;
              if (cancelled(options)) {
                cleanupAndReject(codedError("PACKAGING_CANCELLED", "项目素材打包已取消。"));
                return;
              }
              if (currentTime - lastReportedAt >= 100 || transferred === sourceStat.size) {
                lastReportedAt = currentTime;
                progress(transferred);
              }
            });
            readStream.on("error", cleanupAndReject);
            writeStream.on("error", cleanupAndReject);
            writeStream.on("finish", function () {
              if (settled) { return; }
              settled = true;
              stopCancellationWatch();
              progress(transferred);
              preserveTimes(destination, sourceStat).then(function () { resolve(transferred); });
            });
            readStream.pipe(writeStream);
          });
        });
      });
    }

    function rollbackCreated(created, error, destination) {
      var recovery = { destination: destination || "", removed: [], retained: [] };
      return created.slice().reverse().reduce(function (promise, entry) {
        return promise.then(function () {
          return lstat(entry.path).then(function (currentStat) {
            if (!entry.stat.ino || entry.stat.ino !== currentStat.ino || entry.stat.dev !== currentStat.dev || currentStat.isSymbolicLink()) {
              throw codedError("OUTPUT_CHANGED", "目标已被替换，已保留供检查。");
            }
            return callbackPromise(function (done) { fs[entry.directory ? "rmdir" : "unlink"](entry.path, done); });
          }).then(function () { recovery.removed.push(entry.path); }, function (cleanupError) {
            if (cleanupError && cleanupError.code === "ENOENT") { return; }
            recovery.retained.push({ path: entry.path, error: serializeError(cleanupError) });
          });
        });
      }, Promise.resolve()).then(function () {
        recovery.complete = recovery.retained.length === 0;
        error.recovery = recovery;
        throw error;
      });
    }

    function manifestFrom(options, plan, copied, failed, destinationState) {
      var project = options.project || {};
      var generated = now();
      return {
        schemaVersion: 1,
        generator: "LK‘s File Bridge",
        generatedAt: generated && typeof generated.toISOString === "function" ? generated.toISOString() : String(generated),
        project: {
          name: String(project.projectName || options.projectName || "Premiere Project"),
          sequencesScanned: Number(project.sequencesScanned) || 0,
          trackItemsScanned: Number(project.trackItemsScanned) || 0
        },
        layout: options.flatten === false ? "preserve" : "flat",
        packageRoot: destinationState.path,
        roots: plan.roots.map(function (root) {
          return { id: root.id, sourcePath: root.path, packageFolder: options.flatten === false ? path.join("Media", root.packageFolder) : "" };
        }),
        summary: {
          listedByPremiere: options.media.length,
          copied: copied.length,
          offline: plan.offline.length,
          skipped: plan.skipped.length,
          failed: failed.length,
          duplicatesRemoved: plan.duplicatesRemoved,
          bytesCopied: copied.reduce(function (total, item) { return total + item.size; }, 0)
        },
        media: copied,
        offline: plan.offline,
        skipped: plan.skipped,
        failed: failed
      };
    }

    function packageProject(options) {
      var destinationState;
      var plan;
      var copied = [];
      var failed = [];
      var copiedBytes = 0;
      var completedFiles = 0;
      var manifest;
      var manifestPath;
      var created = [];

      options = options || {};
      emit(options.onProgress, { phase: "start", completed: 0, total: options.media instanceof Array ? options.media.length : 0, percent: 0 });
      return prepare(options).then(function (prepared) {
        plan = prepared;
        throwIfCancelled(options);
        return ensureDestination(options.destination, created);
      }).then(function (preparedDestination) {
        var chain = Promise.resolve();
        destinationState = preparedDestination;
        plan.files.forEach(function (file) {
          chain = chain.then(function () {
            var destinationPath = path.resolve(destinationState.path, file.destinationRelativePath);
            var lastFileBytes = 0;
            var copiedToDestination = false;
            throwIfCancelled(options);
            return ensureSafeParent(destinationState, destinationPath, created).then(function () {
              emit(options.onProgress, {
                phase: "copy",
                completed: completedFiles,
                total: plan.files.length,
                bytesCompleted: copiedBytes,
                totalBytes: plan.totalBytes,
                percent: plan.totalBytes ? copiedBytes / plan.totalBytes : (plan.files.length ? completedFiles / plan.files.length : 1),
                currentPath: file.sourcePath
              });
              return copyWithProgress(file.sourcePath, destinationPath, file.sourceStat, function (fileBytes) {
                lastFileBytes = fileBytes;
                emit(options.onProgress, {
                  phase: "copy",
                  completed: completedFiles,
                  total: plan.files.length,
                  bytesCompleted: copiedBytes + fileBytes,
                  totalBytes: plan.totalBytes,
                  percent: plan.totalBytes ? (copiedBytes + fileBytes) / plan.totalBytes : 0,
                  currentPath: file.sourcePath
                });
              }, options, created).then(function (transferred) {
                copiedToDestination = true;
                return transferred;
              });
            }).then(function () {
              return stat(file.sourcePath);
            }).then(function (afterStat) {
              if (Number(afterStat.size) !== Number(file.sourceStat.size) || Math.abs(Number(afterStat.mtimeMs) - Number(file.sourceStat.mtimeMs)) > 1) {
                throw codedError("SOURCE_CHANGED", "素材在复制过程中发生变化，请重新打包。");
              }
              copiedBytes += file.size;
              completedFiles += 1;
              copied.push({
                sourcePath: file.sourcePath,
                packagedPath: file.destinationRelativePath,
                rootId: file.rootId,
                size: file.size,
                modifiedMs: file.modifiedMs,
                clipCount: file.clipCount,
                videoUses: file.videoUses,
                audioUses: file.audioUses,
                sequences: file.sequences,
                pluginGenerated: file.pluginGenerated,
                sourceKind: file.sourceKind
              });
              return null;
            }).catch(function (error) {
              if (error && error.code === "PACKAGING_CANCELLED") { throw error; }
              function recordFailure() {
                completedFiles += 1;
                failed.push({ path: file.sourcePath, destination: file.destinationRelativePath, error: serializeError(error), transferredBytes: lastFileBytes });
                return null;
              }
              if (copiedToDestination) {
                return unlinkCreated(destinationPath).then(recordFailure, recordFailure);
              }
              return recordFailure();
            });
          });
        });
        return chain;
      }).then(function () {
        throwIfCancelled(options);
        manifest = manifestFrom(options, plan, copied, failed, destinationState);
        manifestPath = path.join(destinationState.path, MANIFEST_FILENAME);
        emit(options.onProgress, {
          phase: "manifest",
          completed: completedFiles,
          total: plan.files.length,
          bytesCompleted: copiedBytes,
          totalBytes: plan.totalBytes,
          percent: 1
        });
        throwIfCancelled(options);
        return writeFileExclusive(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      }).then(function () {
        var result = {
          ok: failed.length === 0 && plan.offline.length === 0 && plan.skipped.length === 0,
          complete: failed.length === 0 && plan.offline.length === 0 && plan.skipped.length === 0,
          destination: destinationState.path,
          manifestPath: manifestPath,
          copied: copied,
          offline: plan.offline,
          skipped: plan.skipped,
          failed: failed,
          duplicatesRemoved: plan.duplicatesRemoved,
          bytesCopied: copiedBytes
        };
        emit(options.onProgress, {
          phase: "complete",
          completed: completedFiles,
          total: plan.files.length,
          bytesCompleted: copiedBytes,
          totalBytes: plan.totalBytes,
          percent: 1,
          result: result
        });
        return result;
      }).catch(function (error) {
        if (error && error.code === "PACKAGING_CANCELLED") {
          return rollbackCreated(created, error, destinationState && destinationState.path);
        }
        throw error;
      });
    }

    return {
      prepare: prepare,
      packageProject: packageProject
    };
  }

  return {
    create: create,
    MANIFEST_FILENAME: MANIFEST_FILENAME,
    safeSegment: safeSegment,
    flatName: flatName,
    isInside: isInside
  };
}));
