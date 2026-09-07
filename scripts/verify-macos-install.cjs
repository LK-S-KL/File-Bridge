#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const { extractZip, treeManifest, assertPayloadUnchanged } = require("./repackage-release-docs.cjs");

async function verify(archive, destination) {
  if (!archive || !destination) throw new Error("Usage: node scripts/verify-macos-install.cjs PACKAGE.zip REPORT.json");
  if (fs.existsSync(destination)) throw new Error("Report already exists");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-macos-acceptance-"));
  try {
    extractZip(path.resolve(archive), path.join(temp, "package"));
    const packageRoot = path.join(temp, "package", fs.readdirSync(path.join(temp, "package"))[0]);
    const extension = path.join(packageRoot, "extension");
    // Model browser quarantine on downloaded tools; installer must copy before executing.
    for (const arch of ["arm64", "x64"]) {
      for (const name of ["ffmpeg", "ffprobe"]) cp.execFileSync("/usr/bin/xattr", ["-w", "com.apple.quarantine", "0081;00000000;FileBridgeTest;", path.join(extension, "vendor/media/darwin-" + arch, name)]);
    }
    const home = path.join(temp, "isolated-user");
    const emptyTools = path.join(temp, "empty-system-bin");
    fs.mkdirSync(home); fs.mkdirSync(emptyTools);
    const version = cp.execFileSync("/usr/bin/xmllint", ["--nonet", "--xpath", "string(/ExtensionManifest/@ExtensionBundleVersion)", path.join(extension, "CSXS/manifest.xml")], { encoding: "utf8" }).trim();
    const env = { ...process.env, LKFB_INSTALL_HOME: home, LKFB_SKIP_DEFAULTS: "1", LKFB_MEDIA_BIN_DIR: emptyTools };
    const installation = path.join(home, "Library/Application Support/Adobe/CEP/extensions/com.fnnas.seekbridge.mvp");
    const install = () => cp.spawnSync("/bin/zsh", [path.join(packageRoot, "安装 LK‘s File Bridge.command")], { env, encoding: "utf8", timeout: 35000 });
    const baseline = treeManifest(extension);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = install();
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /使用内置媒体组件/);
      assertPayloadUnchanged(baseline, treeManifest(installation));
      assert.equal(cp.spawnSync("/usr/bin/xattr", ["-p", "com.apple.quarantine", path.join(installation, "vendor/media/darwin-arm64/ffmpeg")]).status, 1);
    }
    const wrapper = {
      execFile(binary, args, options, callback) {
        const isolated = binary === "/usr/bin/perl" && args[0].endsWith("resolve-media-tools.pl") ? args.concat(["--system-dir", emptyTools]) : args;
        return cp.execFile(binary, isolated, options, callback);
      }
    };
    const service = require(path.join(installation, "js/media-tools.js")).create({
      fs, path, crypto, childProcess: wrapper, os: { homedir: () => home }, extensionRoot: installation,
      cacheSettings: { minimumFreeBytes: 0 }
    });
    const status = await service.prepare();
    assert.equal(status.source, "bundled");
    const source = path.join(temp, "test clip.mp4");
    cp.execFileSync(service.findBinary("ffmpeg"), ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source], { timeout: 20000 });
    const originalHash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
    const metadata = await service.metadataFor(source);
    assert.equal(metadata.width, 320);
    const outputs = {};
    outputs.poster = await service.posterFor(source);
    outputs.waveform = await service.waveformFor(source);
    outputs.sprite = (await service.spriteFor(source)).path;
    outputs.proxy = await service.previewProxyFor(source, "360");
    outputs.audio = await service.audioProxyFor(source);
    outputs.frame = await service.frameFor(source, 0.2, 320, 180);
    for (const [kind, file] of Object.entries(outputs)) assert.ok(file && fs.statSync(file).size > 100, `${kind} not created`);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex"), originalHash);
    // Simulate a broken new package; the last successful installation must remain intact.
    fs.renameSync(path.join(extension, "vendor/media"), path.join(extension, "vendor/media-disabled"));
    const missing = install();
    assert.notEqual(missing.status, 0);
    assertPayloadUnchanged(baseline, treeManifest(installation));
    const uninstall = cp.spawnSync("/bin/zsh", [path.join(packageRoot, "卸载 LK‘s File Bridge.command")], { env, encoding: "utf8", timeout: 30000 });
    assert.equal(uninstall.status, 0, uninstall.stdout + uninstall.stderr);
    assert.equal(fs.existsSync(installation), false);
    assert.equal(fs.readdirSync(path.join(home, "Library/Application Support/LK File Bridge/Extension Backups")).length, 4);
    const report = {
      version, date: new Date().toISOString(), packageSha256: crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex"),
      platform: process.platform, architecture: process.arch, mediaSelection: status,
      passed: ["offline bundled installation", "quarantined source copied before execution", "upgrade", "installed payload matches archive", "runtime agrees with installer", "metadata", "poster", "waveform", "sprite", "video proxy", "audio proxy", "frame", "source preserved", "missing bundle preserves installed version", "recoverable uninstall"],
      limits: ["System tool directories excluded instead of uninstalling user FFmpeg", "Current-user Adobe directory untouched", "PlayerDebugMode preference write skipped", "No new Adobe host UI or Intel hardware acceptance"]
    };
    fs.writeFileSync(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
    return report;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
if (require.main === module) verify(process.argv[2], process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verify };
