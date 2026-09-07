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
      startTime: numberOrNull(format.start_time) || 0,
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

  function spriteSampleTimes(duration, frameCount, frameRate) {
    var seconds = Math.max(numberOrNull(duration) || 0, 0.001);
    var rate = Math.max(numberOrNull(frameRate) || 10, 0.001);
    // Duration is the end of the last frame, not its timestamp; leave a frame margin.
    var latest = Math.max(0, seconds - Math.min(seconds, 2 / rate));
    var start = seconds * 0.04;
    var span = seconds * 0.92;
    var times = [];
    var i;
    for (i = 0; i < frameCount; i += 1) {
      times.push(Math.max(0, Math.min(latest, start + span * ((i + 0.5) / frameCount))));
    }
    return times;
  }

  function posterSampleTimes(duration) {
    var seconds = Math.max(numberOrNull(duration) || 0, 0);
    var ratios = [0.1, 0.35, 0.6];
    var latest;
    var times = [];
    if (!seconds) {
      return [0.5, 2, 5];
    }
    latest = Math.max(0, seconds - Math.min(0.05, seconds * 0.01));
    ratios.forEach(function (ratio) {
      var candidate = Math.max(0, Math.min(latest, seconds * ratio));
      candidate = Math.round(candidate * 1000) / 1000;
      if (times.indexOf(candidate) === -1) {
        times.push(candidate);
      }
    });
    return times.length ? times : [0];
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
    var extensionRoot = runtime.extensionRoot || (typeof __dirname === "string" ? path.resolve(__dirname, "..") : "");
    var mediaToolsPromise = null;
    var mediaToolsStatus = { state: "idle", source: null, architecture: null, error: null };
    var selectedMediaTools = null;
    var disposed = false;
    var cacheSettings = runtime.cacheSettings || {};
    var defaultCacheRoot = path.join(os.homedir(), "Library", "Caches", "com.fnnas.fnosbridge.mvp");
    var cacheRoot = cacheSettings.root ? path.join(path.resolve(cacheSettings.root), "com.fnnas.fnosbridge.mvp") : defaultCacheRoot;
    var assetDirectory = path.join(cacheRoot, "assets-v1");
    var retainDirectory = path.join(cacheRoot, "retains-v1");
    var lockDirectory = path.join(defaultCacheRoot, "resource-locks");
    var workerPath = path.join(typeof __dirname === "string" ? __dirname : path.join(extensionRoot, "js"), "media-worker.pl");
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
    var cancelledJobKeys = {};
    var cancelledPrefixes = {};
    var activeFfmpegCount = 0;
    var nextFfmpegJobId = 1;
    var MAX_FFMPEG_CONCURRENCY = 1;
    var activity = { scrolling: false, playing: false, hidden: false };
    var decoderThreads = (runtime.resourceProfile || runtime.performanceProfile) === "balanced" ? 2 : 1;
    var terminationGraceMs = Math.max(10, Number(runtime.terminationGraceMs) || 600);
    var cacheMaxBytes = Number(cacheSettings.maxBytes) || 12 * 1024 * 1024 * 1024;
    var cacheTargetBytes = Math.min(cacheMaxBytes, Number(cacheSettings.targetBytes) || 10 * 1024 * 1024 * 1024);
    var minimumFreeBytes = cacheSettings.minimumFreeBytes === 0 ? 0 : Number(cacheSettings.minimumFreeBytes) || 512 * 1024 * 1024;
    var cacheRecords = {};
    var cacheRetains = {};
    var cacheLeases = {};
    var cacheReservations = {};
    var cacheIndexPromise = null;
    var cacheMaintenance = Promise.resolve();
    var availableSpace = null;
    var availableSpaceAt = 0;
    var activeTemporaryPaths = {};
    var activeWorkDirectories = {};
    var cacheWorkDirectories = {};
    var nextTemporaryOutputId = 1;
    var assetRecords = {};
    var pendingAssetReads = {};
    var sourceValidations = {};
    var sourceValidationAt = {};
    var serviceToken = crypto.randomBytes(8).toString("hex");
    var assetWrites = {};
    var backgroundEpochs = {};
    var durableSubscribers = {};
    var passiveSubscribers = {};
    var jobThreadProfiles = {};
    var persistedPins = {};
    var otherInstanceRetains = {};
    var retainWrite = Promise.resolve();
    var cacheBytes = 0;
    var cacheLayerBytes = { images: 0, proxies: 0 };
    var layerMax = { images: Math.min(cacheMaxBytes, Number(cacheSettings.imageMaxBytes) || Math.max(1, Math.floor(cacheMaxBytes / 3))), proxies: Math.min(cacheMaxBytes, Number(cacheSettings.proxyMaxBytes) || Math.max(1, Math.floor(cacheMaxBytes * 2 / 3))) };
    if (cacheMaxBytes < 1024 * 1024) { layerMax.images = cacheMaxBytes; layerMax.proxies = cacheMaxBytes; }

    function assetId(filePath) { return crypto.createHash("sha1").update(path.resolve(filePath)).digest("hex"); }
    function sourceSignature(stat) { return String(stat.size) + ":" + String(stat.mtimeMs || stat.mtime && stat.mtime.getTime() || 0); }
    function assetFile(filePath) { return path.join(assetDirectory, assetId(filePath) + ".json"); }
    function artifactKey(kind, variant) { return kind === "proxy" ? "proxy:" + profileConfig(variant).name : kind; }
    function cacheLayer(filePath) { return /^(proxies|audio)$/.test(path.relative(cacheRoot, filePath).split(path.sep)[0]) ? "proxies" : "images"; }
    function forgetCacheFile(filePath) {
      if (!cacheRecords[filePath]) { return; }
      cacheBytes -= cacheRecords[filePath].size; cacheLayerBytes[cacheLayer(filePath)] -= cacheRecords[filePath].size; delete cacheRecords[filePath];
    }
    function rememberCacheFile(filePath, stat, usedMs, temporary) {
      forgetCacheFile(filePath);
      cacheRecords[filePath] = { path: filePath, size: stat.size, usedMs: usedMs || Date.now(), temporary: !!temporary };
      cacheBytes += stat.size; cacheLayerBytes[cacheLayer(filePath)] += stat.size;
    }
    function loadAsset(filePath, refresh) {
      var id = assetId(filePath);
      if (assetRecords[id] && !refresh) { return Promise.resolve(assetRecords[id]); }
      if (pendingAssetReads[id]) { return pendingAssetReads[id]; }
      pendingAssetReads[id] = cacheCall("readFile", [assetFile(filePath), "utf8"]).then(function (data) {
        var record = JSON.parse(data);
        if (record.version !== 1 || record.source !== path.resolve(filePath) || typeof record.signature !== "string" || !record.artifacts || typeof record.artifacts !== "object" || Array.isArray(record.artifacts)) { return null; }
        assetRecords[id] = record;
        return record;
      }).catch(function () { return null; }).then(function (record) { delete pendingAssetReads[id]; return record; });
      return pendingAssetReads[id];
    }
    function saveAsset(record) {
      var destination = assetFile(record.source);
      var result = (assetWrites[destination] || Promise.resolve()).then(function () {
        var temporary = cacheTemporaryPath(destination);
        return new Promise(function (resolve, reject) {
          childProcess.execFile("/usr/bin/perl", [workerPath, "--index", destination, temporary, JSON.stringify(record)], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 }, function (error, stdout) {
            if (error) { removeFailedCacheFile(temporary); reject(error); return; }
            try {
              var stored = JSON.parse(stdout);
              if (stored.signature === record.signature) { stored.artifacts = Object.assign({}, stored.artifacts, record.artifacts); }
              if ((record.pinnedAt || 0) > (stored.pinnedAt || 0)) { stored.pinned = record.pinned; stored.pinnedAt = record.pinnedAt; }
              if ((record.validatedAt || 0) <= (stored.validatedAt || 0)) { Object.assign(record, stored); }
              resolve();
            } catch (parseError) { reject(parseError); }
          });
        });
      });
      assetWrites[destination] = result.catch(function () {});
      return result;
    }
    function recordArtifact(filePath, stat, kind, value, variant) {
      return cacheCall("stat", [filePath]).then(function (current) {
        if (sourceSignature(current) !== sourceSignature(stat)) { var error = new Error("SOURCE_CHANGED"); error.code = "SOURCE_CHANGED"; throw error; }
        return loadAsset(filePath);
      }).then(function (record) {
        var signature = sourceSignature(stat);
        if (!record || record.signature !== signature) { record = { version: 1, source: path.resolve(filePath), signature: signature, artifacts: {}, pinned: !!(record && record.pinned), pinnedAt: record && record.pinnedAt || 0 }; }
        record.artifacts[artifactKey(kind, variant)] = kind === "metadata" ? { metadata: value } : typeof value === "string" ? { path: path.relative(cacheRoot, value) } : Object.assign({}, value, { path: path.relative(cacheRoot, value.path) });
        record.validatedAt = Date.now(); record.offline = false;
        assetRecords[assetId(filePath)] = record;
        if (record.pinned && kind !== "metadata") { persistedPins[typeof value === "string" ? value : value.path] = true; }
        return saveAsset(record).then(function () { return value; });
      });
    }
    function cachedPreviewFor(filePath, kind, variant, refreshed) {
      return loadAsset(filePath).then(function (record) {
        var artifact = record && record.artifacts[artifactKey(kind, variant)];
        var result;
        var actualKind = kind;
        if (record && kind === "poster" && !artifact) { actualKind = record.artifacts.still ? "still" : "waveform"; artifact = record.artifacts[actualKind]; }
        if (record && kind === "proxy" && !variant) {
          ["540", "720", "360", "480", "1080", "source", "4k"].some(function (quality) { if (record.artifacts["proxy:" + quality]) { artifact = record.artifacts["proxy:" + quality]; return true; } return false; });
        }
        if (!artifact || typeof artifact !== "object") {
          if (record && !refreshed) { return loadAsset(filePath, true).then(function () { return cachedPreviewFor(filePath, kind, variant, true); }); }
          return null;
        }
        result = Object.assign({}, artifact, { sourceSignature: record.signature, cached: true, offline: !!record.offline, metadata: record.artifacts.metadata && record.artifacts.metadata.metadata || artifact.metadata });
        if (kind === "metadata") { return result.metadata && typeof result.metadata === "object" ? result : null; }
        if (typeof artifact.path !== "string" || path.isAbsolute(artifact.path)) { return null; }
        result.path = path.resolve(cacheRoot, artifact.path);
        var allowedDirectory = actualKind === "poster" ? posterDirectory : kind === "sprite" ? spriteDirectory : kind === "proxy" ? proxyDirectory : actualKind === "still" ? stillPreviewDirectory : actualKind === "waveform" ? waveformDirectory : "";
        if (!allowedDirectory || path.dirname(result.path) !== allowedDirectory || !ownedCachePath(result.path) || !usableCacheFile(result.path)) { return null; }
        if (kind === "sprite" && (!Array.isArray(result.sampleTimes) || result.sampleTimes.length !== SPRITE_FRAMES || result.sampleTimes.some(function (time) { return !isFinite(time) || time < 0; }))) { return null; }
        if (record.pinned) { persistedPins[result.path] = true; }
        return result;
      });
    }
    function validateSourceInBackground(filePath) {
      if (disposed) { return; }
      if (sourceValidations[filePath] || Date.now() - (sourceValidationAt[filePath] || 0) < 30000) { return; }
      sourceValidationAt[filePath] = Date.now();
      sourceValidations[filePath] = setTimeout(function () {
        delete sourceValidations[filePath];
        if (activity.scrolling || activity.playing || activity.hidden) { sourceValidationAt[filePath] = 0; return; }
        delete sourceStatCache[filePath];
        statSource(filePath).then(function (stat) {
          return loadAsset(filePath).then(function (record) {
            if (!record) { return; }
            if (record.signature !== sourceSignature(stat)) { record.signature = sourceSignature(stat); record.artifacts = {}; }
            record.offline = false; record.validatedAt = Date.now();
            return saveAsset(record);
          });
        }).catch(function () { var record = assetRecords[assetId(filePath)]; if (record) { record.offline = true; saveAsset(record).catch(function () {}); } });
      }, Number(runtime.sourceValidationDelayMs) || 1000);
      if (sourceValidations[filePath].unref) { sourceValidations[filePath].unref(); }
    }
    function pinCachedAsset(filePath, pinned) {
      return loadAsset(filePath).then(function (record) {
        if (!record) { record = { version: 1, source: path.resolve(filePath), signature: "", artifacts: {} }; assetRecords[assetId(filePath)] = record; }
        record.pinned = !!pinned;
        record.pinnedAt = Date.now();
        Object.keys(record.artifacts).forEach(function (key) {
          var artifact = record.artifacts[key];
          if (artifact.path && !path.isAbsolute(artifact.path)) { var candidate = path.resolve(cacheRoot, artifact.path); if (ownedCachePath(candidate)) { if (pinned) { persistedPins[candidate] = true; } else { delete persistedPins[candidate]; } } }
        });
        return saveAsset(record).then(function () { return !!pinned; });
      });
    }
    function validateCachedAsset(filePath) {
      delete sourceStatCache[filePath];
      return statSource(filePath).then(function (stat) {
        return loadAsset(filePath).then(function (record) {
          if (!record) { return null; }
          if (record.signature !== sourceSignature(stat)) { record.signature = sourceSignature(stat); record.artifacts = {}; }
          record.validatedAt = Date.now(); record.offline = false;
          return saveAsset(record).then(function () { return record; });
        });
      });
    }
    function refreshPersistentPins() {
      var pins = {};
      return cacheCall("readdir", [assetDirectory]).then(function (names) {
        names = names.filter(function (name) { return /^[a-f0-9]{40}\.json$/.test(name); });
        var cursor = 0;
        function batch() {
          var group = names.slice(cursor, cursor + 24); cursor += group.length;
          if (!group.length) { return; }
          return Promise.all(group.map(function (name) {
          return cacheCall("readFile", [path.join(assetDirectory, name), "utf8"]).then(function (data) {
            var record = JSON.parse(data);
            if (record.version !== 1 || !record.pinned || !record.artifacts) { return; }
            Object.keys(record.artifacts).forEach(function (key) {
              var relative = record.artifacts[key].path;
              if (typeof relative === "string" && !path.isAbsolute(relative)) { var candidate = path.resolve(cacheRoot, relative); if (ownedCachePath(candidate)) { pins[candidate] = true; } }
            });
          }).catch(function () {});
          })).then(batch);
        }
        return batch();
      }).then(function () { persistedPins = pins; return refreshInstanceRetains(); });
    }
    function refreshInstanceRetains() {
      var retains = {};
      return cacheCall("readdir", [retainDirectory]).then(function (names) {
        return Promise.all(names.filter(function (name) { return /^\d+-[a-f0-9]+\.json$/.test(name); }).map(function (name) {
          if (name === process.pid + "-" + serviceToken + ".json") { return; }
          var ownerPid = Number(name.split("-")[0]);
          try { process.kill(ownerPid, 0); } catch (error) { if (error.code === "ESRCH") { return; } }
          return cacheCall("readFile", [path.join(retainDirectory, name), "utf8"]).then(function (data) {
            var items = JSON.parse(data);
            if (!Array.isArray(items)) { return; }
            items.forEach(function (relative) { if (typeof relative === "string" && !path.isAbsolute(relative)) { var candidate = path.resolve(cacheRoot, relative); if (ownedCachePath(candidate)) { retains[candidate] = true; } } });
          }).catch(function () {});
        }));
      }).then(function () { otherInstanceRetains = retains; });
    }
    function persistRetains() {
      var destination = path.join(retainDirectory, process.pid + "-" + serviceToken + ".json");
      retainWrite = retainWrite.then(function () {
        var temporary = destination + ".part";
        var items = Object.keys(cacheRetains).filter(function (filePath) { return cacheRetains[filePath] > 0; }).map(function (filePath) { return path.relative(cacheRoot, filePath); });
        return cacheCall("writeFile", [temporary, JSON.stringify(items), "utf8"]).then(function () { return cacheCall("rename", [temporary, destination]); });
      }).catch(function () {});
      return retainWrite;
    }

    function statSource(filePath) {
      var now = Date.now();
      var cached = sourceStatCache[filePath];
      if (cached && now - cached.at < (runtime.sourceStatTtlMs === 0 ? 0 : 1500)) { return Promise.resolve(cached.stat); }
      if (pendingSourceStats[filePath]) { return pendingSourceStats[filePath]; }
      if (sourceStatCooldown[filePath] && sourceStatCooldown[filePath] > now) { return Promise.reject(new Error("SOURCE_TIMEOUT")); }
      var request = new Promise(function (resolve, reject) {
        var timedOut = false;
        var finished = false;
        var timeout = setTimeout(function () {
          timedOut = true; finished = true; delete pendingSourceStats[filePath]; sourceStatCooldown[filePath] = Date.now() + 30000;
          reject(new Error("SOURCE_TIMEOUT"));
        }, 15000);
        function statCompleted(error, stat) {
          if (timedOut || finished) { return; }
          finished = true;
          clearTimeout(timeout); delete pendingSourceStats[filePath];
          if (error) { reject(error); return; }
          if (!stat || !stat.isFile()) { reject(new Error("FILE_NOT_FOUND")); return; }
          sourceStatCache[filePath] = { stat: stat, at: Date.now() }; resolve(stat);
        }
        try { fs.stat(filePath, statCompleted); } catch (error) { statCompleted(error); }
      });
      pendingSourceStats[filePath] = request.then(function (stat) {
        delete pendingSourceStats[filePath]; return stat;
      }, function (error) { delete pendingSourceStats[filePath]; throw error; });
      return pendingSourceStats[filePath];
    }

    function usableCacheFile(filePath) {
      try {
        var stat = fs.lstatSync(filePath);
        if (!stat.isFile() || stat.size <= 0) { return false; }
        if (/\.(png|jpg|jpeg)$/i.test(filePath)) {
          var descriptor = fs.openSync(filePath, "r");
          var header = Buffer.alloc(8);
          try { fs.readSync(descriptor, header, 0, 8, 0); } finally { fs.closeSync(descriptor); }
          if (/\.png$/i.test(filePath) ? header.toString("hex") !== "89504e470d0a1a0a" : header[0] !== 255 || header[1] !== 216 || header[2] !== 255) { return false; }
        }
        if (filePath.indexOf(cacheRoot + path.sep) === 0) {
          cacheLeases[filePath] = Date.now() + 10000;
          if (cacheRecords[filePath]) { cacheRecords[filePath].usedMs = Date.now(); }
        }
        return true;
      } catch (error) {
        return false;
      }
    }

    function removeFailedCacheFile(filePath) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          forgetCacheFile(filePath);
        }
      } catch (ignoreCleanupError) {}
    }

    function ensureDirectories() {
      [cacheRoot, assetDirectory, retainDirectory, lockDirectory, metadataDirectory, posterDirectory, spriteDirectory, waveformDirectory, proxyDirectory, frameDirectory, audioProxyDirectory, stillPreviewDirectory].forEach(function (directory) {
        fs.mkdirSync(directory, { recursive: true });
        if (fs.lstatSync(directory).isSymbolicLink()) { throw new Error("CACHE_DIRECTORY_SYMLINK"); }
      });
    }

    function cacheCall(method, args) {
      return new Promise(function (resolve, reject) {
        var finished = false;
        var timer = setTimeout(function () {
          if (finished) { return; } finished = true; reject(new Error("CACHE_IO_TIMEOUT"));
        }, 5000);
        function done(error, result) {
          if (finished) { return; } finished = true; clearTimeout(timer);
          if (error) { reject(error); } else { resolve(result); }
        }
        try { fs[method].apply(fs, args.concat(done)); } catch (error) { done(error); }
      });
    }

    function ownedCachePath(filePath) {
      return path.resolve(filePath).indexOf(cacheRoot + path.sep) === 0;
    }

    function cacheProtected(filePath) {
      return persistedPins[filePath] || otherInstanceRetains[filePath] || cacheRetains[filePath] > 0 || cacheLeases[filePath] > Date.now() || pendingOutputs[filePath] || activeTemporaryPaths[filePath] || cacheRecords[filePath] && cacheRecords[filePath].temporary && !deadTemporaryOwner(filePath);
    }
    function deadTemporaryOwner(filePath) {
      var relative = path.relative(cacheRoot, filePath);
      var match = relative.match(/\.(\d+)-(?:[a-f0-9]+-)?\d+\.part\./) || relative.match(/-(\d+)-\d+(?:-[a-f0-9]+)?(?:\/|$)/);
      if (!match || Number(match[1]) < 1) { return false; }
      try { process.kill(Number(match[1]), 0); return false; } catch (error) { return error.code === "ESRCH"; }
    }

    function retainCacheFile(filePath) {
      if (!filePath || !ownedCachePath(filePath)) { return; }
      cacheRetains[filePath] = (cacheRetains[filePath] || 0) + 1;
      return persistRetains();
    }

    function releaseCacheFile(filePath) {
      if (!filePath || !cacheRetains[filePath]) { return; }
      cacheRetains[filePath] -= 1;
      if (!cacheRetains[filePath]) { delete cacheRetains[filePath]; }
      return persistRetains();
    }

    function recordCacheFile(filePath) {
      return cacheCall("lstat", [filePath]).then(function (stat) {
        if (stat.isFile() && !stat.isSymbolicLink()) {
          rememberCacheFile(filePath, stat);
        }
      });
    }

    function indexCache() {
      if (cacheIndexPromise) { return cacheIndexPromise; }
      var directories = [metadataDirectory, posterDirectory, spriteDirectory, waveformDirectory, proxyDirectory, frameDirectory, audioProxyDirectory, stillPreviewDirectory];
      function visit(directory) {
        return cacheCall("readdir", [directory]).then(function (names) {
          var cursor = 0;
          function batch() {
            var group = names.slice(cursor, cursor + 24); cursor += group.length;
            if (!group.length) { return; }
            return Promise.all(group.map(function (name) {
              var filePath = path.join(directory, name);
              return cacheCall("lstat", [filePath]).then(function (stat) {
                if (stat.isSymbolicLink()) { return; }
                if (stat.isDirectory() && name.charAt(0) === "." && /^\.(?:[a-f0-9]{40}|sprite)-/.test(name)) {
                  cacheWorkDirectories[filePath] = stat.mtimeMs || stat.mtime.getTime();
                  return visit(filePath);
                }
                if (stat.isFile() && !cacheRecords[filePath] && (directories.indexOf(directory) === -1 || /^[a-f0-9]{40}[-.].+\.(?:png|jpg|mp4|m4a|json)$/.test(name))) {
                  rememberCacheFile(filePath, stat, stat.mtimeMs || stat.mtime.getTime(), name.charAt(0) === "." || /\.part\./.test(name) || directories.indexOf(directory) === -1);
                }
              }).catch(function (error) { if (error.code !== "ENOENT") { throw error; } });
            })).then(batch);
          }
          return batch();
        });
      }
      cacheIndexPromise = refreshPersistentPins().then(function () { return Promise.all(directories.map(visit)); }).catch(function (error) { cacheIndexPromise = null; throw error; });
      return cacheIndexPromise;
    }

    function cacheTotals() {
      var reserved = Object.keys(cacheReservations).reduce(function (sum, key) { return sum + cacheReservations[key]; }, 0);
      return { bytes: cacheBytes, reservedBytes: reserved, maxBytes: cacheMaxBytes, targetBytes: cacheTargetBytes, root: cacheRoot, layers: { images: { bytes: cacheLayerBytes.images, maxBytes: layerMax.images }, proxies: { bytes: cacheLayerBytes.proxies, maxBytes: layerMax.proxies } }, pinnedFiles: Object.keys(persistedPins).length };
    }

    function pruneCacheInternal(extraBytes, force, outputPath) {
      return indexCache().then(function () {
        var total = cacheTotals().bytes;
        var reservation = cacheTotals().reservedBytes + (Number(extraBytes) || 0);
        var budgetExceeded = total + reservation > cacheMaxBytes;
        var layer = outputPath ? cacheLayer(outputPath) : cacheLayerBytes.images > layerMax.images ? "images" : cacheLayerBytes.proxies > layerMax.proxies ? "proxies" : null;
        var layerReservation = layer ? Object.keys(cacheReservations).reduce(function (sum, key) { return sum + (cacheLayer(key) === layer ? cacheReservations[key] : 0); }, 0) + (Number(extraBytes) || 0) : 0;
        var layerExceeded = layer && cacheLayerBytes[layer] + layerReservation > layerMax[layer];
        if (!force && !budgetExceeded && !layerExceeded && !Object.keys(cacheWorkDirectories).some(function (directory) { return cacheWorkDirectories[directory] < Date.now() - 3600000; })) { return cacheTotals(); }
        return refreshPersistentPins().then(function () {
        var target = force ? 0 : budgetExceeded ? Math.max(0, Math.min(cacheTargetBytes, cacheMaxBytes - reservation)) : total;
        var records = Object.keys(cacheRecords).map(function (key) { return cacheRecords[key]; }).sort(function (a, b) { return a.usedMs - b.usedMs; });
        var chain = Promise.resolve();
        records.forEach(function (record) {
          chain = chain.then(function () {
            var staleTemporary = record.temporary && record.usedMs < Date.now() - 3600000;
            if (!force && layer && cacheLayer(record.path) !== layer) { return; }
            if ((!staleTemporary && total <= target && !(layer && cacheLayer(record.path) === layer && cacheLayerBytes[layer] + layerReservation > layerMax[layer])) || cacheProtected(record.path)) { return; }
            return cacheCall("unlink", [record.path]).then(function () {
              total -= record.size; forgetCacheFile(record.path);
            }, function (error) {
              if (error.code === "ENOENT") { total -= record.size; forgetCacheFile(record.path); }
            });
          });
        });
        return chain.then(function () {
          return Promise.all(Object.keys(cacheWorkDirectories).map(function (directory) {
            if (cacheWorkDirectories[directory] > Date.now() - 3600000 || activeWorkDirectories[directory] || !deadTemporaryOwner(directory)) { return; }
            return removeOwnedWorkDirectory(directory).then(function () { delete cacheWorkDirectories[directory]; });
          }));
        }).then(function () {
          if (total + reservation > cacheMaxBytes || (layer && cacheLayerBytes[layer] + layerReservation > layerMax[layer])) { var error = new Error("CACHE_BUDGET_EXCEEDED"); error.code = "CACHE_BUDGET_EXCEEDED"; throw error; }
          return cacheTotals();
        });
        });
      });
    }

    function cacheTask(operation) {
      var result = cacheMaintenance.then(operation, operation);
      cacheMaintenance = result.catch(function () {});
      return result;
    }

    function pruneCache(options) {
      return cacheTask(function () { return pruneCacheInternal(0, options && options.clearUnused); });
    }

    function checkAvailableSpace() {
      if (!minimumFreeBytes) { return Promise.resolve(); }
      if (availableSpace !== null && Date.now() - availableSpaceAt < 5000) {
        return availableSpace < minimumFreeBytes ? Promise.reject(new Error("CACHE_DISK_FULL")) : Promise.resolve();
      }
      var request;
      if (typeof runtime.availableCacheBytes === "function") { request = Promise.resolve().then(runtime.availableCacheBytes); }
      else if (typeof fs.statfs === "function") {
        request = cacheCall("statfs", [cacheRoot]).then(function (stat) { return Number(stat.bavail) * Number(stat.bsize); });
      } else {
        request = execFileQueued("/bin/df", ["-Pk", cacheRoot], { timeout: 5000, maxBuffer: 32768 }, "disk:cache").then(function (result) {
          var line = String(result.stdout).trim().split(/\n/).pop().trim().split(/\s+/);
          var free = Number(line[3]) * 1024;
          if (!isFinite(free)) { throw new Error("CACHE_SPACE_UNAVAILABLE"); }
          return free;
        });
      }
      return request.then(function (free) {
        availableSpace = free; availableSpaceAt = Date.now();
        if (free < minimumFreeBytes) { var error = new Error("CACHE_DISK_FULL"); error.code = "CACHE_DISK_FULL"; throw error; }
      });
    }

    function prepareCacheOutput(temporary, destination, args) {
      var isProxy = /\.(mp4|m4a)$/.test(destination);
      var inputIndex = args.indexOf("-i");
      var inputStat = inputIndex >= 0 && sourceStatCache[args[inputIndex + 1]];
      var estimatedBytes = inputStat ? inputStat.stat.size * 2 + 16 * 1024 * 1024 : 256 * 1024 * 1024;
      var diskLimit = 0;
      var reservation = Math.min(cacheMaxBytes, layerMax[cacheLayer(destination)], isProxy ? Number(cacheSettings.proxyReservationBytes) || Math.max(64 * 1024 * 1024, estimatedBytes) : 8 * 1024 * 1024);
      return checkAvailableSpace().then(function () {
        if (availableSpace !== null) {
          diskLimit = Math.max(0, availableSpace - minimumFreeBytes - cacheTotals().reservedBytes);
          if (diskLimit < 8 * 1024 * 1024) { throw new Error("CACHE_DISK_FULL"); }
          reservation = Math.min(reservation, diskLimit);
        }
        return cacheTask(function () {
          return pruneCacheInternal(reservation, false, destination).then(function () {
            cacheReservations[temporary] = reservation; activeTemporaryPaths[temporary] = true;
            args.splice(args.length - 1, 0, "-fs", String(reservation));
          });
        });
      });
    }

    function unavailableTools(details) {
      var error = new Error(details && details.message || "媒体组件无法运行。请重新运行安装包中的安装程序，然后重新打开插件；仍有问题时请查看安装说明的故障排查。");
      error.code = "MEDIA_TOOLS_UNAVAILABLE";
      error.attempts = details && Array.isArray(details.attempts) ? details.attempts : [];
      return error;
    }

    function resolveMediaTools() {
      if (typeof runtime.resolveMediaTools === "function") { return runtime.resolveMediaTools({ extensionRoot: extensionRoot, home: os.homedir() }); }
      return new Promise(function (resolve, reject) {
        var child = null;
        var settled = false;
        var timeout = setTimeout(function () {
          if (settled) { return; }
          settled = true;
          try { if (child) { child.kill("SIGKILL"); } } catch (ignoreKillError) {}
          reject(unavailableTools({ message: "媒体组件检查超时。请重新运行安装程序，并查看安装说明中的故障排查。" }));
        }, Number(runtime.mediaToolsTimeoutMs) || 35000);
        function completed(error, stdout) {
          var result;
          if (settled) { return; }
          settled = true; clearTimeout(timeout);
          try { result = JSON.parse(String(stdout || "")); }
          catch (parseError) { reject(unavailableTools()); return; }
          if (error || !result || !result.ok) { reject(unavailableTools(result)); return; }
          resolve(result);
        }
        try {
          child = childProcess.execFile("/usr/bin/perl", [path.join(extensionRoot, "js", "resolve-media-tools.pl"), "--root", extensionRoot, "--home", os.homedir()], { timeout: 35000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, encoding: "utf8" }, completed);
        } catch (spawnError) { completed(spawnError, ""); }
      });
    }

    function prepare(options) {
      if (disposed) { return Promise.reject(new Error("MEDIA_SERVICE_CLOSED")); }
      if (mediaToolsPromise && !(options && options.retry && mediaToolsStatus.state !== "checking")) { return mediaToolsPromise; }
      if (options && options.retry && mediaToolsStatus.state === "ready" &&
          (activeFfmpegCount || ffmpegQueue.length || Object.keys(pendingOutputs).length || Object.keys(pendingMetadata).length || Object.keys(pendingSourceStats).length)) {
        var busy = new Error("媒体任务正在运行，请等待完成后再重新检查。");
        busy.code = "MEDIA_TOOLS_BUSY";
        return Promise.reject(busy);
      }
      mediaToolsStatus.state = "checking";
      mediaToolsPromise = Promise.resolve().then(resolveMediaTools).then(function (result) {
        if (!result || !result.ok || ["system", "bundled"].indexOf(result.source) === -1 ||
            ["arm64", "x64"].indexOf(result.architecture) === -1 ||
            typeof result.ffmpeg !== "string" || typeof result.ffprobe !== "string" ||
            !path.isAbsolute(result.ffmpeg) || !path.isAbsolute(result.ffprobe) ||
            path.dirname(result.ffmpeg) !== path.dirname(result.ffprobe) ||
            path.basename(result.ffmpeg) !== "ffmpeg" || path.basename(result.ffprobe) !== "ffprobe") {
          throw unavailableTools(result);
        }
        selectedMediaTools = { ffmpeg: result.ffmpeg, ffprobe: result.ffprobe };
        mediaToolsStatus = { state: "ready", source: result.source, architecture: result.architecture, version: result.version || "", error: null };
        return getStatus();
      }).catch(function (error) {
        error = error && error.code === "MEDIA_TOOLS_UNAVAILABLE" ? error : unavailableTools(error);
        selectedMediaTools = null;
        mediaToolsStatus = { state: "unavailable", source: null, architecture: null, error: error };
        throw error;
      });
      return mediaToolsPromise;
    }

    function getStatus() {
      return { state: mediaToolsStatus.state, source: mediaToolsStatus.source, architecture: mediaToolsStatus.architecture, version: mediaToolsStatus.version || "", error: mediaToolsStatus.error };
    }

    function findBinary(name) {
      return selectedMediaTools && (name === "ffmpeg" || name === "ffprobe") ? selectedMediaTools[name] : null;
    }

    function cancellationGuard(jobKey) {
      var epoch = cancelledJobKeys[jobKey] || 0;
      function prefixEpoch() {
        return Object.keys(cancelledPrefixes).reduce(function (sum, prefix) { return sum + (String(jobKey).indexOf(prefix) === 0 ? cancelledPrefixes[prefix] : 0); }, 0);
      }
      var prefix = prefixEpoch();
      return function () {
        if ((cancelledJobKeys[jobKey] || 0) !== epoch || prefixEpoch() !== prefix) { throw cancelledError(); }
      };
    }

    function whenMediaToolsReady(method, prefix, kind) {
      return function () {
        var args = arguments;
        var assertCurrent = cancellationGuard(prefix + String(args[0] || ""));
        var options = kind === "proxy" ? args[2] || (typeof args[1] === "object" ? args[1] : {}) : args[1] && typeof args[1] === "object" ? args[1] : {};
        var epoch = backgroundEpochs[args[0]] || 0;
        var passive = ["poster", "sprite", "still", "waveform"].indexOf(kind) !== -1 && options.purpose !== "offline" && options.purpose !== "foreground";
        var cancelled = false;
        var jobKey = kind ? producerKey(kind, args[0], options) : prefix + String(args[0] || "");
        if (options.profile === "low" || options.profile === "balanced") { jobThreadProfiles[jobKey] = options.profile === "balanced" ? 2 : 1; }
        assertCurrent = cancellationGuard(jobKey);
        var durable = options.purpose === "offline" || options.purpose === "foreground";
        if (durable) { durableSubscribers[args[0]] = (durableSubscribers[args[0]] || 0) + 1; }
        if (passive) { passiveSubscribers[args[0]] = (passiveSubscribers[args[0]] || 0) + 1; }
        var rejectAbort;
        var aborted = new Promise(function (_resolve, reject) { rejectAbort = reject; });
        function check() { assertCurrent(); if (disposed || cancelled || options.signal && (options.signal.aborted || options.signal.cancelled) || passive && epoch !== (backgroundEpochs[args[0]] || 0)) { throw cancelledError(); } }
        function abort() { cancelled = true; cancelJobKey(jobKey); if (options.purpose === "offline") { cancelJobKey("offline:metadata:" + args[0]); } rejectAbort(cancelledError()); }
        if (options.signal && options.signal.addEventListener) { options.signal.addEventListener("abort", abort); }
        var removeCancel = options.signal && options.signal.onCancel ? options.signal.onCancel(abort) : null;
        var request = Promise.resolve().then(function () {
          check();
          return options.purpose === "offline" ? validateCachedAsset(args[0]) : null;
        }).then(function () {
          check();
          return kind ? cachedPreviewFor(args[0], kind, typeof args[1] === "string" ? args[1] : options.profile) : null;
        }).then(function (cached) {
          check();
          if (cached) { validateSourceInBackground(args[0]); return kind === "metadata" ? cached.metadata : kind === "sprite" ? cached : cached.path; }
          return prepare().then(function () {
          check();
          assertCurrent();
          return method.apply(null, args);
          }, function (error) { check(); throw error; });
        });
        function cleanup() {
          if (durable) { durableSubscribers[args[0]] = Math.max(0, (durableSubscribers[args[0]] || 0) - 1); }
          if (passive) { passiveSubscribers[args[0]] = Math.max(0, (passiveSubscribers[args[0]] || 0) - 1); }
          if (options.signal && options.signal.removeEventListener) { options.signal.removeEventListener("abort", abort); }
          if (removeCancel) { removeCancel(); }
        }
        return Promise.race([request, aborted]).then(function (result) { cleanup(); check(); return result; }, function (error) { cleanup(); throw error; });
      };
    }

    function cancelledError() {
      var error = new Error("JOB_CANCELLED");
      error.code = "JOB_CANCELLED";
      return error;
    }

    function terminalMediaError(error) {
      return !!(error && (error.code === "JOB_CANCELLED" || error.code === "MEDIA_PROCESS_TIMEOUT" || /^(CACHE_|MEDIA_TOOLS_|FFMPEG_NOT_FOUND|FFPROBE_NOT_FOUND)/.test(error.code || error.message || "")));
    }

    function pumpFfmpegQueue() {
      var job;
      var index;
      while (activeFfmpegCount < MAX_FFMPEG_CONCURRENCY && ffmpegQueue.length) {
        index = ffmpegQueue.findIndex(function (candidate) {
          return /^(preview|audio|capture|frame|user-transcode):/.test(candidate.key) || !(activity.scrolling || activity.playing || activity.hidden);
        });
        if (index < 0) { return; }
        job = ffmpegQueue.splice(index, 1)[0];
        if (job.cancelled) { continue; }
        activeFfmpegCount += 1; activeFfmpegJobs[job.id] = job;
        (function (current) {
          current.timeoutTimer = setTimeout(function () {
            var timeoutError = new Error("MEDIA_PROCESS_TIMEOUT"); timeoutError.code = "MEDIA_PROCESS_TIMEOUT";
            terminateJob(current, timeoutError);
          }, Math.max(1, Number(current.options.timeout) || 120000));
          try {
            current.child = childProcess.execFile(current.binary, current.args, current.options, function (error, stdout, stderr) {
              settleJob(current, current.cancelled ? (current.stopError || cancelledError()) : error, { stdout: stdout, stderr: stderr });
              releaseJob(current);
            });
            if (current.onOutput && current.child && current.child.stdout) {
              current.child.stdout.on("data", function (chunk) { if (!current.settled) { current.onOutput(chunk); } });
            }
          } catch (spawnError) {
            settleJob(current, spawnError); releaseJob(current);
          }
        }(job));
      }
    }

    function settleJob(job, error, result) {
      if (job.settled) { return; }
      job.settled = true;
      if (error) { job.reject(error); } else { job.resolve(result); }
    }

    function releaseJob(job) {
      if (job.released) { return; }
      job.released = true;
      clearTimeout(job.timeoutTimer); clearTimeout(job.killTimer);
      activeFfmpegCount = Math.max(0, activeFfmpegCount - 1);
      delete activeFfmpegJobs[job.id];
      if (job.cancelled && typeof job.onReaped === "function") { job.onReaped(); }
      pumpFfmpegQueue();
    }

    function terminateJob(job, error) {
      if (job.cancelled || job.released) { return; }
      job.cancelled = true; job.stopError = error || cancelledError();
      settleJob(job, job.stopError);
      clearTimeout(job.timeoutTimer);
      job.killTimer = setTimeout(function () {
        signalJob(job, "SIGKILL");
        releaseJob(job);
      }, terminationGraceMs);
      signalJob(job, "SIGTERM");
    }

    function signalJob(job, signal) {
      try {
        if (job.options.detached && job.child && job.child.pid) { process.kill(-job.child.pid, signal); }
        else if (job.child) { job.child.kill(signal); }
      } catch (ignoreSignalError) { try { if (job.child) { job.child.kill(signal); } } catch (ignoreKillError) {} }
    }

    function execFileQueued(binary, args, options, jobKey, onOutput, onReaped) {
      return new Promise(function (resolve, reject) {
        var job = { id: nextFfmpegJobId, binary: binary, args: args, options: options, key: jobKey || "derived", onOutput: onOutput, onReaped: onReaped, resolve: resolve, reject: reject, child: null, cancelled: false };
        nextFfmpegJobId += 1;
        if (/^(preview|audio|capture|frame|user-transcode):/.test(job.key)) { ffmpegQueue.unshift(job); }
        else { ffmpegQueue.push(job); }
        pumpFfmpegQueue();
      });
    }

    function cancelJobKey(jobKey) {
      cancelledJobKeys[jobKey] = (cancelledJobKeys[jobKey] || 0) + 1;
      ffmpegQueue = ffmpegQueue.filter(function (job) {
        if (job.key !== jobKey) { return true; }
        job.cancelled = true; settleJob(job, cancelledError()); return false;
      });
      Object.keys(activeFfmpegJobs).forEach(function (id) {
        var job = activeFfmpegJobs[id];
        if (job.key !== jobKey || job.cancelled) { return; }
        terminateJob(job);
      });
    }

    function cancelJobPrefix(prefix) {
      cancelledPrefixes[prefix] = (cancelledPrefixes[prefix] || 0) + 1;
      ffmpegQueue = ffmpegQueue.filter(function (job) {
        if (job.key.indexOf(prefix) !== 0) { return true; }
        job.cancelled = true; settleJob(job, cancelledError()); return false;
      });
      Object.keys(activeFfmpegJobs).forEach(function (id) {
        var job = activeFfmpegJobs[id];
        if (job.key.indexOf(prefix) !== 0 || job.cancelled) { return; }
        terminateJob(job);
      });
    }

    function cancelViewerJobs(filePath) {
      cancelJobKey("preview:" + filePath);
      cancelJobKey("audio:" + filePath);
    }

    function cancelPreviewJob(filePath) { cancelJobKey("preview:" + filePath); }

    function prioritizeViewer() { Object.keys(passiveSubscribers).forEach(function (filePath) { if (passiveSubscribers[filePath]) { cancelBackgroundFor(filePath); } }); }
    function setActivity(value) {
      ["scrolling", "playing", "hidden"].forEach(function (key) { if (value && typeof value[key] === "boolean") { activity[key] = value[key]; } });
      pumpFfmpegQueue(); return getResourceStatus();
    }
    function cancelBackgroundFor(filePath) { backgroundEpochs[filePath] = (backgroundEpochs[filePath] || 0) + 1; if (!durableSubscribers[filePath]) { cancelJobKey("derived:" + filePath); } }
    function getResourceStatus() { return { active: activeFfmpegCount, queued: ffmpegQueue.length, maxActive: MAX_FFMPEG_CONCURRENCY, decoderThreads: decoderThreads, resourceProfile: decoderThreads === 2 ? "balanced" : "low", backgroundPaused: activity.scrolling || activity.playing || activity.hidden, activity: Object.assign({}, activity), globalLock: path.join(lockDirectory, "heavy.lock") }; }

    function cacheTemporaryPath(destination) {
      var extension = path.extname(destination);
      var stem = extension ? destination.slice(0, -extension.length) : destination;
      var temporary = stem + "." + process.pid + "-" + serviceToken + "-" + nextTemporaryOutputId + ".part" + extension;
      nextTemporaryOutputId += 1;
      return temporary;
    }

    function publishCacheOutput(temporary, destination) {
      return cacheTask(function () {
        var limit = cacheReservations[temporary];
        return cacheCall("stat", [temporary]).then(function (stat) {
          delete cacheReservations[temporary];
          if (limit && stat.size >= limit * .98) { throw new Error("CACHE_OUTPUT_LIMIT"); }
          return pruneCacheInternal(usableCacheFile(destination) ? 0 : stat.size, false, destination);
        }).then(function () {
          return cacheCall("link", [temporary, destination]).catch(function (error) {
            if (error.code !== "EEXIST" || !usableCacheFile(destination)) { throw error; }
          });
        }).then(function () {
          return recordCacheFile(destination).then(function () {
            return cacheCall("unlink", [temporary]).catch(function () {});
          });
        }).then(function () {
          delete activeTemporaryPaths[temporary]; cacheLeases[destination] = Date.now() + 10000;
          availableSpaceAt = 0;
          return destination;
        });
      });
    }

    function runFfmpeg(args, destination, timeout, jobKey, onOutput, spriteSpec) {
      var isCacheOutput = destination.indexOf(cacheRoot + path.sep) === 0;
      var actualDestination = isCacheOutput ? cacheTemporaryPath(destination) : destination;
      var actualArgs = [];
      var threads = jobThreadProfiles[jobKey] || decoderThreads;
      args.forEach(function (arg, index) {
        if (arg === "-i") { actualArgs.push("-threads", String(threads)); }
        actualArgs.push(arg === "0" && args[index - 1] === "-threads" ? String(threads) : arg);
      });
      actualArgs.unshift("-filter_threads", "1", "-filter_complex_threads", "1");
      actualArgs.splice(actualArgs.length - 1, 0, "-threads", String(threads));
      var outputIndex;
      var assertCurrent = cancellationGuard(jobKey);
      if (isCacheOutput) {
        for (outputIndex = actualArgs.length - 1; outputIndex >= 0; outputIndex -= 1) { if (actualArgs[outputIndex] === destination) { actualArgs[outputIndex] = actualDestination; break; } }
      }
      return prepare().then(function () {
        assertCurrent();
        return isCacheOutput ? prepareCacheOutput(actualDestination, destination, actualArgs) : null;
      }).then(function () {
        assertCurrent();
        var configuration = { sprite: spriteSpec || null, budget: isCacheOutput ? { root: cacheRoot, maxBytes: cacheMaxBytes, images: layerMax.images, proxies: layerMax.proxies } : null };
        var workerArgs = [workerPath, path.join(lockDirectory, "heavy.lock"), findBinary("ffmpeg"), actualDestination, isCacheOutput ? destination : "", String(cacheReservations[actualDestination] || 0), /^(preview|audio|capture|frame|user-transcode):/.test(jobKey) ? "0" : "1", JSON.stringify(configuration)].concat(actualArgs);
        return execFileQueued("/usr/bin/perl", workerArgs, { timeout: timeout || 120000, maxBuffer: 8 * 1024 * 1024, detached: true }, jobKey, onOutput, function () { removeFailedCacheFile(actualDestination); });
      }).then(function (result) {
        if (String(result.stdout || "").indexOf("LKFB_CACHE_HIT") !== -1 && usableCacheFile(destination)) { delete cacheReservations[actualDestination]; delete activeTemporaryPaths[actualDestination]; return recordCacheFile(destination).then(function () { return destination; }); }
        if (!usableCacheFile(actualDestination)) { throw new Error(result.stderr || "OUTPUT_NOT_CREATED"); }
        return isCacheOutput ? publishCacheOutput(actualDestination, destination) : destination;
      }).catch(function (error) {
        delete cacheReservations[actualDestination]; delete activeTemporaryPaths[actualDestination];
        availableSpaceAt = 0;
        removeFailedCacheFile(actualDestination);
        var workerError = String(error && error.message || "").match(/\b(OUTPUT_NOT_CREATED|CACHE_[A-Z_]+|MEDIA_LOCK_[A-Z_]+|MEDIA_PROCESS_GROUP|JOB_CANCELLED)\b/);
        if (workerError) { error = new Error(workerError[1]); error.code = workerError[1]; }
        throw error;
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
        "540": "960:540",
        "480": "854:480",
        "360": "640:360"
      };
      return {
        name: dimensions[value] !== undefined ? value : "1080",
        scale: dimensions[value] !== undefined ? dimensions[value] : "1920:1080",
        bitrate: value === "4k" || value === "source" ? "16M" : value === "1080" ? "8M" : value === "720" ? "5M" : value === "540" ? "3.5M" : value === "480" ? "2.5M" : "1.5M"
      };
    }

    function previewProxyFor(filePath, profile, options) {
      if (profile && typeof profile === "object") { options = profile; profile = options.profile; }
      var config = profileConfig(profile);
      var ext = String(path.extname(filePath)).toLowerCase();
      var assertCurrent = producerGuard("proxy", filePath, options);
      var jobKey = producerKey("proxy", filePath, options);
      return statSource(filePath).then(function (stat) {
        var key;
        var destination;
        var filter;
        var baseArgs;
        var hardwareArgs;
        assertCurrent();
        if (config.name === "source" && [".mp4", ".m4v", ".webm"].indexOf(ext) !== -1) { return filePath; }
        key = cacheKey(filePath, stat) + "-v3-" + config.name;
        ensureDirectories(); destination = path.join(proxyDirectory, key + ".mp4");
        if (usableCacheFile(destination)) { return recordArtifact(filePath, stat, "proxy", destination, config.name); }
        if (config.scale) {
          var dimensions = config.scale.split(":");
          filter = "scale='min(" + dimensions[0] + ",iw)':'min(" + dimensions[1] + ",ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p";
        } else { filter = "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p"; }
        baseArgs = ["-hide_banner", "-loglevel", "error", "-i", filePath, "-vf", filter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-threads", "0", "-y", destination];
        hardwareArgs = ["-hide_banner", "-loglevel", "error", "-hwaccel", "videotoolbox", "-i", filePath, "-vf", filter, "-c:v", "h264_videotoolbox", "-b:v", config.bitrate, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-y", destination];
        if (pendingOutputs[destination]) { return pendingOutputs[destination]; }
        return outputOnce(destination, function () { return runFfmpeg(hardwareArgs, destination, 600000, jobKey).catch(function (error) {
          if (terminalMediaError(error)) { throw error; }
          assertCurrent();
          return runFfmpeg(baseArgs, destination, 600000, jobKey);
        }); }).then(function (output) { return recordArtifact(filePath, stat, "proxy", output, config.name); });
      });
    }

    function audioProxyFor(filePath) {
      var stat;
      var key;
      var destination;
      var assertCurrent = cancellationGuard("audio:" + filePath);
      return statSource(filePath).then(function (sourceStat) {
        assertCurrent();
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
      return metadataFor(filePath, { purpose: "foreground" }).then(function (metadata) {
        var readProgress = progressReader(Number(metadata.duration) || 0, onProgress);
        var progressArgs = ["-progress", "pipe:1", "-nostats"];
        var hardware = ["-hide_banner", "-loglevel", "error", "-hwaccel", "videotoolbox", "-i", filePath, "-vf", filter, "-c:v", "h264_videotoolbox", "-b:v", config.bitrate, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"].concat(progressArgs, ["-y", destination]);
        var software = ["-hide_banner", "-loglevel", "error", "-i", filePath, "-vf", filter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-threads", "0"].concat(progressArgs, ["-y", destination]);
        return runFfmpeg(hardware, destination, 600000, "user-transcode:" + destination, readProgress).catch(function (error) {
          if (terminalMediaError(error)) { throw error; }
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
      return crypto.createHash("sha1").update(path.resolve(filePath) + ":" + sourceSignature(stat)).digest("hex");
    }

    function legacyCacheKey(filePath, stat) { return crypto.createHash("sha1").update([filePath, stat.size, stat.mtimeMs || stat.mtime && stat.mtime.getTime(), stat.ctimeMs || stat.ctime && stat.ctime.getTime(), stat.ino, stat.dev].join(":")).digest("hex"); }
    function producerKey(kind, filePath, options) {
      return options && options.purpose === "offline" ? "offline:" + kind + ":" + filePath : options && options.purpose === "foreground" ? "preview:" + filePath : (kind === "metadata" ? "metadata:" : kind === "proxy" ? "preview:" : "derived:") + filePath;
    }
    function producerGuard(kind, filePath, options) {
      var guard = cancellationGuard(producerKey(kind, filePath, options));
      return function () { guard(); if (options && options.signal && (options.signal.aborted || options.signal.cancelled)) { throw cancelledError(); } };
    }

    function metadataFor(filePath, options) {
      var assertCurrent = producerGuard("metadata", filePath, options);
      return statSource(filePath).then(function (stat) {
        var key = cacheKey(filePath, stat);
        var cacheFile;
        var ffprobe;
        assertCurrent();
        if (memoryMetadata[key]) { return recordArtifact(filePath, stat, "metadata", memoryMetadata[key]); }
        if (pendingMetadata[key]) { return pendingMetadata[key]; }
        /* v3 invalidates the old cache because container labels are now
           extension-aware (an .mp4 must not inherit QuickTime/MOV). */
        ensureDirectories(); cacheFile = path.join(metadataDirectory, key + "-v3.json");
        if (fs.existsSync(cacheFile)) {
          try { memoryMetadata[key] = JSON.parse(fs.readFileSync(cacheFile, "utf8")); return recordArtifact(filePath, stat, "metadata", memoryMetadata[key]); } catch (ignoreCacheError) {}
        }
        ffprobe = findBinary("ffprobe");
        if (!ffprobe) { throw new Error("FFPROBE_NOT_FOUND"); }
        pendingMetadata[key] = execFileQueued(ffprobe, ["-v", "error", "-threads", "1", "-show_format", "-show_streams", "-of", "json", filePath], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, producerKey("metadata", filePath, options)).then(function (result) {
          var normalized = normalizeProbe(JSON.parse(result.stdout), stat, filePath);
          var serialized = JSON.stringify(normalized);
          memoryMetadata[key] = normalized;
          return cacheTask(function () {
            return pruneCacheInternal(Buffer.byteLength(serialized, "utf8")).then(function () {
              return cacheCall("writeFile", [cacheFile, serialized, "utf8"]);
            }).then(function () { return recordCacheFile(cacheFile); });
          }).then(function () { return recordArtifact(filePath, stat, "metadata", normalized); }, function () { return normalized; });
        }).then(function (result) { delete pendingMetadata[key]; return result; }, function (error) { delete pendingMetadata[key]; throw error; });
        return pendingMetadata[key];
      });
    }

    function generateWaveform(filePath, options) {
      var assertCurrent = producerGuard("waveform", filePath, options);
      return statSource(filePath).then(function (stat) {
        var key = cacheKey(filePath, stat);
        var destination;
        var args;
        assertCurrent();
        ensureDirectories(); destination = path.join(waveformDirectory, key + "-v3.png");
        if (usableCacheFile(destination)) { return recordArtifact(filePath, stat, "waveform", destination); }
        args = ["-hide_banner", "-loglevel", "error", "-i", filePath, "-filter_complex", "[0:a:0]aformat=channel_layouts=mono,showwavespic=s=600x120:colors=0x62d684:scale=sqrt:draw=full[wave]", "-map", "[wave]", "-frames:v", "1", "-an", "-sn", "-dn", "-y", destination];
        return outputOnce(destination, function () { return runFfmpeg(args, destination, 45000, producerKey("waveform", filePath, options)); }).then(function (output) { return recordArtifact(filePath, stat, "waveform", output); });
      });
    }

    function generatePosterFrame(filePath, destination, seconds, videoStreamIndex, rejectBlack, jobKey) {
      var filter = "scale=480:270:force_original_aspect_ratio=increase,crop=480:270,setsar=1";
      var args;
      if (rejectBlack) {
        /* Inspect only the requested frame. The metadata filter deliberately
           emits no output for near-black frames, allowing the caller to try a
           later representative point without scanning the whole source. */
        filter = "trim=end_frame=1," + filter + ",format=yuv420p,signalstats,metadata=select:key=lavfi.signalstats.YAVG:value=20:function=greater";
      }
      args = [
        "-hide_banner", "-loglevel", "error", "-ss", Math.max(0, Number(seconds) || 0).toFixed(3), "-i", filePath,
        "-map", "0:v:" + Math.max(0, Number(videoStreamIndex) || 0), "-frames:v", "1", "-vf", filter,
        "-an", "-sn", "-dn", "-y", destination
      ];
      return runFfmpeg(args, destination, 15000, jobKey || "derived:" + filePath);
    }

    function posterFor(filePath, options) {
      var assertCurrent = producerGuard("poster", filePath, options);
      var jobKey = producerKey("poster", filePath, options);
      return statSource(filePath).then(function (stat) {
        var key = cacheKey(filePath, stat);
        var destination;
        assertCurrent();
        ensureDirectories(); destination = path.join(posterDirectory, key + "-v4.png");
        if (usableCacheFile(destination)) { return recordArtifact(filePath, stat, "poster", destination); }
        var legacy = path.join(posterDirectory, legacyCacheKey(filePath, stat) + "-v4.png");
        if (usableCacheFile(legacy)) { return recordArtifact(filePath, stat, "poster", legacy); }
        return metadataFor(filePath, options).then(function (metadata) {
          var times = posterSampleTimes(metadata.duration);
          var videoStreamIndex = numberOrNull(metadata.videoStreamIndex);
          var lastError = null;
          assertCurrent();
          videoStreamIndex = videoStreamIndex === null ? 0 : videoStreamIndex;

          function tryCandidate(index) {
            if (index >= times.length) { return Promise.reject(lastError || new Error("POSTER_FRAME_NOT_FOUND")); }
            assertCurrent();
            return generatePosterFrame(filePath, destination, times[index], videoStreamIndex, true, jobKey).catch(function (error) {
              if (terminalMediaError(error)) { throw error; }
              lastError = error;
              if (error && error.message === "OUTPUT_NOT_CREATED") { return tryCandidate(index + 1); }
              throw error;
            });
          }

          return outputOnce(destination, function () {
            return tryCandidate(0).catch(function (error) {
              var finalTime;
              if (terminalMediaError(error)) { throw error; }
              finalTime = times[times.length - 1] || 0;
              /* A genuinely dark source still deserves a thumbnail. After all
                 representative candidates are rejected, keep its last frame. */
              assertCurrent();
              return generatePosterFrame(filePath, destination, finalTime, videoStreamIndex, false, jobKey);
            });
          }).then(function (output) { return recordArtifact(filePath, stat, "poster", output); });
        });
      });
    }

    function previewStillFor(filePath, options) {
      var assertCurrent = producerGuard("still", filePath, options);
      return statSource(filePath).then(function (stat) {
        var key = cacheKey(filePath, stat) + "-ql-v1";
        var destination = path.join(stillPreviewDirectory, key + ".png");
        var extension = String(path.extname(filePath)).toLowerCase();
        assertCurrent();
        if (usableCacheFile(destination)) { return recordArtifact(filePath, stat, "still", destination); }
        if (extension === ".psd" || extension === ".psb") {
          return outputOnce(destination, function () { return runFfmpeg(["-hide_banner", "-loglevel", "error", "-i", filePath, "-frames:v", "1", "-vf", "scale=960:960:force_original_aspect_ratio=decrease", "-y", destination], destination, 45000, producerKey("still", filePath, options)); }).then(function (output) { return recordArtifact(filePath, stat, "still", output); });
        }
        return outputOnce(destination, function () {
          var temporary = cacheTemporaryPath(destination);
          var workDirectory = path.join(stillPreviewDirectory, "." + key + "-" + process.pid + "-" + nextTemporaryOutputId);
          var pdfOutput = path.join(workDirectory, "render.png");
          var jobKey = producerKey("still", filePath, options);
          var pdfRenderer = ["/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm"].filter(function (candidate) { return fs.existsSync(candidate); })[0];
          function quickLookFallback(error) {
            if (terminalMediaError(error)) { throw error; }
            return execFileQueued("/usr/bin/qlmanage", ["-t", "-s", "960", "-o", workDirectory, filePath], { timeout: 8000, maxBuffer: 1024 * 1024 }, jobKey).then(function () {
              return cacheCall("readdir", [workDirectory]);
            }).then(function (names) {
              var generated = names.filter(function (name) { return /\.png$/i.test(name) && name !== "render.png"; })[0];
              if (!generated) { throw new Error("QUICKLOOK_OUTPUT_NOT_CREATED"); }
              return path.join(workDirectory, generated);
            });
          }
          function cleanup() {
            delete activeWorkDirectories[workDirectory];
            delete cacheReservations[temporary]; delete activeTemporaryPaths[temporary];
            removeFailedCacheFile(temporary);
            return removeOwnedWorkDirectory(workDirectory);
          }
          return prepareCacheOutput(temporary, destination, [temporary]).then(function () {
            activeWorkDirectories[workDirectory] = true;
            return cacheCall("mkdir", [workDirectory, { recursive: true }]);
          }).then(function () {
            if (!pdfRenderer) { return quickLookFallback(); }
            return execFileQueued(pdfRenderer, ["-png", "-f", "1", "-l", "1", "-singlefile", "-scale-to", "960", filePath, pdfOutput.slice(0, -4)], { timeout: 45000, maxBuffer: 1024 * 1024 }, jobKey).then(function () {
              if (!usableCacheFile(pdfOutput)) { throw new Error("PDF_PREVIEW_NOT_CREATED"); }
              return pdfOutput;
            }).catch(quickLookFallback);
          }).then(function (generated) {
            return cacheCall("copyFile", [generated, temporary, fs.constants.COPYFILE_EXCL]);
          }).then(function () { return publishCacheOutput(temporary, destination); }).then(function (result) {
            return cleanup().then(function () { return result; });
          }, function (error) {
            return cleanup().then(function () { throw error; });
          });
        }).then(function (output) { return recordArtifact(filePath, stat, "still", output); });
      });
    }

    function removeOwnedWorkDirectory(directory) {
      if (path.dirname(directory) !== stillPreviewDirectory || path.basename(directory).charAt(0) !== ".") { return Promise.resolve(); }
      return cacheCall("readdir", [directory]).then(function (names) {
        return Promise.all(names.map(function (name) {
          var candidate = path.join(directory, name);
          return cacheCall("lstat", [candidate]).then(function (stat) {
            if (stat.isDirectory()) { return; }
            return cacheCall("unlink", [candidate]).then(function () { forgetCacheFile(candidate); });
          }).catch(function () {});
        }));
      }).then(function () { return cacheCall("rmdir", [directory]); }).catch(function () {});
    }

    function spriteRecord(destination, times, approximate) {
      return { path: destination, frames: SPRITE_FRAMES, frameCount: SPRITE_FRAMES, columns: SPRITE_COLUMNS, rows: SPRITE_ROWS, cellWidth: 240, cellHeight: 136, width: 960, height: 408, sampleTimes: times, approximateTimes: !!approximate };
    }
    function spriteFor(filePath, options) {
      var assertCurrent = producerGuard("sprite", filePath, options);
      return statSource(filePath).then(function (stat) {
        var key = cacheKey(filePath, stat);
        var destination;
        assertCurrent();
        ensureDirectories(); destination = path.join(spriteDirectory, key + "-v5.jpg");
        return metadataFor(filePath, options).then(function (metadata) {
          var times = spriteSampleTimes(metadata.duration, SPRITE_FRAMES, metadata.frameRate);
          var legacy = path.join(spriteDirectory, legacyCacheKey(filePath, stat) + "-v4.jpg");
          assertCurrent();
          function completed() {
            return cacheCall("readFile", [destination + ".json", "utf8"]).then(function (data) {
              var samples = JSON.parse(data).sampleTimes;
              if (!Array.isArray(samples) || samples.length !== SPRITE_FRAMES || samples.some(function (time) { return !isFinite(time) || time < 0; })) { throw new Error("SPRITE_TIMESTAMP_UNAVAILABLE"); }
              return recordArtifact(filePath, stat, "sprite", spriteRecord(destination, samples));
            });
          }
          var work = path.join(spriteDirectory, ".sprite-" + process.pid + "-" + nextTemporaryOutputId + "-" + crypto.randomBytes(6).toString("hex"));
          var spec = { source: filePath, times: times, startTime: Number(metadata.startTime) || 0, stream: Math.max(0, Number(metadata.videoStreamIndex) || 0), work: work, threads: options && options.profile === "balanced" ? 2 : decoderThreads };
          function generate() { return outputOnce(destination, function () { return runFfmpeg(["-i", filePath, "-y", destination], destination, 120000, producerKey("sprite", filePath, options), null, spec).then(completed); }); }
          if (usableCacheFile(destination)) { return completed().catch(generate); }
          if (usableCacheFile(legacy)) { return recordArtifact(filePath, stat, "sprite", spriteRecord(legacy, times, true)); }
          return generate();
        });
      });
    }

    ensureDirectories();
    pruneCache().catch(function () {});

    function dispose() {
      disposed = true; activity.hidden = true;
      Object.keys(sourceValidations).forEach(function (key) { clearTimeout(sourceValidations[key]); delete sourceValidations[key]; });
      cancelJobPrefix("");
      cacheRetains = {};
      return persistRetains().then(function () {
        return new Promise(function (resolve) {
          function reap() { if (!activeFfmpegCount) { resolve(); } else { setTimeout(reap, 20); } }
          reap();
        });
      });
    }

    return {
      cacheRoot: cacheRoot,
      captureDirectory: captureDirectory,
      metadataFor: whenMediaToolsReady(metadataFor, "metadata:", "metadata"),
      posterFor: whenMediaToolsReady(posterFor, "derived:", "poster"),
      waveformFor: whenMediaToolsReady(generateWaveform, "derived:", "waveform"),
      previewStillFor: whenMediaToolsReady(previewStillFor, "derived:", "still"),
      spriteFor: whenMediaToolsReady(spriteFor, "derived:", "sprite"),
      previewProxyFor: whenMediaToolsReady(previewProxyFor, "preview:", "proxy"),
      audioProxyFor: whenMediaToolsReady(audioProxyFor, "audio:"),
      frameFor: whenMediaToolsReady(frameFor, "frame:"),
      captureFrameForProject: whenMediaToolsReady(captureFrameForProject, "capture:"),
      transcodeTo: whenMediaToolsReady(transcodeTo, "user-transcode:"),
      claimTranscodeOutput: claimTranscodeOutput,
      cleanupTranscodeTemporary: cleanupTranscodeTemporary,
      cancelViewerJobs: cancelViewerJobs,
      cancelPreviewJob: cancelPreviewJob,
      prioritizeViewer: prioritizeViewer,
      cachedPreviewFor: cachedPreviewFor,
      validateCachedAsset: validateCachedAsset,
      getCachedAsset: loadAsset,
      setActivity: setActivity,
      cancelBackgroundFor: cancelBackgroundFor,
      getResourceStatus: getResourceStatus,
      pinCachedAsset: pinCachedAsset,
      retainCacheFile: retainCacheFile,
      releaseCacheFile: releaseCacheFile,
      pruneCache: pruneCache,
      cacheStats: cacheTotals,
      findBinary: findBinary,
      prepare: prepare,
      getStatus: getStatus,
      dispose: dispose
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
    posterSampleTimes: posterSampleTimes,
    spriteFrameAtProgress: spriteFrameAtProgress,
    SPRITE_FRAMES: SPRITE_FRAMES,
    SPRITE_COLUMNS: SPRITE_COLUMNS,
    SPRITE_ROWS: SPRITE_ROWS
  };
}));
