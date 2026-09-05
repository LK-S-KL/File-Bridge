const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const assetOpsModule = require("../extension/js/asset-ops.js");

function createFixture(prefix) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const root = path.join(base, "library");
  const external = path.join(base, "external");
  const trash = path.join(base, "trash");
  fs.mkdirSync(root);
  fs.mkdirSync(external);
  fs.mkdirSync(trash);
  return { base, root, external, trash, roots: [{ id: "root", path: root }] };
}

function descriptor(root, filePath) {
  const stat = fs.statSync(filePath);
  return {
    rootId: "root",
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
    modifiedMs: stat.mtimeMs
  };
}

function guardedFs() {
  const facade = Object.create(fs);
  ["existsSync", "statSync", "lstatSync", "realpathSync", "readdirSync"].forEach((name) => {
    facade[name] = () => { throw new Error(`forbidden synchronous fs call: ${name}`); };
  });
  return facade;
}

function testTrash(fixture) {
  let counter = 0;
  return async function trashItem(sourcePath) {
    counter += 1;
    const destination = path.join(fixture.trash, `${counter}-${path.basename(sourcePath)}`);
    await fs.promises.rename(sourcePath, destination);
    return { ok: true, out: destination };
  };
}

test("creates safe folders asynchronously and reports progress", async () => {
  const fixture = createFixture("lkfb-asset-folder-");
  const progress = [];
  const ops = assetOpsModule.create({ fs: guardedFs(), path });
  try {
    const pending = ops.createFolder({
      roots: fixture.roots,
      rootId: "root",
      parentPath: fixture.root,
      name: "新素材文件夹",
      onProgress: (event) => progress.push(event)
    });
    assert.equal(typeof pending.then, "function");
    const result = await pending;
    assert.equal(result.path, path.join(fixture.root, "新素材文件夹"));
    assert.equal((await fs.promises.lstat(result.path)).isDirectory(), true);
    assert.deepEqual(progress.map((item) => item.phase), ["start", "item", "complete"]);

    await assert.rejects(ops.createFolder({
      roots: fixture.roots,
      rootId: "root",
      parentPath: fixture.root,
      name: "../越界"
    }), /不支持的字符/);
    await assert.rejects(ops.createFolder({
      roots: fixture.roots,
      rootId: "root",
      parentPath: fixture.root,
      name: " 尾部空格 "
    }), /不支持的字符/);
  } finally {
    fs.rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("copies external files with COPYFILE_EXCL suffixes and never overwrites", async () => {
  const fixture = createFixture("lkfb-asset-import-");
  const source = path.join(fixture.external, "镜头.mp4");
  const existing = path.join(fixture.root, "镜头.mp4");
  const progress = [];
  fs.writeFileSync(source, "new-media", "utf8");
  fs.writeFileSync(existing, "existing-media", "utf8");
  const ops = assetOpsModule.create({ fs: guardedFs(), path });
  try {
    const results = await ops.copyExternalFiles({
      roots: fixture.roots,
      rootId: "root",
      destinationPath: fixture.root,
      sourcePaths: [source, source],
      onProgress: (event) => progress.push(event)
    });
    assert.deepEqual(results.map((item) => item.name), ["镜头 (1).mp4", "镜头 (2).mp4"]);
    assert.equal(await fs.promises.readFile(existing, "utf8"), "existing-media");
    assert.equal(await fs.promises.readFile(results[0].path, "utf8"), "new-media");
    assert.equal(progress.filter((item) => item.phase === "item").length, 2);
    assert.equal(progress.at(-1).phase, "complete");
  } finally {
    fs.rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("creates duplicate files beside their sources without overwriting", async () => {
  const fixture = createFixture("lkfb-asset-copy-");
  const source = path.join(fixture.root, "片段.mov");
  fs.writeFileSync(source, "source", "utf8");
  fs.writeFileSync(path.join(fixture.root, "片段 副本.mov"), "keep", "utf8");
  const ops = assetOpsModule.create({ fs: guardedFs(), path });
  try {
    const results = await ops.createCopies({ roots: fixture.roots, assets: [descriptor(fixture.root, source)] });
    assert.equal(results[0].name, "片段 副本 (1).mov");
    assert.equal(await fs.promises.readFile(results[0].path, "utf8"), "source");
    assert.equal(await fs.promises.readFile(path.join(fixture.root, "片段 副本.mov"), "utf8"), "keep");
  } finally {
    fs.rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("moves multiple files into a validated folder and keeps colliding names", async () => {
  const fixture = createFixture("lkfb-asset-move-");
  const sourceFolder = path.join(fixture.root, "来源");
  const destination = path.join(fixture.root, "归档");
  fs.mkdirSync(sourceFolder);
  fs.mkdirSync(destination);
  const first = path.join(sourceFolder, "A.wav");
  const second = path.join(sourceFolder, "B.wav");
  fs.writeFileSync(first, "a", "utf8");
  fs.writeFileSync(second, "b", "utf8");
  fs.writeFileSync(path.join(destination, "A.wav"), "existing", "utf8");
  const progress = [];
  const ops = assetOpsModule.create({ fs: guardedFs(), path, trashItem: testTrash(fixture) });
  try {
    const results = await ops.moveAssetsToFolder({
      roots: fixture.roots,
      destinationRootId: "root",
      destinationPath: destination,
      assets: [descriptor(fixture.root, first), descriptor(fixture.root, second)],
      onProgress: (event) => progress.push(event)
    });
    assert.deepEqual(results.map((item) => item.name), ["A (1).wav", "B.wav"]);
    assert.equal(await fs.promises.readFile(path.join(destination, "A.wav"), "utf8"), "existing");
    assert.equal(await fs.promises.readFile(results[0].path, "utf8"), "a");
    assert.equal(await fs.promises.readFile(results[1].path, "utf8"), "b");
    await assert.rejects(fs.promises.lstat(first), { code: "ENOENT" });
    assert.equal(progress.filter((item) => item.phase === "item").length, 2);
  } finally {
    fs.rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("renames folders but refuses configured roots, traversal, and collisions", async () => {
  const fixture = createFixture("lkfb-asset-rename-");
  const folder = path.join(fixture.root, "旧文件夹");
  const caseFolder = path.join(fixture.root, "CaseFolder");
  fs.mkdirSync(folder);
  fs.mkdirSync(caseFolder);
  fs.mkdirSync(path.join(fixture.root, "已存在"));
  const ops = assetOpsModule.create({ fs: guardedFs(), path });
  try {
    const result = await ops.renameFolder({
      roots: fixture.roots,
      folder: { rootId: "root", path: folder },
      newName: "新文件夹"
    });
    assert.equal(result.changed, true);
    assert.equal((await fs.promises.lstat(result.path)).isDirectory(), true);

    const caseResult = await ops.renameFolder({
      roots: fixture.roots,
      folder: { rootId: "root", path: caseFolder },
      newName: "casefolder"
    });
    assert.equal(caseResult.name, "casefolder");
    assert.equal((await fs.promises.lstat(caseResult.path)).isDirectory(), true);

    await assert.rejects(ops.renameFolder({
      roots: fixture.roots,
      folder: { rootId: "root", path: result.path },
      newName: "已存在"
    }), /已存在同名/);

    await assert.rejects(ops.renameFolder({
      roots: fixture.roots,
      folder: { rootId: "root", path: fixture.root },
      newName: "不能重命名根"
    }), /不在已授权/);
  } finally {
    fs.rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("moves files and folders through the recoverable trash adapter", async () => {
  const fixture = createFixture("lkfb-asset-trash-");
  const file = path.join(fixture.root, "删除我.txt");
  const folder = path.join(fixture.root, "删除文件夹");
  fs.writeFileSync(file, "recoverable", "utf8");
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "inside.txt"), "inside", "utf8");
  const progress = [];
  const ops = assetOpsModule.create({ fs: guardedFs(), path, trashItem: testTrash(fixture) });
  try {
    const results = await ops.moveToTrash({
      roots: fixture.roots,
      targets: [{ rootId: "root", path: file }, { rootId: "root", path: folder }],
      onProgress: (event) => progress.push(event)
    });
    assert.equal(results.length, 2);
    assert.equal((await fs.promises.lstat(results[0].trashPath)).isFile(), true);
    assert.equal((await fs.promises.lstat(results[1].trashPath)).isDirectory(), true);
    assert.equal(progress.at(-1).phase, "complete");
  } finally {
    fs.rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("rejects path traversal and every symbolic-link target without touching its referent", async (t) => {
  if (process.platform === "win32") { t.skip("symlink fixture requires elevated Windows permissions"); return; }
  const fixture = createFixture("lkfb-asset-symlink-");
  const outside = path.join(fixture.base, "outside.txt");
  const outsideFolder = path.join(fixture.base, "outside-folder");
  const linkedFile = path.join(fixture.root, "linked.txt");
  const linkedFolder = path.join(fixture.root, "linked-folder");
  fs.writeFileSync(outside, "must-survive", "utf8");
  fs.mkdirSync(outsideFolder);
  fs.symlinkSync(outside, linkedFile);
  fs.symlinkSync(outsideFolder, linkedFolder);
  const externalLink = path.join(fixture.external, "external-link.txt");
  fs.symlinkSync(outside, externalLink);
  const ops = assetOpsModule.create({ fs: guardedFs(), path, trashItem: testTrash(fixture) });
  try {
    await assert.rejects(ops.moveToTrash({
      roots: fixture.roots,
      targets: [{ rootId: "root", path: linkedFile }]
    }), /符号链接/);
    await assert.rejects(ops.createFolder({
      roots: fixture.roots,
      rootId: "root",
      parentPath: linkedFolder,
      name: "escape"
    }), /符号链接/);
    await assert.rejects(ops.createFolder({
      roots: fixture.roots,
      rootId: "root",
      parentPath: path.join(fixture.root, ".."),
      name: "escape"
    }), /不在已授权/);
    await assert.rejects(ops.copyExternalFiles({
      roots: fixture.roots,
      rootId: "root",
      destinationPath: fixture.root,
      sourcePaths: [externalLink]
    }), /符号链接/);
    await assert.rejects(ops.moveToTrash({
      roots: fixture.roots,
      targets: [{ rootId: "root", path: fixture.root }]
    }), /不在已授权/);
    assert.equal(await fs.promises.readFile(outside, "utf8"), "must-survive");
    assert.equal(await fs.promises.readdir(outsideFolder).then((items) => items.length), 0);
  } finally {
    fs.rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("rejects a configured root that is itself a symbolic link", async (t) => {
  if (process.platform === "win32") { t.skip("symlink fixture requires elevated Windows permissions"); return; }
  const fixture = createFixture("lkfb-asset-root-link-");
  const linkedRoot = path.join(fixture.base, "linked-root");
  fs.symlinkSync(fixture.root, linkedRoot);
  const ops = assetOpsModule.create({ fs: guardedFs(), path });
  try {
    await assert.rejects(ops.createFolder({
      roots: [{ id: "linked", path: linkedRoot }],
      rootId: "linked",
      parentPath: linkedRoot,
      name: "blocked"
    }), /符号链接/);
    assert.equal(await fs.promises.readdir(fixture.root).then((items) => items.includes("blocked")), false);
  } finally {
    fs.rmSync(fixture.base, { recursive: true, force: true });
  }
});
