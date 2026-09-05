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

  function normalizeProbe(raw, sourceStat) {
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
      format: format.format_long_name || format.format_name || "未知",
      formatShort: format.format_name || "",
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
    var memoryMetadata = {};
    var pendingMetadata = {};

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
      [cacheRoot, metadataDirectory, posterDirectory, spriteDirectory, waveformDirectory].forEach(function (directory) {
        fs.mkdirSync(directory, { recursive: true });
      });
    }

    function findBinary(name) {
      var candidates = name === "ffprobe" ? [
        "/opt/homebrew/bin/ffprobe",
        "/usr/local/bin/ffprobe",
        "/Users/lk/.local/bin/ffprobe"
      ] : [
        "/Users/lk/.local/bin/ffmpeg",
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

    function cacheKey(filePath, stat) {
      return crypto.createHash("sha1").update(filePath + ":" + stat.size + ":" + stat.mtimeMs).digest("hex");
    }

    function metadataFor(filePath) {
      var stat;
      var key;
      var cacheFile;
      var ffprobe;
      if (!fs.existsSync(filePath)) {
        return Promise.reject(new Error("FILE_NOT_FOUND"));
      }
      stat = fs.statSync(filePath);
      key = cacheKey(filePath, stat);
      if (memoryMetadata[key]) {
        return Promise.resolve(memoryMetadata[key]);
      }
      if (pendingMetadata[key]) {
        return pendingMetadata[key];
      }
      ensureDirectories();
      cacheFile = path.join(metadataDirectory, key + "-v2.json");
      if (fs.existsSync(cacheFile)) {
        try {
          memoryMetadata[key] = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
          return Promise.resolve(memoryMetadata[key]);
        } catch (ignoreCacheError) {}
      }
      ffprobe = findBinary("ffprobe");
      if (!ffprobe) {
        return Promise.reject(new Error("FFPROBE_NOT_FOUND"));
      }
      pendingMetadata[key] = new Promise(function (resolve, reject) {
        childProcess.execFile(ffprobe, [
          "-v", "error",
          "-show_format",
          "-show_streams",
          "-of", "json",
          filePath
        ], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, function (error, stdout) {
          var normalized;
          delete pendingMetadata[key];
          if (error) {
            reject(error);
            return;
          }
          try {
            normalized = normalizeProbe(JSON.parse(stdout), stat);
            memoryMetadata[key] = normalized;
            fs.writeFileSync(cacheFile, JSON.stringify(normalized), "utf8");
            resolve(normalized);
          } catch (parseError) {
            reject(parseError);
          }
        });
      });
      return pendingMetadata[key];
    }

    function generateImage(filePath, kind) {
      var stat;
      var key;
      var destination;
      var ffmpeg;
      var args;
      if (!fs.existsSync(filePath)) {
        return Promise.reject(new Error("FILE_NOT_FOUND"));
      }
      stat = fs.statSync(filePath);
      key = cacheKey(filePath, stat);
      ensureDirectories();
      destination = path.join(kind === "poster" ? posterDirectory : waveformDirectory, key + (kind === "waveform" ? "-v2" : "") + ".png");
      if (usableCacheFile(destination)) {
        return Promise.resolve(destination);
      }
      ffmpeg = findBinary("ffmpeg");
      if (!ffmpeg) {
        return Promise.reject(new Error("FFMPEG_NOT_FOUND"));
      }
      if (kind === "waveform") {
        args = [
          "-hide_banner", "-loglevel", "error", "-i", filePath,
          "-filter_complex", "[0:a:0]aformat=channel_layouts=mono,showwavespic=s=600x120:colors=0x62d684:scale=sqrt:draw=full[wave]",
          "-map", "[wave]", "-frames:v", "1", "-an", "-sn", "-dn", "-y", destination
        ];
      } else {
        args = [
          "-hide_banner", "-loglevel", "error", "-ss", "0.5", "-i", filePath,
          "-frames:v", "1",
          "-vf", "scale=480:270:force_original_aspect_ratio=increase,crop=480:270",
          "-y", destination
        ];
      }
      return new Promise(function (resolve, reject) {
        childProcess.execFile(ffmpeg, args, { timeout: 45000 }, function (error) {
          if (error || !usableCacheFile(destination)) {
            removeFailedCacheFile(destination);
            reject(error || new Error("OUTPUT_NOT_CREATED"));
            return;
          }
          resolve(destination);
        });
      });
    }

    function spriteFor(filePath) {
      var stat;
      var key;
      var destination;
      var ffmpeg;
      if (!fs.existsSync(filePath)) {
        return Promise.reject(new Error("FILE_NOT_FOUND"));
      }
      stat = fs.statSync(filePath);
      key = cacheKey(filePath, stat);
      ensureDirectories();
      destination = path.join(spriteDirectory, key + "-v2.jpg");
      if (usableCacheFile(destination)) {
        return metadataFor(filePath).then(function (metadata) {
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
            sampleTimes: spriteSampleTimes(metadata.duration, SPRITE_FRAMES)
          };
        });
      }
      ffmpeg = findBinary("ffmpeg");
      if (!ffmpeg) {
        return Promise.reject(new Error("FFMPEG_NOT_FOUND"));
      }
      return metadataFor(filePath).then(function (metadata) {
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
        return new Promise(function (resolve, reject) {
          childProcess.execFile(ffmpeg, args, { timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, function (error) {
            if (error || !usableCacheFile(destination)) {
              removeFailedCacheFile(destination);
              reject(error || new Error("OUTPUT_NOT_CREATED"));
              return;
            }
            resolve({
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
            });
          });
        });
      });
    }

    return {
      cacheRoot: cacheRoot,
      metadataFor: metadataFor,
      posterFor: function (filePath) { return generateImage(filePath, "poster"); },
      waveformFor: function (filePath) { return generateImage(filePath, "waveform"); },
      spriteFor: spriteFor,
      findBinary: findBinary
    };
  }

  return {
    create: create,
    normalizeProbe: normalizeProbe,
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
