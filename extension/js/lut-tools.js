(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.FnOSLutTools = api;
}(this, function () {
  "use strict";

  function finite(value) { return typeof value === "number" && isFinite(value); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function parseNumbers(parts, lineNumber) {
    var values = parts.map(function (part) { return Number(part); });
    if (values.some(function (value) { return !finite(value); })) {
      throw new Error("第 " + lineNumber + " 行包含无效数字。");
    }
    return values;
  }

  function parseCube(text, options) {
    var settings = options || {};
    var maxSize = settings.maxSize || 65;
    var source = String(text || "").replace(/^\uFEFF/, "");
    var lines = source.split(/\r?\n/);
    var title = "";
    var size1d = null;
    var size3d = null;
    var domainMin = [0, 0, 0];
    var domainMax = [1, 1, 1];
    var dataLines = [];
    var warnings = [];
    var i;
    var raw;
    var commentIndex;
    var parts;
    var directive;
    var values;
    var expected;
    var type;
    var size;
    var data;

    for (i = 0; i < lines.length; i += 1) {
      raw = lines[i].trim();
      commentIndex = raw.indexOf("#");
      if (commentIndex !== -1) { raw = raw.slice(0, commentIndex).trim(); }
      if (!raw) { continue; }
      parts = raw.split(/\s+/);
      directive = parts[0].toUpperCase();
      if (directive === "TITLE") {
        title = raw.slice(parts[0].length).trim().replace(/^"|"$/g, "");
      } else if (directive === "DOMAIN_MIN") {
        values = parseNumbers(parts.slice(1), i + 1);
        if (values.length !== 3) { throw new Error("DOMAIN_MIN 必须包含 3 个数值。"); }
        domainMin = values;
      } else if (directive === "DOMAIN_MAX") {
        values = parseNumbers(parts.slice(1), i + 1);
        if (values.length !== 3) { throw new Error("DOMAIN_MAX 必须包含 3 个数值。"); }
        domainMax = values;
      } else if (directive === "LUT_1D_SIZE") {
        size1d = Number(parts[1]);
      } else if (directive === "LUT_3D_SIZE") {
        size3d = Number(parts[1]);
      } else if (directive === "LUT_3D_INPUT_RANGE") {
        values = parseNumbers(parts.slice(1), i + 1);
        if (values.length === 6) { domainMin = values.slice(0, 3); domainMax = values.slice(3, 6); }
        else if (values.length === 2) { domainMin = [values[0], values[0], values[0]]; domainMax = [values[1], values[1], values[1]]; }
        else { throw new Error("LUT_3D_INPUT_RANGE 必须包含 2 或 6 个数值。"); }
      } else if (/^[+\-0-9.]/.test(raw)) {
        values = parseNumbers(parts, i + 1);
        if (values.length !== 3) { throw new Error("第 " + (i + 1) + " 行的 LUT 数据必须包含 3 个数值。"); }
        dataLines.push(values);
      } else {
        warnings.push("忽略未知指令：" + parts[0]);
      }
    }

    if (size1d !== null && size3d !== null) { throw new Error("组合 LUT（同时包含 1D 和 3D）暂不支持。"); }
    if (size1d === null && size3d === null) { throw new Error("未找到 LUT_1D_SIZE 或 LUT_3D_SIZE。"); }
    type = size3d !== null ? "3d" : "1d";
    size = type === "3d" ? size3d : size1d;
    if (!finite(size) || size < 2 || Math.floor(size) !== size) { throw new Error("LUT 尺寸必须是大于等于 2 的整数。"); }
    if (size > maxSize) { throw new Error("LUT 尺寸为 " + size + "，超过当前预览上限 " + maxSize + "。"); }
    expected = type === "3d" ? size * size * size : size;
    if (dataLines.length !== expected) { throw new Error("LUT 数据行数不正确：需要 " + expected + " 行，实际为 " + dataLines.length + " 行。"); }
    if (domainMax.some(function (value, index) { return !finite(value) || value <= domainMin[index]; })) { throw new Error("LUT 输入范围无效。"); }
    data = new Float32Array(expected * 3);
    dataLines.forEach(function (row, index) { data[index * 3] = row[0]; data[index * 3 + 1] = row[1]; data[index * 3 + 2] = row[2]; });
    return {
      title: title,
      type: type,
      size: size,
      domainMin: domainMin,
      domainMax: domainMax,
      data: data,
      warnings: warnings,
      sample: function (r, g, b) { return sampleLut(this, r, g, b); }
    };
  }

  function oneDimensional(lut, channel, value) {
    var size = lut.size;
    var normalized = clamp((value - lut.domainMin[channel]) / (lut.domainMax[channel] - lut.domainMin[channel]), 0, 1);
    var position = normalized * (size - 1);
    var lower = Math.floor(position);
    var upper = Math.min(size - 1, lower + 1);
    var amount = position - lower;
    var a = lut.data[lower * 3 + channel];
    var b = lut.data[upper * 3 + channel];
    return lerp(a, b, amount);
  }

  function dataIndex(lut, r, g, b) {
    /* .cube convention: R axis is the fastest changing axis. */
    return ((b * lut.size + g) * lut.size + r) * 3;
  }

  function sampleLut(lut, r, g, b) {
    var values = [r, g, b];
    var output = [0, 0, 0];
    var i;
    var normalized;
    var position;
    var low;
    var high;
    var amount;
    var dr;
    var dg;
    var db;
    var index;
    var weight;
    if (lut.type === "1d") {
      for (i = 0; i < 3; i += 1) { output[i] = oneDimensional(lut, i, values[i]); }
      return output;
    }
    normalized = values.map(function (value, channel) { return clamp((value - lut.domainMin[channel]) / (lut.domainMax[channel] - lut.domainMin[channel]), 0, 1); });
    position = normalized.map(function (value) { return value * (lut.size - 1); });
    low = position.map(Math.floor);
    high = position.map(function (value, channel) { return Math.min(lut.size - 1, low[channel] + 1); });
    amount = position.map(function (value, channel) { return value - low[channel]; });
    for (dr = 0; dr <= 1; dr += 1) {
      for (dg = 0; dg <= 1; dg += 1) {
        for (db = 0; db <= 1; db += 1) {
          index = dataIndex(lut, dr ? high[0] : low[0], dg ? high[1] : low[1], db ? high[2] : low[2]);
          weight = (dr ? amount[0] : 1 - amount[0]) * (dg ? amount[1] : 1 - amount[1]) * (db ? amount[2] : 1 - amount[2]);
          output[0] += lut.data[index] * weight; output[1] += lut.data[index + 1] * weight; output[2] += lut.data[index + 2] * weight;
        }
      }
    }
    return output;
  }

  function applyToImageData(imageData, lut, options) {
    var settings = options || {};
    var opacity = clamp(settings.opacity === undefined ? 1 : Number(settings.opacity), 0, 1);
    var source = imageData.data;
    var output = typeof ImageData === "function" ? new ImageData(imageData.width, imageData.height) : {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(source.length)
    };
    var target = output.data;
    var i;
    var mapped;
    var r;
    var g;
    var b;
    for (i = 0; i < source.length; i += 4) {
      r = source[i] / 255; g = source[i + 1] / 255; b = source[i + 2] / 255;
      mapped = sampleLut(lut, r, g, b);
      target[i] = Math.round(clamp(r * (1 - opacity) + clamp(mapped[0], 0, 1) * opacity, 0, 1) * 255);
      target[i + 1] = Math.round(clamp(g * (1 - opacity) + clamp(mapped[1], 0, 1) * opacity, 0, 1) * 255);
      target[i + 2] = Math.round(clamp(b * (1 - opacity) + clamp(mapped[2], 0, 1) * opacity, 0, 1) * 255);
      target[i + 3] = source[i + 3];
    }
    return output;
  }

  function blendImageData(original, processed, opacity) {
    var amount = clamp(Number(opacity), 0, 1);
    var output = typeof ImageData === "function" ? new ImageData(original.width, original.height) : {
      width: original.width,
      height: original.height,
      data: new Uint8ClampedArray(original.data.length)
    };
    var i;
    for (i = 0; i < original.data.length; i += 4) {
      output.data[i] = Math.round(lerp(original.data[i], processed.data[i], amount));
      output.data[i + 1] = Math.round(lerp(original.data[i + 1], processed.data[i + 1], amount));
      output.data[i + 2] = Math.round(lerp(original.data[i + 2], processed.data[i + 2], amount));
      output.data[i + 3] = original.data[i + 3];
    }
    return output;
  }

  function renderSplit(context, original, processed, split, opacity) {
    var ratio = clamp(Number(split), 0, 1);
    var width = context.canvas.width;
    var height = context.canvas.height;
    var divider = Math.round(width * ratio);
    var composite = composeSplitImageData(original, processed, ratio, opacity);
    context.clearRect(0, 0, width, height);
    context.putImageData(composite, 0, 0);
    context.save(); context.strokeStyle = "rgba(255,255,255,.95)"; context.lineWidth = 2; context.beginPath(); context.moveTo(divider + .5, 0); context.lineTo(divider + .5, height); context.stroke(); context.restore();
  }

  function composeSplitImageData(original, processed, split, opacity) {
    var ratio = clamp(Number(split), 0, 1);
    var amount = opacity === undefined ? 1 : clamp(Number(opacity), 0, 1);
    var divider = Math.round(original.width * ratio);
    var output = typeof ImageData === "function" ? new ImageData(original.width, original.height) : {
      width: original.width,
      height: original.height,
      data: new Uint8ClampedArray(original.data.length)
    };
    var pixel;
    var channel;
    var x;
    for (pixel = 0; pixel < original.width * original.height; pixel += 1) {
      x = pixel % original.width;
      channel = pixel * 4;
      if (x < divider) {
        output.data[channel] = original.data[channel]; output.data[channel + 1] = original.data[channel + 1]; output.data[channel + 2] = original.data[channel + 2];
      } else {
        output.data[channel] = Math.round(lerp(original.data[channel], processed.data[channel], amount));
        output.data[channel + 1] = Math.round(lerp(original.data[channel + 1], processed.data[channel + 1], amount));
        output.data[channel + 2] = Math.round(lerp(original.data[channel + 2], processed.data[channel + 2], amount));
      }
      output.data[channel + 3] = original.data[channel + 3];
    }
    return output;
  }

  function create(runtime) {
    var fs = runtime.fs;
    var cache = {};
    var pending = {};
    var cooldown = {};
    function parseFile(filePath) {
      if (cooldown[filePath] && cooldown[filePath] > Date.now()) { return Promise.reject(new Error("SOURCE_TIMEOUT")); }
      if (pending[filePath]) { return pending[filePath]; }
      pending[filePath] = new Promise(function (resolve, reject) {
        var settled = false;
        var timeout = setTimeout(function () { if (!settled) { settled = true; cooldown[filePath] = Date.now() + 30000; reject(new Error("SOURCE_TIMEOUT")); } }, 15000);
        fs.stat(filePath, function (statError, stat) {
          var key;
          if (settled) { if (!statError && stat && stat.isFile()) { delete cooldown[filePath]; } return; }
          if (statError || !stat || !stat.isFile()) { settled = true; clearTimeout(timeout); reject(statError || new Error("FILE_NOT_FOUND")); return; }
          key = filePath + ":" + stat.size + ":" + stat.mtimeMs;
          if (cache[key]) { settled = true; clearTimeout(timeout); resolve(cache[key]); return; }
          fs.readFile(filePath, "utf8", function (error, text) {
            var lut;
            if (settled) { return; }
            settled = true; clearTimeout(timeout);
            if (error) { reject(error); return; }
            try { lut = parseCube(text); cache[key] = lut; resolve(lut); } catch (parseError) { reject(parseError); }
          });
        });
      });
      pending[filePath].then(function () { delete pending[filePath]; }, function () { delete pending[filePath]; });
      return pending[filePath];
    }
    return { parseFile: parseFile };
  }

  return {
    parseCube: parseCube,
    sample: sampleLut,
    applyToImageData: applyToImageData,
    blendImageData: blendImageData,
    composeSplitImageData: composeSplitImageData,
    renderSplit: renderSplit,
    create: create,
    clamp: clamp
  };
}));
