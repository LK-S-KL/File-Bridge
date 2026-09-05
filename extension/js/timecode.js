(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.FnOSTimecode = api;
}(this, function () {
  "use strict";

  function nominalRate(frameRate) { return Math.max(1, Math.round(Number(frameRate) || 25)); }

  function isDropFrame(timecode, frameRate) {
    var rate = Number(frameRate) || 0;
    return String(timecode || "").indexOf(";") !== -1 &&
      (Math.abs(rate - 30000 / 1001) < .02 || Math.abs(rate - 60000 / 1001) < .02);
  }

  function parseFrames(timecode, frameRate) {
    var match = String(timecode || "").match(/^(\d{2}):(\d{2}):(\d{2})([:;])(\d{2})$/);
    var nominal = nominalRate(frameRate);
    var hours;
    var minutes;
    var seconds;
    var frames;
    var total;
    var drop;
    var totalMinutes;
    if (!match) { return 0; }
    hours = Number(match[1]); minutes = Number(match[2]); seconds = Number(match[3]); frames = Number(match[5]);
    total = ((hours * 3600 + minutes * 60 + seconds) * nominal) + frames;
    if (isDropFrame(timecode, frameRate)) {
      drop = nominal === 60 ? 4 : 2; totalMinutes = hours * 60 + minutes;
      total -= drop * (totalMinutes - Math.floor(totalMinutes / 10));
    }
    return Math.max(0, total);
  }

  function formatFrames(frameNumber, frameRate, dropFrame) {
    var nominal = nominalRate(frameRate);
    var value = Math.max(0, Math.round(Number(frameNumber) || 0));
    var drop = nominal === 60 ? 4 : 2;
    var framesPerHour;
    var framesPer24Hours;
    var framesPer10Minutes;
    var framesPerMinute;
    var tenMinuteBlocks;
    var remainder;
    var frames;
    var totalSeconds;
    var seconds;
    var minutes;
    var hours;
    if (dropFrame && (nominal === 30 || nominal === 60)) {
      framesPerHour = Math.round(Number(frameRate) * 3600);
      framesPer24Hours = framesPerHour * 24;
      framesPer10Minutes = Math.round(Number(frameRate) * 600);
      framesPerMinute = nominal * 60 - drop;
      value %= framesPer24Hours;
      tenMinuteBlocks = Math.floor(value / framesPer10Minutes);
      remainder = value % framesPer10Minutes;
      value += drop * 9 * tenMinuteBlocks;
      if (remainder > drop) { value += drop * Math.floor((remainder - drop) / framesPerMinute); }
    }
    frames = value % nominal;
    totalSeconds = Math.floor(value / nominal);
    seconds = totalSeconds % 60; minutes = Math.floor(totalSeconds / 60) % 60; hours = Math.floor(totalSeconds / 3600) % 24;
    return [hours, minutes, seconds].map(function (part) { return String(part).padStart(2, "0"); }).join(":") + (dropFrame ? ";" : ":") + String(frames).padStart(2, "0");
  }

  function formatAt(seconds, frameRate, startTimecode) {
    var drop = isDropFrame(startTimecode, frameRate);
    var base = parseFrames(startTimecode, frameRate);
    var elapsed = Math.max(0, Math.round((Number(seconds) || 0) * (Number(frameRate) || 25)));
    return formatFrames(base + elapsed, frameRate, drop);
  }

  return { isDropFrame: isDropFrame, parseFrames: parseFrames, formatFrames: formatFrames, formatAt: formatAt };
}));
