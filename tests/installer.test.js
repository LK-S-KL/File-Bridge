const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.join(__dirname, "..");
const bundleId = "com.fnnas.seekbridge.mvp";

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-install-test-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const installHome = path.join(temp, "home");
  const packageDir = path.join(temp, "package");
  const bins = path.join(temp, "bin");
  const extensions = path.join(installHome, "Library/Application Support/Adobe/CEP/extensions");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(bins, { recursive: true });
  for (const filename of ["install-internal.command", "uninstall-internal.command", "extension-maintenance.zsh"]) {
    fs.copyFileSync(path.join(projectRoot, "packaging", filename), path.join(packageDir, filename));
  }
  for (const name of ["ffmpeg", "ffprobe"]) fs.writeFileSync(path.join(bins, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  function extensionAt(location, id = bundleId) {
    fs.mkdirSync(path.join(location, "CSXS"), { recursive: true });
    fs.writeFileSync(path.join(location, "CSXS/manifest.xml"), `<ExtensionManifest ExtensionBundleId="${id}" ExtensionBundleVersion="test"/>`);
    fs.writeFileSync(path.join(location, "index.html"), location);
  }
  extensionAt(path.join(packageDir, "extension"));
  const env = { ...process.env, LKFB_INSTALL_HOME: installHome, LKFB_SKIP_DEFAULTS: "1", LKFB_MEDIA_BIN_DIR: bins };
  const run = (name, extraEnv = {}) => childProcess.spawnSync("/bin/zsh", [path.join(packageDir, name + "-internal.command")], { env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 25000 });
  const matches = () => fs.existsSync(extensions) ? fs.readdirSync(extensions).filter(name => {
    const manifest = path.join(extensions, name, "CSXS/manifest.xml");
    return fs.existsSync(manifest) && fs.readFileSync(manifest, "utf8").includes(`ExtensionBundleId="${bundleId}"`);
  }) : [];
  return { temp, bins, installHome, packageDir, extensions, env, run, matches, extensionAt };
}

test("installer migrates same-ID legacy directories outside CEP, stays single after three upgrades, and fully uninstalls", t => {
  const f = fixture(t);
  const unrelated = path.join(f.extensions, "other.extension");
  f.extensionAt(unrelated, "other.extension");
  f.extensionAt(path.join(f.extensions, bundleId + ".backup.old"));
  f.extensionAt(path.join(f.extensions, "renamed-legacy-copy"));
  for (let i = 0; i < 3; i++) {
    const result = f.run("install");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(f.matches(), [bundleId]);
  }
  const backups = path.join(f.installHome, "Library/Application Support/LK File Bridge/Extension Backups");
  assert.equal(fs.readdirSync(backups).length, 3);
  const result = f.run("uninstall");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(f.matches(), []);
  assert.equal(fs.existsSync(unrelated), true);
});

test("installer requires both runnable binaries before changing an existing extension", t => {
  const f = fixture(t);
  const destination = path.join(f.extensions, bundleId);
  f.extensionAt(destination);
  fs.rmSync(path.join(f.bins, "ffprobe"));
  let result = f.run("install");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ffprobe/);
  assert.equal(fs.readFileSync(path.join(destination, "index.html"), "utf8"), destination);
  fs.writeFileSync(path.join(f.bins, "ffprobe"), "#!/bin/sh\nexit 42\n", { mode: 0o755 });
  result = f.run("install");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ffprobe/);
  assert.equal(fs.readFileSync(path.join(destination, "index.html"), "utf8"), destination);
});

test("installer rolls old extensions back if publishing the staged extension fails", t => {
  const f = fixture(t);
  const destination = path.join(f.extensions, bundleId);
  f.extensionAt(destination);
  fs.writeFileSync(path.join(f.bins, "mv"), '#!/bin/sh\ncase "$1" in */new-extension) exit 71;; esac\nexec /bin/mv "$@"\n', { mode: 0o755 });
  const result = f.run("install", { PATH: f.bins + ":" + process.env.PATH });
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.matches(), [bundleId], result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(destination, "index.html"), "utf8"), destination);
  assert.equal(fs.existsSync(path.join(f.installHome, "Library/Application Support/LK File Bridge/.extension-operation-lock")), false);
});

test("installer rejects an unrelated canonical destination and a concurrent operation", t => {
  const f = fixture(t);
  const destination = path.join(f.extensions, bundleId);
  f.extensionAt(destination, "another.id");
  const result = f.run("install");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /其他内容占用/);
  assert.match(fs.readFileSync(path.join(destination, "CSXS/manifest.xml"), "utf8"), /another.id/);
  const lock = path.join(f.installHome, "Library/Application Support/LK File Bridge/.extension-operation-lock");
  fs.mkdirSync(lock);
  const locked = f.run("uninstall");
  assert.notEqual(locked.status, 0);
  assert.equal(fs.existsSync(lock), true);
});

test("uninstaller restores every earlier extension if one legacy directory cannot be archived", t => {
  const f = fixture(t);
  const first = path.join(f.extensions, "a-legacy");
  const blocked = path.join(f.extensions, "z-blocked");
  f.extensionAt(first);
  f.extensionAt(blocked);
  fs.writeFileSync(path.join(f.bins, "mv"), '#!/bin/sh\ncase "$1" in */z-blocked) exit 72;; esac\nexec /bin/mv "$@"\n', { mode: 0o755 });
  const result = f.run("uninstall", { PATH: f.bins + ":" + process.env.PATH });
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.matches(), ["a-legacy", "z-blocked"], result.stdout + result.stderr);
});

test("installer times out a hung binary check without changing the old extension", t => {
  const f = fixture(t);
  const destination = path.join(f.extensions, bundleId);
  f.extensionAt(destination);
  fs.writeFileSync(path.join(f.bins, "ffprobe"), "#!/bin/sh\nexec /bin/sleep 60\n", { mode: 0o755 });
  const started = Date.now();
  const result = f.run("install");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ffprobe/);
  assert.ok(Date.now() - started < 14000);
  assert.equal(fs.readFileSync(path.join(destination, "index.html"), "utf8"), destination);
});
