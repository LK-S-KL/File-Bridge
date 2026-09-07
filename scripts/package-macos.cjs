#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { treeManifest, assertPayloadUnchanged, publishFiles } = require("./repackage-release-docs.cjs");
const root = path.resolve(__dirname, "..");

function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function run(command, args, options = {}) {
  const env = { ...process.env, ...options.env };
  for (const name of ["UNZIP", "UNZIPOPT", "ZIPOPT"]) delete env[name];
  return execFileSync(command, args, { encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024, ...options, env });
}

function validateBundle(base) {
  const manifest = JSON.parse(fs.readFileSync(path.join(base, "manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.license, "GPL-2.0-or-later");
  assert.equal(manifest.sourceSignature.status, "verified");
  for (const arch of ["arm64", "x64"]) {
    const target = `darwin-${arch}`;
    const entry = manifest.architectures[target];
    assert.ok(entry && entry.binaries, `Missing ${target}`);
    for (const name of ["ffmpeg", "ffprobe"]) {
      const binary = entry.binaries[name];
      assert.equal(binary.path, `${target}/${name}`);
      const file = path.join(base, binary.path);
      assert.equal(fs.lstatSync(file).isFile(), true);
      assert.ok(fs.statSync(file).mode & 0o111, `Not executable: ${file}`);
      assert.equal(hash(file), binary.sha256, `Hash mismatch: ${file}`);
      assert.ok(binary.dependencies.length > 0);
      assert.ok(binary.dependencies.every(dependency => dependency.startsWith("/usr/lib/") || dependency.startsWith("/System/Library/")), "External runtime library dependency");
    }
    for (const name of ["COPYING.GPLv2", "x264-COPYING", "configure-arguments.json"]) {
      assert.ok(fs.statSync(path.join(base, "legal", target, name)).size > 0, `Missing legal file ${name}`);
    }
  }
  assert.ok(manifest.sources.some(source => source.name === "ffmpeg"));
  assert.ok(manifest.sources.some(source => source.name === "x264"));
  for (const source of manifest.sources) {
    assert.equal(source.path, "sources/" + path.basename(source.path));
    assert.equal(hash(path.join(base, source.path)), source.sha256, "Source archive hash mismatch");
  }
  assert.ok(fs.statSync(path.join(base, "legal", "build-macos-media.cjs")).size > 0);
  return manifest;
}

function packageMacOS(output) {
  assert.equal(process.platform, "darwin", "Mac packaging requires macOS");
  const version = require(path.join(root, "package.json")).version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const base = `File-Bridge-${version}-macOS`;
  output = path.resolve(output || path.join(os.homedir(), "Desktop", base));
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`);
  const media = path.join(root, "build", "macos-media");
  const manifest = validateBundle(media);
  for (const [target, arch] of [["darwin-arm64", "arm64"], ["darwin-x64", "x86_64"]]) {
    for (const name of ["ffmpeg", "ffprobe"]) {
      const file = path.join(media, target, name);
      assert.equal(run("/usr/bin/lipo", ["-archs", file]).trim(), arch);
      run("/usr/bin/codesign", ["--verify", "--strict", file]);
      const linked = run("/usr/bin/otool", ["-L", file]).split("\n").slice(1).filter(line => line.trim());
      assert.ok(linked.every(line => /^\s*\/(usr\/lib|System\/Library)\//.test(line)), "Binary requires non-system runtime libraries");
    }
  }
  run(process.execPath, [path.join(root, "scripts", "version.js"), "check"]);
  run("npm", ["test"], { cwd: root, stdio: "inherit", timeout: 300000 });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-macos-package-"));
  let mounted = false;
  const mount = path.join(temp, "mount");
  try {
    const stage = path.join(temp, base);
    const extension = path.join(stage, "extension");
    fs.mkdirSync(stage);
    fs.cpSync(path.join(root, "extension"), extension, { recursive: true, filter: source => path.basename(source) !== ".DS_Store" && source !== path.join(root, "extension/vendor/media") });
    const bundle = path.join(extension, "vendor", "media");
    fs.mkdirSync(bundle, { recursive: true });
    for (const directory of ["darwin-arm64", "darwin-x64", "legal", "sources"]) {
      fs.cpSync(path.join(media, directory), path.join(bundle, directory), { recursive: true });
    }
    fs.copyFileSync(path.join(media, "manifest.json"), path.join(bundle, "manifest.json"));
    validateBundle(bundle);
    for (const [source, destination] of [
      ["install-internal.command", "安装 LK‘s File Bridge.command"],
      ["uninstall-internal.command", "卸载 LK‘s File Bridge.command"],
      ["extension-maintenance.zsh", "extension-maintenance.zsh"]
    ]) {
      fs.copyFileSync(path.join(root, "packaging", source), path.join(stage, destination));
      if (destination.endsWith(".command")) fs.chmodSync(path.join(stage, destination), 0o755);
    }
    fs.copyFileSync(path.join(extension, "help", "MAC-INSTALL.txt"), path.join(stage, "先读我-安装说明.txt"));
    fs.writeFileSync(path.join(stage, "版本.txt"), `LK‘s File Bridge ${version}\nmacOS Apple Silicon / Intel\nFFmpeg ${manifest.ffmpegVersion} bundled\n`);
    fs.writeFileSync(path.join(stage, "开源组件说明.txt"), "FFmpeg / x264 are distributed as GPL-2.0-or-later subprocess executables.\nComplete corresponding source archives: extension/vendor/media/sources\nLicenses, build recipe and configuration: extension/vendor/media/legal\nHashes and architecture details: extension/vendor/media/manifest.json\nhttps://ffmpeg.org/legal.html\n");
    const report = path.join(root, "docs", `V${version}_MACOS_RELEASE.md`);
    if (fs.existsSync(report)) fs.copyFileSync(report, path.join(stage, "交付验证报告.md"));
    const baseline = treeManifest(stage);
    const zip = path.join(temp, base + ".zip"), dmg = path.join(temp, base + ".dmg");
    run("/usr/bin/zip", ["-r", "-X", zip, base], { cwd: temp, env: { COPYFILE_DISABLE: "1" } });
    run("/usr/bin/unzip", ["-tq", zip]);
    run("/usr/bin/unzip", ["-b", "-q", zip, "-d", path.join(temp, "verify")]);
    assertPayloadUnchanged(baseline, treeManifest(path.join(temp, "verify", base)));
    run("/usr/bin/hdiutil", ["create", "-volname", base, "-srcfolder", stage, "-format", "UDZO", dmg]);
    run("/usr/bin/hdiutil", ["verify", dmg]);
    fs.mkdirSync(mount);
    mounted = true;
    run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg]);
    assertPayloadUnchanged(baseline, treeManifest(mount, new Set([".DS_Store", ".fseventsd", ".Trashes", ".Spotlight-V100"])));
    run("/usr/bin/hdiutil", ["detach", mount]);
    mounted = false;
    const guide = path.join(temp, `File-Bridge-${version}-Mac-Install-Guide.txt`);
    fs.copyFileSync(path.join(stage, "先读我-安装说明.txt"), guide);
    const sources = path.join(temp, `File-Bridge-${version}-FFmpeg-Sources.zip`);
    run("/usr/bin/zip", ["-r", "-X", sources, "sources", "legal", "manifest.json"], { cwd: bundle, env: { COPYFILE_DISABLE: "1" } });
    const verification = path.join(temp, `File-Bridge-${version}-Package-Verification.json`);
    fs.writeFileSync(verification, JSON.stringify({ version, date: new Date().toISOString(), mediaVersion: manifest.ffmpegVersion, zip: { sha256: hash(zip), contentsVerified: true }, dmg: { sha256: hash(dmg), contentsVerified: true }, payloadFiles: Object.values(baseline).filter(value => value.type === "file").length, sourceLicense: manifest.license, minimumMediaMacOS: manifest.minimumMacOS, limits: "Ad-hoc signed, not notarized. Intel tools smoke-tested under Rosetta, not on an Intel Mac. No Windows support." }, null, 2) + "\n");
    const files = [zip, dmg, guide, sources, verification];
    const sums = path.join(temp, "SHA256SUMS.txt");
    fs.writeFileSync(sums, files.map(file => `${hash(file)}  ${path.basename(file)}\n`).join(""));
    fs.mkdirSync(output);
    publishFiles(files.concat(sums).map(file => [file, path.join(output, path.basename(file))]));
    return output;
  } finally {
    if (mounted) { run("/usr/bin/hdiutil", ["detach", mount]); mounted = false; }
    if (!mounted) fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { console.log(packageMacOS(process.argv[2])); }
  catch (error) { console.error(error.stack); process.exitCode = 1; }
}
module.exports = { validateBundle, packageMacOS };
