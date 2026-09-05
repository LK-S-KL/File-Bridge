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
    audio: ["mp3", "wav", "m4a", "aac", "aif", "aiff", "flac", "ogg", "opus", "ac3"]
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
    fileUrl: fileUrl,
    formatBytes: formatBytes
  };
}));
