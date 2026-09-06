(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SeekLibrary = api;
}(this, function () {
  "use strict";

  var TYPES = {
    video: ["mp4", "mov", "m4v", "mkv", "avi", "webm", "mxf", "mts", "m2ts", "mpg", "mpeg", "vob", "hevc", "h265", "braw"],
    image: ["jpg", "jpeg", "jpe", "png", "webp", "bmp", "tif", "tiff", "gif", "heic", "heif", "avif", "psd", "psb", "ai", "eps", "svg", "dng", "cr2", "cr3", "arw", "nef", "raf", "rw2"],
    audio: ["mp3", "wav", "m4a", "aac", "aif", "aiff", "flac", "ogg", "opus", "ac3"],
    lut: ["cube"]
  };

  var SKIP_DIRECTORIES = {
    ".git": true,
    ".svn": true,
    "@eaDir": true,
    "node_modules": true,
    "System Volume Information": true,
    "$RECYCLE.BIN": true
  };

  function extensionOf(name) {
    var dot = String(name || "").lastIndexOf(".");
    return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  }

  function typeOf(name) {
    var extension = extensionOf(name);
    var type;
    for (type in TYPES) {
      if (TYPES.hasOwnProperty(type) && TYPES[type].indexOf(extension) !== -1) {
        return type;
      }
    }
    return null;
  }

  function normalizeForSearch(value) {
    return String(value || "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  }

  function matches(asset, query, filter) {
    var needle = normalizeForSearch(query);
    if (filter && filter !== "all" && asset.type !== filter) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return normalizeForSearch(asset.name + " " + asset.relativePath).indexOf(needle) !== -1;
  }

  function scanLibrary(rootPath, modules, options) {
    var fs = modules.fs;
    var path = modules.path;
    var settings = options || {};
    var maxFiles = settings.maxFiles || 2500;
    var maxDepth = typeof settings.maxDepth === "number" ? settings.maxDepth : 8;
    var stack = [{ directory: rootPath, depth: 0 }];
    var assets = [];
    var warnings = [];
    var current;
    var entries;
    var entry;
    var absolutePath;
    var stat;
    var mediaType;
    var relativePath;
    var i;

    if (!rootPath || !fs.existsSync(rootPath)) {
      return {
        assets: [],
        warnings: [],
        truncated: false,
        offline: true
      };
    }

    while (stack.length && assets.length < maxFiles) {
      current = stack.pop();
      try {
        entries = fs.readdirSync(current.directory, { withFileTypes: true });
      } catch (readError) {
        warnings.push(current.directory);
        continue;
      }

      entries.sort(function (left, right) {
        return left.name.localeCompare(right.name, "zh-CN", { numeric: true });
      });

      for (i = entries.length - 1; i >= 0 && assets.length < maxFiles; i -= 1) {
        entry = entries[i];
        if (!entry || !entry.name || entry.name.charAt(0) === ".") {
          continue;
        }
        absolutePath = path.join(current.directory, entry.name);

        if (entry.isDirectory()) {
          if (current.depth < maxDepth && !SKIP_DIRECTORIES[entry.name]) {
            stack.push({ directory: absolutePath, depth: current.depth + 1 });
          }
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        mediaType = typeOf(entry.name);
        if (!mediaType) {
          continue;
        }

        try {
          stat = fs.statSync(absolutePath);
        } catch (statError) {
          warnings.push(absolutePath);
          continue;
        }

        relativePath = path.relative(rootPath, absolutePath);
        assets.push({
          id: absolutePath,
          name: entry.name,
          path: absolutePath,
          relativePath: relativePath,
          folder: path.dirname(relativePath) === "." ? "根目录" : path.dirname(relativePath),
          extension: extensionOf(entry.name),
          type: mediaType,
          size: stat.size,
          modifiedMs: stat.mtimeMs || stat.mtime.getTime()
        });
      }
    }

    assets.sort(function (left, right) {
      if (right.modifiedMs !== left.modifiedMs) {
        return right.modifiedMs - left.modifiedMs;
      }
      return left.name.localeCompare(right.name, "zh-CN", { numeric: true });
    });

    return {
      assets: assets,
      warnings: warnings,
      truncated: assets.length >= maxFiles,
      offline: false
    };
  }

  /*
   * The synchronous scanner remains available for small command-line tests.
   * CEP panels should use this cooperative version so a second SMB location
   * cannot monopolize the embedded Chromium UI thread.
   */
  function scanLibraryAsync(rootPath, modules, options, onProgress) {
    if (modules.childProcess && modules.scanWorkerPath) {
      return scanLibraryIsolated(rootPath, modules, options, onProgress);
    }
    var fs = modules.fs;
    var path = modules.path;
    var settings = options || {};
    var maxFiles = settings.maxFiles || 2500;
    var maxDepth = typeof settings.maxDepth === "number" ? settings.maxDepth : 8;
    var batchSize = settings.batchSize || 36;
    var includeDirectories = settings.includeDirectories === true;
    var cancelSignal = settings.cancelSignal || null;
    var operationTimeoutMs = Math.max(10, Number(settings.operationTimeoutMs) || 12000);
    var cancelPollMs = Math.max(5, Number(settings.cancelPollMs) || 100);
    var stack = [{ directory: rootPath, depth: 0 }];
    var assets = [];
    var warnings = [];
    var seenDirectories = {};

    function finish(offline, truncated, cancelled) {
      assets.sort(function (left, right) {
        if (right.modifiedMs !== left.modifiedMs) {
          return right.modifiedMs - left.modifiedMs;
        }
        return left.name.localeCompare(right.name, "zh-CN", { numeric: true });
      });
      return {
        assets: assets,
        warnings: warnings,
        truncated: !!truncated,
        offline: !!offline,
        cancelled: !!cancelled
      };
    }

    return new Promise(function (resolve) {
      var completed = false;
      var operationTimers = [];
      var cancellationTimer = null;
      function isCancelled() { return !!(cancelSignal && cancelSignal.cancelled); }
      function complete(offline, truncated, cancelled) {
        if (completed) { return; }
        completed = true;
        operationTimers.forEach(clearTimeout);
        clearInterval(cancellationTimer);
        resolve(finish(offline, truncated, cancelled));
      }
      function readBounded(method, args, filePath, callback) {
        var settled = false;
        var timer = setTimeout(function () {
          if (settled || completed) { return; }
          settled = true;
          warnings.push(filePath + ": SCAN_TIMEOUT");
          complete(true, false, false);
        }, operationTimeoutMs);
        operationTimers.push(timer);
        function done(error, value) {
          if (settled || completed) { return; }
          settled = true; clearTimeout(timer);
          var timerIndex = operationTimers.indexOf(timer);
          if (timerIndex !== -1) { operationTimers.splice(timerIndex, 1); }
          if (isCancelled()) { complete(false, false, true); return; }
          callback(error, value);
        }
        try { fs[method].apply(fs, args.concat(done)); }
        catch (error) { done(error); }
      }
      function report() {
        if (completed) { return; }
        if (typeof onProgress === "function") {
          onProgress({ found: assets.length, pending: stack.length, rootPath: rootPath });
        }
      }

      function processEntries(current, entries, startIndex) {
        var endIndex = Math.min(entries.length, startIndex + batchSize);
        var pendingStats = 0;
        var settled = false;
        var scheduling = true;
        var i;

        function continueScanning() {
          if (settled || scheduling || pendingStats || completed) { return; }
          settled = true;
          if (isCancelled()) {
            complete(false, false, true);
          } else if (assets.length >= maxFiles) {
            report();
            complete(false, true, false);
          } else if (endIndex < entries.length) {
            report();
            setTimeout(function () { processEntries(current, entries, endIndex); }, 0);
          } else {
            report();
            setTimeout(pump, 0);
          }
        }

        function addItem(entry, absolutePath, mediaType) {
          pendingStats += 1;
          readBounded("stat", [absolutePath], absolutePath, function (statError, stat) {
            var relativePath;
            if (completed) { return; }
            pendingStats -= 1;
            if (statError || !stat || (mediaType === "folder" ? !stat.isDirectory() : !stat.isFile())) {
              warnings.push(absolutePath);
            } else if (assets.length < maxFiles) {
              relativePath = path.relative(rootPath, absolutePath);
              assets.push({
                id: absolutePath,
                name: entry.name,
                path: absolutePath,
                relativePath: relativePath,
                folder: path.dirname(relativePath) === "." ? "根目录" : path.dirname(relativePath),
                extension: extensionOf(entry.name),
                type: mediaType,
                size: mediaType === "folder" ? 0 : stat.size,
                modifiedMs: stat.mtimeMs || stat.mtime.getTime()
              });
            }
            continueScanning();
          });
        }

        for (i = startIndex; i < endIndex; i += 1) {
          (function (entry) {
            var absolutePath;
            var mediaType;
            if (!entry || !entry.name || entry.name.charAt(0) === ".") { return; }
            absolutePath = path.join(current.directory, entry.name);
            if (entry.isDirectory()) {
              if (current.depth < maxDepth && !SKIP_DIRECTORIES[entry.name]) {
                stack.push({ directory: absolutePath, depth: current.depth + 1 });
                if (includeDirectories) { addItem(entry, absolutePath, "folder"); }
              }
              return;
            }
            if (!entry.isFile()) { return; }
            mediaType = typeOf(entry.name);
            if (mediaType) { addItem(entry, absolutePath, mediaType); }
          }(entries[i]));
        }
        scheduling = false;
        continueScanning();
      }

      function pump() {
        var current;
        if (completed) { return; }
        if (isCancelled()) {
          complete(false, false, true);
          return;
        }
        if (assets.length >= maxFiles) {
          complete(false, true, false);
          return;
        }
        if (!stack.length) {
          complete(false, false, false);
          return;
        }
        current = stack.pop();
        if (seenDirectories[current.directory]) {
          setTimeout(pump, 0);
          return;
        }
        seenDirectories[current.directory] = true;
        readBounded("readdir", [current.directory, { withFileTypes: true }], current.directory, function (readError, entries) {
          if (completed) { return; }
          if (isCancelled()) { complete(false, false, true); return; }
          if (readError) {
            warnings.push(current.directory);
            if (current.directory === rootPath || /^(EIO|ESTALE|ENXIO|ENOTCONN)$/.test(readError.code || "")) {
              complete(true, false, false); return;
            }
            report();
            setTimeout(pump, 0);
            return;
          }
          entries.sort(function (left, right) {
            return left.name.localeCompare(right.name, "zh-CN", { numeric: true });
          });
          processEntries(current, entries, 0);
        });
      }

      if (!rootPath) {
        complete(true, false, false);
        return;
      }
      if (cancelSignal) {
        cancellationTimer = setInterval(function () {
          if (isCancelled()) { complete(false, false, true); }
        }, cancelPollMs);
      }
      if (isCancelled()) { complete(false, false, true); return; }
      readBounded("stat", [rootPath], rootPath, function (rootError, stat) {
        if (completed) { return; }
        if (isCancelled()) { complete(false, false, true); return; }
        if (rootError || !stat || !stat.isDirectory()) {
          complete(true, false, false);
          return;
        }
        pump();
      });
    });
  }

  function scanLibraryIsolated(rootPath, modules, options, onProgress) {
    var settings = options || {};
    var signal = settings.cancelSignal || {};
    var timeoutMs = Math.max(10, Number(settings.operationTimeoutMs) || 12000);
    var assets = [];
    var warnings = [];
    var maxFiles = Number(settings.maxFiles) || 2500;
    return new Promise(function (resolve) {
      var child;
      var completed = false;
      var output = "";
      var watchdog;
      var cancellationTimer;
      var killTimer;
      function complete(offline, cancelled, truncated, stopChild) {
        if (completed) { return; }
        completed = true; clearTimeout(watchdog); clearInterval(cancellationTimer);
        if (stopChild && child) {
          killTimer = setTimeout(function () { try { child.kill("SIGKILL"); } catch (ignoreKillError) {} }, 300);
          try { child.kill("SIGTERM"); } catch (ignoreTerminateError) {}
        }
        assets.sort(function (a, b) { return b.modifiedMs - a.modifiedMs || a.name.localeCompare(b.name, "zh-CN", { numeric: true }); });
        resolve({ assets: assets, warnings: warnings, offline: !!offline, cancelled: !!cancelled, truncated: !!truncated });
      }
      function armWatchdog() {
        clearTimeout(watchdog);
        watchdog = setTimeout(function () { warnings.push(rootPath + ": SCAN_TIMEOUT"); complete(true, false, false, true); }, timeoutMs);
      }
      if (!rootPath || signal.cancelled) { complete(!rootPath, signal.cancelled); return; }
      try {
        child = modules.childProcess.spawn("/usr/bin/perl", [modules.scanWorkerPath, String(rootPath).replace(/\/$/, "") || "/", String(maxFiles), String(typeof settings.maxDepth === "number" ? settings.maxDepth : 8), settings.includeDirectories ? "1" : "0"], { stdio: ["ignore", "pipe", "pipe"] });
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", function (chunk) {
          if (completed) { return; }
          output += chunk;
          if (output.length > 8 * 1024 * 1024) { warnings.push("SCAN_OUTPUT_LIMIT"); complete(true, false, false, true); return; }
          var end;
          while ((end = output.indexOf("\n")) !== -1 && !completed) {
            var line = output.slice(0, end); output = output.slice(end + 1);
            try {
              var item = JSON.parse(line);
              if (item.type === "progress") {
                assets = assets.concat((item.assets || []).slice(0, Math.max(0, maxFiles - assets.length)));
                armWatchdog();
                if (typeof onProgress === "function") { onProgress({ found: assets.length, pending: Number(item.pending) || 0, rootPath: rootPath }); }
              } else if (item.type === "warning") { warnings.push(item.path); }
              else if (item.type === "done") { complete(item.offline, false, item.truncated); }
            } catch (parseError) { warnings.push("SCAN_WORKER_OUTPUT_INVALID"); complete(true, false, false, true); }
          }
        });
        child.stderr.on("data", function () {});
        child.on("error", function (error) { warnings.push(rootPath + ": " + error.message); complete(true, false, false, true); });
        child.on("close", function () { clearTimeout(killTimer); if (!completed) { warnings.push("SCAN_WORKER_EXITED"); complete(true, false, false); } });
        cancellationTimer = setInterval(function () { if (signal.cancelled) { complete(false, true, false, true); } }, Math.max(5, Number(settings.cancelPollMs) || 100));
        armWatchdog();
      } catch (spawnError) { warnings.push(rootPath + ": " + spawnError.message); complete(true, false, false, true); }
    });
  }

  function fileUrl(filePath) {
    var normalized = String(filePath || "").replace(/\\/g, "/");
    var segments = normalized.split("/");
    var encoded = segments.map(function (segment, index) {
      if (index === 0 && segment === "") {
        return "";
      }
      return encodeURIComponent(segment).replace(/%3A/gi, ":");
    }).join("/");
    return encoded.indexOf("/") === 0 ? "file://" + encoded : "file:///" + encoded;
  }

  function formatBytes(bytes) {
    var units = ["B", "KB", "MB", "GB", "TB"];
    var value = Number(bytes) || 0;
    var index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return (index === 0 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 0 : 1)) + " " + units[index];
  }

  return {
    TYPES: TYPES,
    extensionOf: extensionOf,
    typeOf: typeOf,
    matches: matches,
    scanLibrary: scanLibrary,
    scanLibraryAsync: scanLibraryAsync,
    fileUrl: fileUrl,
    formatBytes: formatBytes
  };
}));
