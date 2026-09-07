const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { validateBundle } = require("../scripts/package-macos.cjs");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-bundle-contract-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manifest = { schemaVersion: 1, license: "GPL-2.0-or-later", sourceSignature: { status: "verified" }, architectures: {}, sources: [] };
  function file(relative, contents, mode = 0o644) {
    const target = path.join(directory, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, { mode });
    return crypto.createHash("sha256").update(contents).digest("hex");
  }
  for (const arch of ["arm64", "x64"]) {
    const target = "darwin-" + arch;
    const binaries = {};
    for (const name of ["ffmpeg", "ffprobe"]) {
      const relative = target + "/" + name;
      binaries[name] = { path: relative, sha256: file(relative, "mock binary", 0o755), dependencies: ["/usr/lib/libSystem.B.dylib"] };
    }
    manifest.architectures[target] = { binaries };
    for (const name of ["COPYING.GPLv2", "x264-COPYING", "configure-arguments.json"]) file("legal/" + target + "/" + name, "fixture");
  }
  for (const name of ["ffmpeg", "x264"]) {
    const relative = "sources/" + name + ".tar";
    manifest.sources.push({ name, path: relative, sha256: file(relative, "source fixture") });
  }
  file("legal/build-macos-media.cjs", "build fixture");
  const save = () => fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  save();
  return { directory, manifest, save };
}

test("macOS delivery requires two verified tool pairs plus corresponding source and legal records", t => {
  const f = fixture(t);
  assert.doesNotThrow(() => validateBundle(f.directory));
  fs.rmSync(path.join(f.directory, "sources/x264.tar"));
  assert.throws(() => validateBundle(f.directory), /ENOENT/);
});

test("macOS delivery rejects missing Intel pair and changed binary hashes", t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.directory, "darwin-arm64/ffprobe"), "changed");
  assert.throws(() => validateBundle(f.directory), /Hash mismatch/);
  fs.writeFileSync(path.join(f.directory, "darwin-arm64/ffprobe"), "mock binary");
  delete f.manifest.architectures["darwin-x64"];
  f.save();
  assert.throws(() => validateBundle(f.directory), /Missing darwin-x64/);
});

test("macOS delivery refuses Homebrew-linked binaries and invalid source paths", t => {
  const f = fixture(t);
  f.manifest.architectures["darwin-arm64"].binaries.ffmpeg.dependencies.push("/opt/homebrew/lib/libavcodec.dylib");
  f.save();
  assert.throws(() => validateBundle(f.directory), /External runtime/);
  f.manifest.architectures["darwin-arm64"].binaries.ffmpeg.dependencies.pop();
  f.manifest.sources[0].path = "../outside.tar";
  f.save();
  assert.throws(() => validateBundle(f.directory));
});
