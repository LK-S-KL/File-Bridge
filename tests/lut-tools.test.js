const assert = require("node:assert/strict");
const test = require("node:test");

const lutTools = require("../extension/js/lut-tools.js");

function cube3d(rows, directives = []) {
  return [
    'TITLE "Test LUT"',
    ...directives,
    "LUT_3D_SIZE 2",
    ...rows
  ].join("\n");
}

function assertChannels(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) <= tolerance,
      `channel ${index}: expected ${expected[index]}, received ${value}`
    );
  });
}

test("parses and interpolates a 2^3 identity LUT using R-fastest row order", () => {
  const lut = lutTools.parseCube(cube3d([
    "0 0 0", "1 0 0", "0 1 0", "1 1 0",
    "0 0 1", "1 0 1", "0 1 1", "1 1 1"
  ]));

  assert.equal(lut.type, "3d");
  assert.equal(lut.size, 2);
  assert.equal(lut.title, "Test LUT");
  assertChannels(lut.sample(0.25, 0.5, 0.75), [0.25, 0.5, 0.75]);
});

test("parses and interpolates a 2^3 invert LUT", () => {
  const lut = lutTools.parseCube(cube3d([
    "1 1 1", "0 1 1", "1 0 1", "0 0 1",
    "1 1 0", "0 1 0", "1 0 0", "0 0 0"
  ]));

  assertChannels(lut.sample(0.2, 0.4, 0.8), [0.8, 0.6, 0.2]);
});

test("supports 1D LUT interpolation independently for RGB channels", () => {
  const lut = lutTools.parseCube([
    "LUT_1D_SIZE 2",
    "1 1 1",
    "0 0 0"
  ].join("\n"));

  assert.equal(lut.type, "1d");
  assertChannels(lut.sample(0.25, 0.5, 0.75), [0.75, 0.5, 0.25]);
});

test("normalizes and clamps samples through DOMAIN_MIN and DOMAIN_MAX", () => {
  const lut = lutTools.parseCube(cube3d([
    "0 0 0", "1 0 0", "0 1 0", "1 1 0",
    "0 0 1", "1 0 1", "0 1 1", "1 1 1"
  ], [
    "DOMAIN_MIN 0.2 0.3 0.4",
    "DOMAIN_MAX 0.8 0.9 1.0"
  ]));

  assertChannels(lut.sample(0.2, 0.3, 0.4), [0, 0, 0]);
  assertChannels(lut.sample(0.5, 0.6, 0.7), [0.5, 0.5, 0.5]);
  assertChannels(lut.sample(-1, 2, 1.5), [0, 1, 1]);
});

test("rejects a LUT whose number of data rows does not match its declared size", () => {
  assert.throws(
    () => lutTools.parseCube(cube3d(["0 0 0", "1 1 1"])),
    /LUT 数据行数不正确/
  );
});

test("blends RGB by opacity while preserving the original alpha channel", () => {
  const original = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([10, 20, 30, 40, 100, 110, 120, 130])
  };
  const processed = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([110, 220, 230, 255, 200, 10, 20, 0])
  };

  const halfway = lutTools.blendImageData(original, processed, 0.5);
  assert.deepEqual(
    Array.from(halfway.data),
    [60, 120, 130, 40, 150, 60, 70, 130]
  );
  assert.deepEqual(Array.from(lutTools.blendImageData(original, processed, 0).data), Array.from(original.data));
  assert.deepEqual(
    Array.from(lutTools.blendImageData(original, processed, 1).data),
    [110, 220, 230, 40, 200, 10, 20, 130]
  );
});

test("composes an original-left and LUT-right split with adjustable opacity", () => {
  const original = { width: 2, height: 1, data: new Uint8ClampedArray([10, 20, 30, 40, 100, 110, 120, 130]) };
  const processed = { width: 2, height: 1, data: new Uint8ClampedArray([210, 220, 230, 0, 200, 10, 20, 0]) };
  const result = lutTools.composeSplitImageData(original, processed, 0.5, 0.5);
  assert.deepEqual(Array.from(result.data), [10, 20, 30, 40, 150, 60, 70, 130]);
});
