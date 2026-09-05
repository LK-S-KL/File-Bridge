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
    var fs = modules.fs;
    var path = modules.path;
    var settings = options || {};
    var maxFiles = settings.maxFiles || 2500;
    var maxDepth = typeof settings.maxDepth === "number" ? settings.maxDepth : 8;
    var batchSize = settings.batchSize || 36;
    var cancelSignal = settings.cancelSignal || null;
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
      function isCancelled() { return !!(cancelSignal && cancelSignal.cancelled); }
      function complete(offline, truncated, cancelled) {
        if (completed) { return; }
        completed = true; resolve(finish(offline, truncated, cancelled));
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
        var i;

        function continueScanning() {
          if (settled || pendingStats || completed) { return; }
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

        function addFile(entry, absolutePath, mediaType) {
          pendingStats += 1;
          fs.stat(absolutePath, function (statError, stat) {
            var relativePath;
            if (completed) { return; }
            pendingStats -= 1;
            if (statError || !stat || !stat.isFile()) {
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
                size: stat.size,
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
              }
              return;
            }
            if (!entry.isFile()) { return; }
            mediaType = typeOf(entry.name);
            if (mediaType) { addFile(entry, absolutePath, mediaType); }
          }(entries[i]));
        }
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
        fs.readdir(current.directory, { withFileTypes: true }, function (readError, entries) {
          if (completed) { return; }
          if (isCancelled()) { complete(false, false, true); return; }
          if (readError) {
            warnings.push(current.directory);
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
      fs.stat(rootPath, function (rootError, stat) {
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
