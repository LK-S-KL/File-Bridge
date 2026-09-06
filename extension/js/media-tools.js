(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.FnOSMediaTools = api;
}(this, function () {
  "use strict";

  var SPRITE_COLUMNS = 4;
  var SPRITE_ROWS = 3;
  var SPRITE_FRAMES = SPRITE_COLUMNS * SPRITE_ROWS;

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") {
      return null;
    }
    var number = Number(value);
    return isFinite(number) ? number : null;
  }

  function rationalToNumber(value) {
    var parts;
    var numerator;
    var denominator;
    if (typeof value === "number") {
      return isFinite(value) ? value : null;
    }
    if (!value) {
      return null;
    }
    parts = String(value).split("/");
    if (parts.length === 2) {
      numerator = Number(parts[0]);
      denominator = Number(parts[1]);
      return denominator && isFinite(numerator / denominator) ? numerator / denominator : null;
    }
    return numberOrNull(value);
  }

  function unique(values) {
    return values.filter(function (value, index) {
      return value && values.indexOf(value) === index;
    });
  }

  function firstStream(streams, type) {
    var fallback = null;
    var firstUsable = null;
    var i;
    for (i = 0; i < streams.length; i += 1) {
      if (streams[i].codec_type !== type) {
        continue;
      }
      if (!fallback) {
        fallback = streams[i];
      }
      if (type === "video" && streams[i].disposition && Number(streams[i].disposition.attached_pic) === 1) {
        continue;
      }
      if (!firstUsable) {
        firstUsable = streams[i];
      }
      if (streams[i].disposition && Number(streams[i].disposition.default) === 1) {
        return streams[i];
      }
    }
    return firstUsable || fallback;
  }

  function streamTypeIndex(streams, selected) {
    var index = 0;
    var i;
    if (!selected) {
      return null;
    }
    for (i = 0; i < streams.length; i += 1) {
      if (streams[i].codec_type !== selected.codec_type) {
        continue;
      }
      if (streams[i] === selected) {
        return index;
      }
      index += 1;
    }
    return 0;
  }

  function sideDataText(video) {
    return JSON.stringify(video && video.side_data_list || []).toLowerCase();
  }

  function dynamicRangeInfo(video) {
    var transfer = String(video && video.color_transfer || "").toLowerCase();
    var primaries = String(video && video.color_primaries || "").toLowerCase();
    var matrix = String(video && video.color_space || "").toLowerCase();
    var evidence = [
      transfer,
      primaries,
      matrix,
      String(video && video.profile || "").toLowerCase(),
      JSON.stringify(video && video.tags || {}).toLowerCase(),
      sideDataText(video)
    ].join(" ");
    if (/dovi|dolby[ _-]?vision|dv_profile/.test(evidence)) {
      return { code: "DOLBY_VISION", label: "Dolby Vision", confidence: "高" };
    }
    if (/smpte2094[ _-]?40|hdr10\+|hdr dynamic metadata/.test(evidence)) {
      return { code: "HDR10_PLUS", label: "HDR10+", confidence: "高" };
    }
    if (transfer === "smpte2084") {
      if (primaries === "bt2020" || matrix.indexOf("bt2020") === 0) {
        return { code: "HDR10", label: "HDR10", confidence: "高" };
      }
      return { code: "HDR_PQ", label: "HDR · PQ", confidence: "中" };
    }
    if (transfer === "arib-std-b67" || transfer === "arib_std_b67") {
      return { code: "HLG", label: "HDR · HLG", confidence: "高" };
    }
    if (/mastering display metadata|content light level metadata|max_cll|max_fall/.test(evidence)) {
      return { code: "HDR10", label: "HDR10", confidence: "中" };
    }
    if (transfer.indexOf("log") !== -1) {
      return { code: "LOG", label: "Log / 未转换", confidence: "中" };
    }
    if (primaries === "bt2020" || matrix.indexOf("bt2020") === 0) {
      return { code: "WIDE_GAMUT", label: "广色域 / 未标记 HDR 曲线", confidence: "低" };
    }
    if (["bt709", "smpte170m", "smpte240m", "iec61966-2-1", "iec61966_2_1", "gamma22", "gamma28"].indexOf(transfer) !== -1 || primaries === "bt709") {
      return { code: "SDR", label: "SDR", confidence: "高" };
    }
    return { code: "UNKNOWN", label: "未标记", confidence: "低" };
  }

  function dynamicRangeOf(video) {
    return dynamicRangeInfo(video).label;
  }

  function alphaInfo(video) {
    var pixelFormat = String(video && video.pix_fmt || "").toLowerCase();
    var tags = video && video.tags || {};
    var alphaMode = String(tags.alpha_mode || tags.ALPHA_MODE || "").toLowerCase();
    var profile = String(video && video.profile || "").toLowerCase();
    var codec = String(video && video.codec_name || "").toLowerCase();
    if (alphaMode === "1" || alphaMode === "true" ||
        /^(rgba|argb|bgra|abgr|yuva|gbrap|gbrapf|ya|ayuv|pal8)/.test(pixelFormat) ||
        /alpha channel/.test(sideDataText(video))) {
      return { present: true, label: "有", confidence: "高" };
    }
    if (codec === "prores" && profile.indexOf("4444") !== -1) {
      return { present: true, label: "有", confidence: "中" };
    }
    return pixelFormat ? { present: false, label: "无", confidence: "高" } :
      { present: null, label: "未知", confidence: "低" };
  }

  function alphaOf(video) {
    return alphaInfo(video).label;
  }

  function bitDepthOf(video) {
    var raw = numberOrNull(video && video.bits_per_raw_sample);
    var pixelFormat = String(video && video.pix_fmt || "");
    var match;
    if (raw) {
      return raw + " bit";
    }
    match = pixelFormat.match(/(?:p|le|be)(9|10|12|14|16)(?:le|be)?$/i);
    if (match) {
      return match[1] + " bit";
    }
    return "未标记";
  }

  function durationOf(format, streams) {
    var duration = numberOrNull(format.duration);
    var i;
    var candidate;
    if (duration !== null) {
      return duration;
    }
    for (i = 0; i < streams.length; i += 1) {
      candidate = numberOrNull(streams[i].duration);
      if (candidate !== null && (duration === null || candidate > duration)) {
        duration = candidate;
      }
    }
    return duration;
  }

  function extensionForPath(sourcePath) {
    var value = String(sourcePath || "").toLowerCase();
    var slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
    var dot = value.lastIndexOf(".");
    return dot <= slash || dot === -1 ? "" : value.slice(dot + 1);
  }

  function containerToken(formatName, sourcePath) {
    var extension = extensionForPath(sourcePath);
    var tokens = String(formatName || "").toLowerCase().split(",").map(function (value) {
      return value.trim();
    }).filter(Boolean);
    var aliases = {
      m4v: ["m4v", "mp4"],
      m4a: ["m4a", "mp4"],
      jpg: ["mjpeg", "image2"],
      jpeg: ["mjpeg", "image2"],
      tif: ["tiff", "image2"],
      tiff: ["tiff", "image2"]
    };
    var candidates = aliases[extension] || (extension ? [extension] : []);
    var authoritativeExtensions = {
      mp4: true, m4v: true, m4a: true, mov: true, webm: true, mkv: true,
      avi: true, mxf: true, wav: true, mp3: true, aac: true, flac: true,
      ogg: true, "3gp": true, png: true, jpg: true, jpeg: true, gif: true,
      bmp: true, tif: true, tiff: true, svg: true, pdf: true
    };
    var i;
    var j;
    /* The extension is the most useful container label for users and avoids
       ffprobe's combined `mov,mp4,...` family name being shown as MOV for an
       actual .mp4 file. */
    if (extension && authoritativeExtensions[extension]) {
      return extension;
    }
    for (i = 0; i < candidates.length; i += 1) {
      for (j = 0; j < tokens.length; j += 1) {
        if (tokens[j] === candidates[i]) {
          return tokens[j];
        }
      }
    }
    return tokens[0] || "";
  }

  function displayFormat(format, sourcePath) {
    var extension = extensionForPath(sourcePath);
    var token = containerToken(format && format.format_name, sourcePath);
    var known = {
      mp4: "MPEG-4 / MP4",
      m4v: "MPEG-4 Video / M4V",
      m4a: "MPEG-4 Audio / M4A",
      mov: "QuickTime / MOV",
      webm: "WebM",
      mkv: "Matroska / MKV",
      avi: "AVI",
      mxf: "MXF",
      wav: "WAV",
      mp3: "MP3",
      aac: "AAC",
      flac: "FLAC",
      ogg: "Ogg",
      "3gp": "3GPP",
      png: "PNG",
      jpeg: "JPEG",
      jpg: "JPEG",
      tiff: "TIFF",
      gif: "GIF",
      bmp: "BMP",
      webp: "WebP",
      svg: "SVG",
      aiff: "AIFF",
      aif: "AIFF",
      pdf: "PDF"
    };
    /* ffprobe reports the shared QuickTime/ISO BMFF family as
       "mov,mp4,...". The file extension is the authoritative container
       hint for the human-facing label in that case. */
    if (extension && known[extension]) {
      return known[extension];
    }
    if (token && known[token]) {
      return known[token];
    }
    return format && (format.format_long_name || format.format_name) || "未知";
  }

  function normalizeProbe(raw, sourceStat, sourcePath) {
    sourcePath = sourcePath || (sourceStat && sourceStat.path) || "";
    var format = raw && raw.format ? raw.format : {};
    var streams = raw && raw.streams ? raw.streams : [];
    var video = firstStream(streams, "video");
    var audioStreams = streams.filter(function (stream) {
      return stream.codec_type === "audio";
    });
    var duration = durationOf(format, streams);
    var frameRate = video ? rationalToNumber(video.avg_frame_rate) || rationalToNumber(video.r_frame_rate) : null;
    var videoCodecs = unique(streams.filter(function (stream) {
      return stream.codec_type === "video";
    }).map(function (stream) {
      return stream.codec_long_name || stream.codec_name;
    }));
    var audioCodecs = unique(audioStreams.map(function (stream) {
      return stream.codec_long_name || stream.codec_name;
    }));
    var colorParts = video ? unique([
      video.color_primaries,
      video.color_transfer,
      video.color_space
    ]) : [];
    var tags = format.tags || {};
    var timecode = tags.timecode || (video && video.tags && video.tags.timecode) || "";
    var audio = audioStreams.length ? audioStreams[0] : null;
    var streamBitrates = streams.map(function (stream) {
      return numberOrNull(stream.bit_rate);
    }).filter(function (value) {
      return value !== null;
    });
    var totalBitrate = numberOrNull(format.bit_rate);
    var creationTime = tags.creation_time || tags["com.apple.quicktime.creationdate"] || tags.date || "";
    var dynamicRange = video ? dynamicRangeInfo(video) : { code: "NOT_APPLICABLE", label: "不适用", confidence: "高" };
    var alpha = video ? alphaInfo(video) : { present: null, label: "不适用", confidence: "高" };
    var i;

    if (totalBitrate === null && streamBitrates.length) {
      totalBitrate = streamBitrates.reduce(function (sum, value) { return sum + value; }, 0);
    }
    if (!creationTime) {
      for (i = 0; i < streams.length && !creationTime; i += 1) {
        if (streams[i].tags) {
          creationTime = streams[i].tags.creation_time || streams[i].tags["com.apple.quicktime.creationdate"] || "";
        }
      }
    }

    return {
      format: displayFormat(format, sourcePath),
      formatShort: sourcePath ? containerToken(format.format_name, sourcePath) : (format.format_name || ""),
      duration: duration,
      totalBitrate: totalBitrate,
      videoCodec: videoCodecs.length ? videoCodecs.join(" + ") : "无",
      videoStreamIndex: streamTypeIndex(streams, video),
      videoCodecShort: video && video.codec_name ? video.codec_name : "无",
      videoProfile: video && video.profile ? video.profile : "未标记",
      videoLevel: video ? numberOrNull(video.level) : null,
      videoBitrate: video ? numberOrNull(video.bit_rate) : null,
      audioCodec: audioCodecs.length ? audioCodecs.join(" + ") : "无",
      audioStreamIndex: streamTypeIndex(streams, audio),
      audioCodecShort: audio && audio.codec_name ? audio.codec_name : "无",
      audioProfile: audio && audio.profile ? audio.profile : "未标记",
      audioBitrate: audio ? numberOrNull(audio.bit_rate) : null,
      width: video ? numberOrNull(video.width) : null,
      height: video ? numberOrNull(video.height) : null,
      resolution: video && video.width && video.height ? video.width + " × " + video.height : "无视频画面",
      frameRate: frameRate,
      colorSpace: colorParts.length ? colorParts.join(" / ") : "未标记",
      colorPrimaries: video && video.color_primaries ? video.color_primaries : "未标记",
      colorTransfer: video && video.color_transfer ? video.color_transfer : "未标记",
      colorMatrix: video && video.color_space ? video.color_space : "未标记",
      colorRange: video && video.color_range ? video.color_range : "未标记",
      dynamicRange: dynamicRange.label,
      dynamicRangeCode: dynamicRange.code,
      dynamicRangeConfidence: dynamicRange.confidence,
      alpha: alpha.label,
      alphaPresent: alpha.present,
      alphaConfidence: alpha.confidence,
      pixelFormat: video && video.pix_fmt ? video.pix_fmt : "不适用",
      bitDepth: video ? bitDepthOf(video) : "不适用",
      fieldOrder: video && video.field_order ? video.field_order : "未标记",
      sampleAspectRatio: video && video.sample_aspect_ratio ? video.sample_aspect_ratio : "未标记",
      displayAspectRatio: video && video.display_aspect_ratio ? video.display_aspect_ratio : "未标记",
      audioSampleRate: audio && audio.sample_rate ? Number(audio.sample_rate) : null,
      audioChannels: audio ? (audio.channel_layout || (audio.channels ? audio.channels + " 声道" : "未标记")) : "无",
      streamCount: streams.length,
      timecode: timecode || "未标记",
      creationTime: creationTime || "未标记",
      fileSize: sourceStat && sourceStat.size ? sourceStat.size : numberOrNull(format.size),
      modifiedMs: sourceStat && sourceStat.mtime ? sourceStat.mtime.getTime() : null
    };
  }

  function formatDuration(seconds) {
    var total = numberOrNull(seconds);
    var hours;
    var minutes;
    var remaining;
    var fraction;
    if (total === null) {
      return "未知";
    }
    hours = Math.floor(total / 3600);
    minutes = Math.floor((total % 3600) / 60);
    remaining = Math.floor(total % 60);
    fraction = Math.round((total - Math.floor(total)) * 1000);
    return (hours ? String(hours).padStart(2, "0") + ":" : "") +
      String(minutes).padStart(2, "0") + ":" +
      String(remaining).padStart(2, "0") +
      (fraction ? "." + String(fraction).padStart(3, "0") : "");
  }

  function formatBitrate(bits) {
    var value = numberOrNull(bits);
    if (value === null) {
      return "未知";
    }
    if (value >= 1000000) {
      return (value / 1000000).toFixed(value >= 10000000 ? 1 : 2) + " Mb/s";
    }
    return Math.round(value / 1000) + " kb/s";
  }

  function spriteSampleTimes(duration, frameCount) {
    var seconds = Math.max(numberOrNull(duration) || 0, 0.001);
    var start = seconds * 0.04;
    var span = seconds * 0.92;
    var times = [];
    var i;
    for (i = 0; i < frameCount; i += 1) {
      times.push(Math.max(0, Math.min(seconds - 0.001, start + span * ((i + 0.5) / frameCount))));
    }
    return times;
  }

  function spriteFrameAtProgress(sprite, progress) {
    var frames = Number(sprite && (sprite.frames || sprite.frameCount));
    var value = Math.max(0, Math.min(1, Number(progress) || 0));
    var columns;
    var cellWidth;
    var cellHeight;
    var index;
    var column;
    var row;
    if (!frames || !isFinite(frames)) {
      throw new Error("INVALID_SPRITE");
    }
    columns = Number(sprite.columns) || SPRITE_COLUMNS;
    cellWidth = Number(sprite.cellWidth) || 240;
    cellHeight = Number(sprite.cellHeight) || 135;
    index = Math.min(frames - 1, Math.floor(value * frames));
    column = index % columns;
    row = Math.floor(index / columns);
    return {
      index: index,
      column: column,
      row: row,
      sampleTime: sprite.sampleTimes && sprite.sampleTimes[index] !== undefined ? sprite.sampleTimes[index] : null,
      backgroundPosition: (-column * cellWidth) + "px " + (-row * cellHeight) + "px",
      backgroundSize: (columns * cellWidth) + "px " + ((Number(sprite.rows) || Math.ceil(frames / columns)) * cellHeight) + "px"
    };
  }

  function create(runtime) {
    var fs = runtime.fs;
    var path = runtime.path;
    var os = runtime.os;
    var crypto = runtime.crypto;
    var childProcess = runtime.childProcess;
    var cacheRoot = path.join(os.homedir(), "Library", "Caches", "com.fnnas.fnosbridge.mvp");
    var metadataDirectory = path.join(cacheRoot, "metadata");
    var posterDirectory = path.join(cacheRoot, "posters");
    var spriteDirectory = path.join(cacheRoot, "sprites");
    var waveformDirectory = path.join(cacheRoot, "waveforms");
    var proxyDirectory = path.join(cacheRoot, "proxies");
    var frameDirectory = path.join(cacheRoot, "frames");
    var audioProxyDirectory = path.join(cacheRoot, "audio");
    var stillPreviewDirectory = path.join(cacheRoot, "stills");
    var captureDirectory = path.join(os.homedir(), "Pictures", "LK‘s File Bridge Captures");
    var memoryMetadata = {};
    var pendingMetadata = {};
    var pendingOutputs = {};
    var pendingSourceStats = {};
    var sourceStatCache = {};
    var sourceStatCooldown = {};
    var ffmpegQueue = [];
    var activeFfmpegJobs = {};
    var activeFfmpegCount = 0;
    var nextFfmpegJobId = 1;
    var MAX_FFMPEG_CONCURRENCY = 2;
    var cachePruneScheduled = false;
    var nextTemporaryOutputId = 1;

    function statSource(filePath) {
      var now = Date.now();
      var cached = sourceStatCache[filePath];
      if (cached && now - cached.at < 1500) { return Promise.resolve(cached.stat); }
      if (pendingSourceStats[filePath]) { return pendingSourceStats[filePath]; }
      if (sourceStatCooldown[filePath] && sourceStatCooldown[filePath] > now) { return Promise.reject(new Error("SOURCE_TIMEOUT")); }
      pendingSourceStats[filePath] = new Promise(function (resolve, reject) {
        var timedOut = false;
        var timeout = setTimeout(function () {
          timedOut = true; delete pendingSourceStats[filePath]; sourceStatCooldown[filePath] = Date.now() + 30000;
          reject(new Error("SOURCE_TIMEOUT"));
        }, 15000);
        fs.stat(filePath, function (error, stat) {
          if (timedOut) {
            if (!error && stat && stat.isFile()) { sourceStatCache[filePath] = { stat: stat, at: Date.now() }; delete sourceStatCooldown[filePath]; }
            return;
          }
          clearTimeout(timeout); delete pendingSourceStats[filePath];
          if (error) { reject(error); return; }
          if (!stat || !stat.isFile()) { reject(new Error("FILE_NOT_FOUND")); return; }
          sourceStatCache[filePath] = { stat: stat, at: Date.now() }; resolve(stat);
        });
      });
      return pendingSourceStats[filePath];
    }

    function usableCacheFile(filePath) {
      try {
        return fs.existsSync(filePath) && fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
      } catch (error) {
        return false;
      }
    }

    function removeFailedCacheFile(filePath) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (ignoreCleanupError) {}
    }

    function ensureDirectories() {
      [cacheRoot, metadataDirectory, posterDirectory, spriteDirectory, waveformDirectory, proxyDirectory, frameDirectory, audioProxyDirectory, stillPreviewDirectory].forEach(function (directory) {
        fs.mkdirSync(directory, { recursive: true });
      });
    }

    function scheduleCachePrune() {
      var directories = [metadataDirectory, posterDirectory, spriteDirectory, waveformDirectory, proxyDirectory, frameDirectory, audioProxyDirectory, stillPreviewDirectory];
      var timer;
      if (cachePruneScheduled) { return; }
      cachePruneScheduled = true;
      timer = setTimeout(function () {
        var paths = [];
        var pendingDirectories = directories.length;
        function collectStats() {
          var records = [];
          var cursor = 0;
          var active = 0;
          function next() {
            var filePath;
            while (active < 16 && cursor < paths.length) {
              filePath = paths[cursor]; cursor += 1; active += 1;
              (function (candidate) {
                fs.stat(candidate, function (error, stat) {
                  active -= 1;
                  if (!error && stat && stat.isFile()) { records.push({ path: candidate, size: stat.size, modifiedMs: stat.mtimeMs || stat.mtime.getTime() }); }
                  if (!active && cursor >= paths.length) { prune(records); }
                  else { next(); }
                });
              }(filePath));
            }
            if (!active && cursor >= paths.length) { prune(records); }
          }
          next();
        }
        function prune(records) {
          var total = records.reduce(function (sum, record) { return sum + record.size; }, 0);
          var target = 10 * 1024 * 1024 * 1024;
          var recentBoundary = Date.now() - 24 * 60 * 60 * 1000;
          if (total <= 12 * 1024 * 1024 * 1024) { return; }
          records.sort(function (left, right) { return left.modifiedMs - right.modifiedMs; });
          records.forEach(function (record) {
            if (total <= target || record.modifiedMs > recentBoundary || pendingOutputs[record.path]) { return; }
            total -= record.size; fs.unlink(record.path, function () {});
          });
        }
        directories.forEach(function (directory) {
          fs.readdir(directory, function (error, names) {
            if (!error && names) { names.forEach(function (name) { paths.push(path.join(directory, name)); }); }
            pendingDirectories -= 1; if (!pendingDirectories) { collectStats(); }
          });
        });
      }, 1200);
      if (timer && typeof timer.unref === "function") { timer.unref(); }
    }

    function findBinary(name) {
      var candidates = name === "ffprobe" ? [
        "/opt/homebrew/bin/ffprobe",
        "/usr/local/bin/ffprobe",
        path.join(os.homedir(), ".local", "bin", "ffprobe")
      ] : [
        path.join(os.homedir(), ".local", "bin", "ffmpeg"),
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg"
      ];
      var i;
      for (i = 0; i < candidates.length; i += 1) {
        if (fs.existsSync(candidates[i])) {
          return candidates[i];
        }
      }
      return null;
    }

    function cancelledError() {
      var error = new Error("JOB_CANCELLED");
      error.code = "JOB_CANCELLED";
      return error;
    }

    function pumpFfmpegQueue() {
      var job;
      while (activeFfmpegCount < MAX_FFMPEG_CONCURRENCY && ffmpegQueue.length) {
        job = ffmpegQueue.shift();
        if (job.cancelled) { continue; }
        activeFfmpegCount += 1; activeFfmpegJobs[job.id] = job;
        (function (current) {
          current.child = childProcess.execFile(current.binary, current.args, current.options, function (error, stdout, stderr) {
            activeFfmpegCount = Math.max(0, activeFfmpegCount - 1); delete activeFfmpegJobs[current.id];
            if (current.cancelled) { current.reject(cancelledError()); }
            else if (error) { current.reject(error); }
            else { current.resolve({ stdout: stdout, stderr: stderr }); }
            pumpFfmpegQueue();
          });
          if (current.onOutput && current.child.stdout) { current.child.stdout.on("data", current.onOutput); }
        }(job));
      }
    }

    function execFileQueued(binary, args, options, jobKey, onOutput) {
      return new Promise(function (resolve, reject) {
        var job = { id: nextFfmpegJobId, binary: binary, args: args, options: options, key: jobKey || "derived", onOutput: onOutput, resolve: resolve, reject: reject, child: null, cancelled: false };
        nextFfmpegJobId += 1;
        if (/^(preview|audio|capture|user-transcode):/.test(job.key)) { ffmpegQueue.unshift(job); }
        else { ffmpegQueue.push(job); }
        pumpFfmpegQueue();
      });
    }

    function cancelJobKey(jobKey) {
      ffmpegQueue = ffmpegQueue.filter(function (job) {
        if (job.key !== jobKey) { return true; }
        job.cancelled = true; job.reject(cancelledError()); return false;
      });
      Object.keys(activeFfmpegJobs).forEach(function (id) {
        var job = activeFfmpegJobs[id];
        if (job.key !== jobKey || job.cancelled) { return; }
        job.cancelled = true;
        try { job.child.kill("SIGTERM"); } catch (ignoreKillError) {}
      });
    }

    function cancelJobPrefix(prefix) {
      ffmpegQueue = ffmpegQueue.filter(function (job) {
        if (job.key.indexOf(prefix) !== 0) { return true; }
        job.cancelled = true; job.reject(cancelledError()); return false;
      });
      Object.keys(activeFfmpegJobs).forEach(function (id) {
        var job = activeFfmpegJobs[id];
        if (job.key.indexOf(prefix) !== 0 || job.cancelled) { return; }
        job.cancelled = true;
        try { job.child.kill("SIGTERM"); } catch (ignoreKillError) {}
      });
    }

    function cancelViewerJobs(filePath) {
      cancelJobKey("preview:" + filePath);
      cancelJobKey("audio:" + filePath);
    }

    function cancelPreviewJob(filePath) { cancelJobKey("preview:" + filePath); }

    function prioritizeViewer() { cancelJobPrefix("derived:"); }

    function cacheTemporaryPath(destination) {
      var extension = path.extname(destination);
      var stem = extension ? destination.slice(0, -extension.length) : destination;
      var temporary = stem + "." + process.pid + "-" + nextTemporaryOutputId + ".part" + extension;
      nextTemporaryOutputId += 1;
      return temporary;
    }

    function publishCacheOutput(temporary, destination) {
      return new Promise(function (resolve, reject) {
        fs.link(temporary, destination, function (error) {
          if (!error || (error.code === "EEXIST" && usableCacheFile(destination))) {
            fs.unlink(temporary, function () { resolve(destination); }); return;
          }
          fs.unlink(temporary, function () { reject(error); });
        });
      });
    }

    function runFfmpeg(args, destination, timeout, jobKey, onOutput) {
      var ffmpeg = findBinary("ffmpeg");
      var isCacheOutput = destination.indexOf(cacheRoot + path.sep) === 0;
      var actualDestination = isCacheOutput ? cacheTemporaryPath(destination) : destination;
      var actualArgs = args.slice();
      var outputIndex;
      if (!ffmpeg) {
        return Promise.reject(new Error("FFMPEG_NOT_FOUND"));
      }
      if (isCacheOutput) {
        for (outputIndex = actualArgs.length - 1; outputIndex >= 0; outputIndex -= 1) { if (actualArgs[outputIndex] === destination) { actualArgs[outputIndex] = actualDestination; break; } }
      }
      return execFileQueued(ffmpeg, actualArgs, { timeout: timeout || 120000, maxBuffer: 8 * 1024 * 1024 }, jobKey, onOutput).then(function (result) {
        if (!usableCacheFile(actualDestination)) { throw new Error(result.stderr || "OUTPUT_NOT_CREATED"); }
        return isCacheOutput ? publishCacheOutput(actualDestination, destination) : destination;
      }).catch(function (error) {
        removeFailedCacheFile(actualDestination); throw error;
      });
    }

    function outputOnce(destination, producer) {
      if (pendingOutputs[destination]) { return pendingOutputs[destination]; }
      pendingOutputs[destination] = producer().then(function (result) {
        delete pendingOutputs[destination]; return result;
      }, function (error) {
        delete pendingOutputs[destination]; throw error;
      });
      return pendingOutputs[destination];
    }

    function profileConfig(profile) {
      var value = String(profile || "source").toLowerCase();
      var dimensions = {
        source: null,
        "4k": "3840:2160",
        "1080": "1920:1080",
        "720": "1280:720",
        "480": "854:480",
        "360": "640:360"
      };
      return {
        name: dimensions[value] !== undefined ? value : "1080",
        scale: dimensions[value] !== undefined ? dimensions[value] : "1920:1080",
        bitrate: value === "4k" || value === "source" ? "16M" : value === "1080" ? "8M" : value === "720" ? "5M" : value === "480" ? "2.5M" : "1.5M"
      };
    }

    function previewProxyFor(filePath, profile) {
      var config = profileConfig(profile);
      var ext = String(path.extname(filePath)).toLowerCase();
      return statSource(filePath).then(function (stat) {
        var key;
        var destination;
        var filter;
        var baseArgs;
        var hardwareArgs;
        if (config.name === "source" && [".mp4", ".m4v", ".webm"].indexOf(ext) !== -1) { return filePath; }
        key = cacheKey(filePath, stat) + "-v3-" + config.name;
        ensureDirectories(); destination = path.join(proxyDirectory, key + ".mp4");
        if (usableCacheFile(destination)) { return destination; }
        if (config.scale) {
          var dimensions = config.scale.split(":");
          filter = "scale='min(" + dimensions[0] + ",iw)':'min(" + dimensions[1] + ",ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p";
        } else { filter = "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p"; }
        baseArgs = ["-hide_banner", "-loglevel", "error", "-i", filePath, "-vf", filter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-threads", "0", "-y", destination];
        hardwareArgs = ["-hide_banner", "-loglevel", "error", "-hwaccel", "videotoolbox", "-i", filePath, "-vf", filter, "-c:v", "h264_videotoolbox", "-b:v", config.bitrate, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-y", destination];
        if (pendingOutputs[destination]) { return pendingOutputs[destination]; }
        cancelJobKey("preview:" + filePath);
        return outputOnce(destination, function () { return runFfmpeg(hardwareArgs, destination, 180000, "preview:" + filePath).catch(function (error) {
          if (error && error.code === "JOB_CANCELLED") { throw error; }
          return runFfmpeg(baseArgs, destination, 180000, "preview:" + filePath);
        }); });
      });
    }

    function audioProxyFor(filePath) {
      var stat;
      var key;
      var destination;
      return statSource(filePath).then(function (sourceStat) {
        stat = sourceStat; key = cacheKey(filePath, stat) + "-v3"; ensureDirectories(); destination = path.join(audioProxyDirectory, key + ".m4a");
        if (usableCacheFile(destination)) { return destination; }
        return outputOnce(destination, function () { return runFfmpeg(["-hide_banner", "-loglevel", "error", "-i", filePath, "-vn", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", destination], destination, 120000, "audio:" + filePath); });
      });
    }

    function frameFor(filePath, seconds, width, height) {
      var stat;
      var key;
      var destination;
      var timestamp = Math.max(0, Number(seconds) || 0).toFixed(3);
      var size = width && height ? String(width) + "x" + String(height) : "native";
      return statSource(filePath).then(function (sourceStat) {
        stat = sourceStat; key = cacheKey(filePath, stat) + "-v3-" + timestamp + "-" + size; ensureDirectories(); destination = path.join(frameDirectory, key + ".png");
        if (usableCacheFile(destination)) { return destination; }
        return outputOnce(destination, function () { return runFfmpeg(["-hide_banner", "-loglevel", "error", "-i", filePath, "-ss", timestamp, "-map", "0:v:0", "-frames:v", "1"].concat(width && height ? ["-vf", "scale=" + width + ":" + height + ":force_original_aspect_ratio=decrease"] : []).concat(["-y", destination]), destination, 60000, "frame:" + destination); });
      });
    }

    function captureTimestamp(now) {
      var date = now instanceof Date ? now : new Date(now || Date.now());
      function two(value) { return String(value).padStart(2, "0"); }
      if (!isFinite(date.getTime())) { date = new Date(); }
      return String(date.getFullYear()) + two(date.getMonth() + 1) + two(date.getDate()) + "-" + two(date.getHours()) + two(date.getMinutes());
    }

    function captureFrameForProject(filePath, seconds, options) {
      var settings = options || {};
      var timestamp = Math.max(0, Number(seconds) || 0);
      var base = path.basename(filePath, path.extname(filePath)).replace(/[<>:"/\\|?*]/g, "-").replace(/[ .]+$/g, "").slice(0, 100) || "frame";
      var marker = captureTimestamp(settings.now);
      var destinationDirectory = settings.directory ? String(settings.directory) : captureDirectory;
      var destination;
      var index = 1;
      if (!path.isAbsolute(destinationDirectory) || String(destinationDirectory).indexOf("\u0000") !== -1) {
        return Promise.reject(new Error("INVALID_CAPTURE_DIRECTORY"));
      }
      try { fs.mkdirSync(destinationDirectory, { recursive: true }); }
      catch (mkdirError) { return Promise.reject(mkdirError); }
      return new Promise(function (resolve, reject) {
        function reserve() {
          destination = path.join(destinationDirectory, base + "_Screenshot_" + marker + (index > 1 ? "-" + index : "") + ".png");
          fs.open(destination, "wx", 0o600, function (openError, descriptor) {
            if (openError && openError.code === "EEXIST") { index += 1; reserve(); return; }
            if (openError) { reject(openError); return; }
            fs.close(descriptor, function (closeError) {
              if (closeError) { removeFailedCacheFile(destination); reject(closeError); return; }
              resolve(destination);
            });
          });
        }
        reserve();
      }).then(function (reservedPath) {
        return runFfmpeg(["-hide_banner", "-loglevel", "error", "-i", filePath, "-ss", timestamp.toFixed(3), "-map", "0:v:0", "-frames:v", "1", "-y", reservedPath], reservedPath, 90000, "capture:" + reservedPath).catch(function (error) {
          try { fs.unlinkSync(reservedPath); } catch (ignoreCaptureCleanupError) {}
          throw error;
        });
      });
    }

    function progressReader(duration, onProgress) {
      var buffer = "";
      return function (chunk) {
        var lines;
        if (typeof onProgress !== "function") { return; }
        buffer += String(chunk || ""); lines = buffer.split(/\r?\n/); buffer = lines.pop();
        lines.forEach(function (line) {
          var parts = line.split("=");
          var micros;
          if (parts[0] === "out_time_ms" || parts[0] === "out_time_us") {
            micros = Number(parts[1]);
            if (isFinite(micros) && duration > 0) { onProgress({ ratio: Math.max(0, Math.min(.99, micros / 1000000 / duration)), seconds: micros / 1000000, duration: duration }); }
          } else if (line === "progress=end") { onProgress({ ratio: 1, seconds: duration, duration: duration }); }
        });
      };
    }

    function transcodeTo(filePath, destination, profile, onProgress) {
      var config = profileConfig(profile);
      var filter = config.scale ? "scale=" + config.scale + ":force_original_aspect_ratio=decrease,pad=" + config.scale + ":(ow-iw)/2:(oh-ih)/2,format=yuv420p" : "format=yuv420p";
      return metadataFor(filePath).then(function (metadata) {
        var readProgress = progressReader(Number(metadata.duration) || 0, onProgress);
        var progressArgs = ["-progress", "pipe:1", "-nostats"];
        var hardware = ["-hide_banner", "-loglevel", "error", "-hwaccel", "videotoolbox", "-i", filePath, "-vf", filter, "-c:v", "h264_videotoolbox", "-b:v", config.bitrate, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"].concat(progressArgs, ["-y", destination]);
        var software = ["-hide_banner", "-loglevel", "error", "-i", filePath, "-vf", filter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-threads", "0"].concat(progressArgs, ["-y", destination]);
        return runFfmpeg(hardware, destination, 600000, "user-transcode:" + destination, readProgress).catch(function (error) {
          if (error && error.code === "JOB_CANCELLED") { throw error; }
          if (typeof onProgress === "function") { onProgress({ ratio: 0, seconds: 0, duration: Number(metadata.duration) || 0, fallback: true }); }
          return runFfmpeg(software, destination, 600000, "user-transcode:" + destination, readProgress);
        });
      });
    }

    function isOwnedTranscodeTemporary(temporaryPath, sourcePath) {
      var name = path.basename(temporaryPath);
      return path.dirname(temporaryPath) === path.dirname(sourcePath) && name.charAt(0) === "." && /\.lkfb-part\.mp4$/.test(name);
    }

    function cleanupTranscodeTemporary(temporaryPath, sourcePath) {
      return new Promise(function (resolve) {
        if (!isOwnedTranscodeTemporary(temporaryPath, sourcePath)) { resolve(false); return; }
        fs.unlink(temporaryPath, function () { resolve(true); });
      });
    }

    function claimTranscodeOutput(temporaryPath, sourcePath, profile) {
      var directory = path.dirname(sourcePath);
      var base = path.basename(sourcePath, path.extname(sourcePath)).slice(0, 120) + "_Proxy_" + profile + "p";
      if (!isOwnedTranscodeTemporary(temporaryPath, sourcePath)) { return Promise.reject(new Error("INVALID_TEMPORARY_OUTPUT")); }
      return new Promise(function (resolve, reject) {
        function finish(destination) {
          fs.unlink(temporaryPath, function () { resolve(destination); });
        }
        function attempt(index) {
          var destination = path.join(directory, base + (index > 1 ? "-" + index : "") + ".mp4");
          fs.link(temporaryPath, destination, function (linkError) {
            if (!linkError) { finish(destination); return; }
            if (linkError.code === "EEXIST") { attempt(index + 1); return; }
            fs.copyFile(temporaryPath, destination, fs.constants.COPYFILE_EXCL, function (copyError) {
              if (!copyError) { finish(destination); return; }
              if (copyError.code === "EEXIST") { attempt(index + 1); return; }
              reject(copyError);
            });
          });
        }
        attempt(1);
      });
    }

    function cacheKey(filePath, stat) {
      return crypto.createHash("sha1").update(filePath + ":" + stat.size + ":" + stat.mtimeMs).digest("hex");
    }

    function metadataFor(filePath) {
      return statSource(filePath).then(function (stat) {
        var key = cacheKey(filePath, stat);
        var cacheFile;
        var ffprobe;
        if (memoryMetadata[key]) { return memoryMetadata[key]; }
        if (pendingMetadata[key]) { return pendingMetadata[key]; }
        /* v3 invalidates the old cache because container labels are now
           extension-aware (an .mp4 must not inherit QuickTime/MOV). */
        ensureDirectories(); cacheFile = path.join(metadataDirectory, key + "-v3.json");
        if (fs.existsSync(cacheFile)) {
          try { memoryMetadata[key] = JSON.parse(fs.readFileSync(cacheFile, "utf8")); return memoryMetadata[key]; } catch (ignoreCacheError) {}
        }
        ffprobe = findBinary("ffprobe");
        if (!ffprobe) { throw new Error("FFPROBE_NOT_FOUND"); }
        pendingMetadata[key] = new Promise(function (resolve, reject) {
          childProcess.execFile(ffprobe, ["-v", "error", "-show_format", "-show_streams", "-of", "json", filePath], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, function (error, stdout) {
            var normalized;
            delete pendingMetadata[key];
            if (error) { reject(error); return; }
            try {
              normalized = normalizeProbe(JSON.parse(stdout), stat, filePath); memoryMetadata[key] = normalized;
              fs.writeFileSync(cacheFile, JSON.stringify(normalized), "utf8"); resolve(normalized);
            } catch (parseError) { reject(parseError); }
          });
        });
        return pendingMetadata[key];
      });
    }

    function generateImage(filePath, kind) {
      return statSource(filePath).then(function (stat) {
        var key = cacheKey(filePath, stat);
        var destination;
        var ffmpeg;
        var args;
        ensureDirectories(); destination = path.join(kind === "poster" ? posterDirectory : waveformDirectory, key + "-v3.png");
        if (usableCacheFile(destination)) { return destination; }
        ffmpeg = findBinary("ffmpeg"); if (!ffmpeg) { throw new Error("FFMPEG_NOT_FOUND"); }
        args = kind === "waveform" ? ["-hide_banner", "-loglevel", "error", "-i", filePath, "-filter_complex", "[0:a:0]aformat=channel_layouts=mono,showwavespic=s=600x120:colors=0x62d684:scale=sqrt:draw=full[wave]", "-map", "[wave]", "-frames:v", "1", "-an", "-sn", "-dn", "-y", destination] : ["-hide_banner", "-loglevel", "error", "-ss", "0.5", "-i", filePath, "-frames:v", "1", "-vf", "scale=480:270:force_original_aspect_ratio=increase,crop=480:270", "-y", destination];
        return outputOnce(destination, function () { return runFfmpeg(args, destination, 45000, "derived:" + destination); });
      });
    }

    function posterFor(filePath) {
      /* A few camera/phone containers reject the crop filter even though a
         single decoded frame is available. Keep card mode useful by falling
         back to the frame renderer, which uses a simpler filter graph. */
      return generateImage(filePath, "poster").catch(function (error) {
        return previewProxyFor(filePath, "720").then(function (proxyPath) {
          return generateImage(proxyPath, "poster");
        }).catch(function () {
          return frameFor(filePath, 0.5, 480, 270).catch(function () {
            throw error;
          });
        });
      });
    }

    function previewStillFor(filePath) {
      return statSource(filePath).then(function (stat) {
        var key = cacheKey(filePath, stat) + "-ql-v1";
        var destination = path.join(stillPreviewDirectory, key + ".png");
        var workDirectory = path.join(stillPreviewDirectory, "." + key + "-" + process.pid);
        var extension = String(path.extname(filePath)).toLowerCase();
        if (usableCacheFile(destination)) { return destination; }
        if (extension === ".psd" || extension === ".psb") {
          return runFfmpeg(["-hide_banner", "-loglevel", "error", "-i", filePath, "-frames:v", "1", "-vf", "scale=960:960:force_original_aspect_ratio=decrease", "-y", destination], destination, 45000, "derived:" + destination);
        }
        fs.mkdirSync(workDirectory, { recursive: true });
        function quickLookFallback() { return new Promise(function (resolve, reject) {
          childProcess.execFile("/usr/bin/qlmanage", ["-t", "-s", "960", "-o", workDirectory, filePath], { timeout: 8000, maxBuffer: 1024 * 1024 }, function (error) {
            if (error) { reject(error); return; }
            fs.readdir(workDirectory, function (readError, names) {
              var generated;
              if (readError) { reject(readError); return; }
              generated = names.filter(function (name) { return /\.png$/i.test(name); })[0];
              if (!generated) { reject(new Error("QUICKLOOK_OUTPUT_NOT_CREATED")); return; }
              fs.copyFile(path.join(workDirectory, generated), destination, function (copyError) {
                fs.unlink(path.join(workDirectory, generated), function () { fs.rmdir(workDirectory, function () {}); });
                if (copyError) { reject(copyError); return; }
                resolve(destination);
              });
            });
          });
        }); }
        var pdfRenderer = ["/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm"].filter(function (candidate) { return fs.existsSync(candidate); })[0];
        if (!pdfRenderer) { return quickLookFallback(); }
        return new Promise(function (resolve, reject) {
          var destinationBase = destination.slice(0, -4);
          childProcess.execFile(pdfRenderer, ["-png", "-f", "1", "-l", "1", "-singlefile", "-scale-to", "960", filePath, destinationBase], { timeout: 45000, maxBuffer: 1024 * 1024 }, function (error) {
            if (!error && usableCacheFile(destination)) { resolve(destination); return; }
            reject(error || new Error("PDF_PREVIEW_NOT_CREATED"));
          });
        }).catch(quickLookFallback);
      });
    }

    function spriteFor(filePath) {
      return statSource(filePath).then(function (stat) {
        var key = cacheKey(filePath, stat);
        var destination;
        var ffmpeg;
        ensureDirectories(); destination = path.join(spriteDirectory, key + "-v3.jpg");
        ffmpeg = findBinary("ffmpeg"); if (!ffmpeg) { throw new Error("FFMPEG_NOT_FOUND"); }
        return metadataFor(filePath).then(function (metadata) {
          if (usableCacheFile(destination)) {
            return { path: destination, frames: SPRITE_FRAMES, frameCount: SPRITE_FRAMES, columns: SPRITE_COLUMNS, rows: SPRITE_ROWS, cellWidth: 240, cellHeight: 136, width: 960, height: 408, sampleTimes: spriteSampleTimes(metadata.duration, SPRITE_FRAMES) };
          }
        var times = spriteSampleTimes(metadata.duration, SPRITE_FRAMES);
        var videoStreamIndex = numberOrNull(metadata.videoStreamIndex);
        var args = ["-hide_banner", "-loglevel", "error"];
        var filters = [];
        var labels = [];
        var layout = [];
        var i;
        var column;
        var row;
        videoStreamIndex = videoStreamIndex === null ? 0 : videoStreamIndex;
        for (i = 0; i < times.length; i += 1) {
          args.push("-ss", times[i].toFixed(6), "-i", filePath);
          filters.push("[" + i + ":v:" + videoStreamIndex + "]scale=240:136:force_original_aspect_ratio=increase,crop=240:136,setsar=1[v" + i + "]");
          labels.push("[v" + i + "]");
          column = i % SPRITE_COLUMNS;
          row = Math.floor(i / SPRITE_COLUMNS);
          layout.push((column * 240) + "_" + (row * 136));
        }
        filters.push(labels.join("") + "xstack=inputs=" + SPRITE_FRAMES + ":layout=" + layout.join("|") + ":fill=black,format=yuvj420p[sheet]");
        args.push(
          "-filter_complex", filters.join(";"),
          "-map", "[sheet]", "-frames:v", "1", "-q:v", "4",
          "-an", "-sn", "-dn", "-y", destination
        );
        return outputOnce(destination, function () { return runFfmpeg(args, destination, 120000, "derived:" + destination).then(function () {
          return {
              path: destination,
              frames: SPRITE_FRAMES,
              frameCount: SPRITE_FRAMES,
              columns: SPRITE_COLUMNS,
              rows: SPRITE_ROWS,
              cellWidth: 240,
              cellHeight: 136,
              width: 960,
              height: 408,
              sampleTimes: times
            };
        });
        });
        });
      });
    }

    ensureDirectories();
    scheduleCachePrune();

    return {
      cacheRoot: cacheRoot,
      captureDirectory: captureDirectory,
      metadataFor: metadataFor,
      posterFor: posterFor,
      waveformFor: function (filePath) { return generateImage(filePath, "waveform"); },
      previewStillFor: previewStillFor,
      spriteFor: spriteFor,
      previewProxyFor: previewProxyFor,
      audioProxyFor: audioProxyFor,
      frameFor: frameFor,
      captureFrameForProject: captureFrameForProject,
      transcodeTo: transcodeTo,
      claimTranscodeOutput: claimTranscodeOutput,
      cleanupTranscodeTemporary: cleanupTranscodeTemporary,
      cancelViewerJobs: cancelViewerJobs,
      cancelPreviewJob: cancelPreviewJob,
      prioritizeViewer: prioritizeViewer,
      findBinary: findBinary
    };
  }

  return {
    create: create,
    normalizeProbe: normalizeProbe,
    displayFormat: displayFormat,
    containerToken: containerToken,
    dynamicRangeInfo: dynamicRangeInfo,
    alphaInfo: alphaInfo,
    rationalToNumber: rationalToNumber,
    formatDuration: formatDuration,
    formatBitrate: formatBitrate,
    spriteSampleTimes: spriteSampleTimes,
    spriteFrameAtProgress: spriteFrameAtProgress,
    SPRITE_FRAMES: SPRITE_FRAMES,
    SPRITE_COLUMNS: SPRITE_COLUMNS,
    SPRITE_ROWS: SPRITE_ROWS
  };
}));
