const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fileOpsModule = require("../extension/js/file-ops.js");

function fixtureAsset(root, name) {
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, "disposable fnOS Bridge fixture", "utf8");
  const stat = fs.statSync(filePath);
  return {
    id: "root:" + name,
    rootId: "root",
    path: filePath,
    name,
    extension: name.split(".").pop().toLowerCase(),
    size: stat.size,
    modifiedMs: stat.mtimeMs
  };
}

test("validates source containment and preserves extensions", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fnos-fileops-"));
  const asset = fixtureAsset(fixture, "镜头 01.mp4");
  const ops = fileOpsModule.create({ fs, path, childProcess });
  try {
    assert.equal(ops.validateSource(asset, [{ id: "root", path: fixture }]).sourceReal, fs.realpathSync(asset.path));
    assert.equal(ops.validateNewName(asset, "镜头 02.mp4"), "镜头 02.mp4");
    assert.throws(() => ops.validateNewName(asset, "镜头 02.mov"), /不允许更改扩展名/);
    assert.throws(() => ops.validateNewName(asset, "CON.mp4"), /保留名称/);
    assert.throws(() => ops.validateNewName(asset, "bad:name.mp4"), /不支持的字符/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("renames a disposable file without touching its contents", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fnos-rename-"));
  const asset = fixtureAsset(fixture, "旧名字.wav");
  const ops = fileOpsModule.create({ fs, path, childProcess });
  try {
    const result = ops.rename(asset, [{ id: "root", path: fixture }], "新名字.wav");
    assert.equal(result.changed, true);
    assert.equal(fs.existsSync(asset.path), false);
    assert.equal(fs.readFileSync(result.path, "utf8"), "disposable fnOS Bridge fixture");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("moves a disposable local file to Trash and can restore it", async (t) => {
  if (process.platform !== "darwin") { t.skip("macOS Foundation Trash test"); return; }
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fnos-trash-"));
  const asset = fixtureAsset(fixture, "可恢复测试.txt");
  const ops = fileOpsModule.create({ fs, path, childProcess });
  let result;
  try {
    result = await ops.moveToTrash(asset, [{ id: "root", path: fixture }]);
    assert.equal(fs.existsSync(asset.path), false);
    assert.ok(result.out && fs.existsSync(result.out));
    fs.renameSync(result.out, asset.path);
    assert.equal(fs.existsSync(asset.path), true);
  } finally {
    if (result && result.out && fs.existsSync(result.out)) { fs.renameSync(result.out, asset.path); }
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
