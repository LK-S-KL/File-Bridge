const assert = require("node:assert/strict");
const test = require("node:test");
const timecode = require("../extension/js/timecode.js");

test("formats ordinary integer-rate source timecode", () => {
  assert.equal(timecode.formatAt(1, 25, "01:00:00:00"), "01:00:01:00");
  assert.equal(timecode.formatAt(0.5, 24, "00:00:00:00"), "00:00:00:12");
});

test("parses and formats 29.97 drop-frame minute and hour boundaries", () => {
  const rate = 30000 / 1001;
  assert.equal(timecode.isDropFrame("00:01:00;02", rate), true);
  assert.equal(timecode.parseFrames("00:01:00;02", rate), 1800);
  assert.equal(timecode.formatFrames(1800, rate, true), "00:01:00;02");
  assert.equal(timecode.parseFrames("01:00:00;00", rate), 107892);
  assert.equal(timecode.formatFrames(107892, rate, true), "01:00:00;00");
});

test("supports 59.94 drop-frame timecode", () => {
  const rate = 60000 / 1001;
  assert.equal(timecode.parseFrames("00:01:00;04", rate), 3600);
  assert.equal(timecode.formatFrames(3600, rate, true), "00:01:00;04");
});
