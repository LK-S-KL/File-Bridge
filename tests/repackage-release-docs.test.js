const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SOURCE_SHA256, renderGuide, validateRevision, validateSource, assertManifestVersion, outputPaths, assertNoExisting, extractZip, treeManifest, assertPayloadUnchanged, publishFiles, repackageDocs, parseArgs } = require("../scripts/repackage-release-docs.cjs");

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "file-bridge-repack-test-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  return temp;
}

test("installation guide substitutes every version token and rejects unresolved templates", () => {
  assert.equal(renderGuide("Version {{VERSION}}\nAgain {{VERSION}}", "0.6.7"), "Version 0.6.7\nAgain 0.6.7");
  assert.throws(() => renderGuide("No version", "0.6.7"), /no.*token/);
  assert.throws(() => renderGuide("{{VERSION}} {{OTHER}}", "0.6.7"), /unresolved/);
  const guide = fs.readFileSync(path.join(__dirname, "../packaging/README-INTERNAL.txt"), "utf8");
  assert.ok(renderGuide(guide, "0.6.7").includes("0.6.7"));
  assert.doesNotMatch(renderGuide(guide, "0.6.7"), /\{\{/);
});

test("revision and explicit CLI options keep output names within the chosen directory", () => {
  assert.equal(validateRevision("install-r2"), "install-r2");
  for (const revision of ["", "../install-r2", "install-r0", "install-r02", "install-r2.zip", "install-r2/child", "r2"]) {
    assert.throws(() => validateRevision(revision), /Revision/);
  }
  const paths = outputPaths("/tmp/repack", "0.6.7", "install-r2");
  assert.equal(path.basename(paths.zip), "File-Bridge-0.6.7-macOS-install-r2.zip");
  assert.equal(path.basename(paths.dmg), "File-Bridge-0.6.7-macOS-install-r2.dmg");
  assert.equal(path.basename(paths.checksums), "SHA256SUMS-0.6.7-install-r2.txt");
  assert.equal(path.basename(paths.guide), "File-Bridge-0.6.7-macOS-Install-Guide.txt");
  assert.equal(path.basename(paths.verification), "verification.json");
  assert.deepEqual(parseArgs(["--source", "original.zip", "--output", "repacked", "--version", "0.6.7", "--revision", "install-r2"]), {
    source: "original.zip", output: "repacked", version: "0.6.7", revision: "install-r2"
  });
  assert.throws(() => parseArgs(["--source"]), /Use --source/);
  assert.throws(() => outputPaths("/tmp/repack", "../0.6.7", "install-r2"), /Version/);
});

test("existing files and dangling links block all publication before any output is written", t => {
  const temp = fixture(t);
  const source = path.join(temp, "source");
  const target = path.join(temp, "existing");
  const next = path.join(temp, "next");
  fs.writeFileSync(source, "new");
  fs.writeFileSync(target, "original");
  assert.throws(() => publishFiles([[source, next], [source, target]]), /refusing to overwrite/);
  assert.equal(fs.existsSync(next), false);
  assert.equal(fs.readFileSync(target, "utf8"), "original");
  const link = path.join(temp, "dangling");
  fs.symlinkSync(path.join(temp, "missing"), link);
  assert.throws(() => assertNoExisting([link]), /refusing to overwrite/);
  const outputs = outputPaths(temp, "0.6.7", "install-r2");
  fs.writeFileSync(outputs.zip, "existing release");
  assert.throws(() => repackageDocs({ source: "/missing-source.zip", output: temp, version: "0.6.7", revision: "install-r2" }), /refusing to overwrite/);
});

test("failed publication removes only the new outputs it created", t => {
  const temp = fixture(t);
  const source = path.join(temp, "source");
  const target = path.join(temp, "first");
  fs.writeFileSync(source, "payload");
  assert.throws(() => publishFiles([[source, target], [path.join(temp, "missing"), path.join(temp, "second")]]), /ENOENT/);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.readFileSync(source, "utf8"), "payload");
});

test("payload manifest catches content, mode, removal, and extra file changes", t => {
  const temp = fixture(t);
  const script = path.join(temp, "install.command");
  fs.writeFileSync(script, "#!/bin/zsh\nexit 0\n", { mode: 0o755 });
  const original = treeManifest(temp);
  assert.doesNotThrow(() => assertPayloadUnchanged(original, treeManifest(temp)));
  fs.writeFileSync(script, "#!/bin/zsh\nexit 1\n");
  assert.throws(() => assertPayloadUnchanged(original, treeManifest(temp)), /integrity mismatch/);
  fs.writeFileSync(script, "#!/bin/zsh\nexit 0\n");
  fs.chmodSync(script, 0o644);
  assert.throws(() => assertPayloadUnchanged(original, treeManifest(temp)), /integrity mismatch/);
  fs.chmodSync(script, 0o755);
  fs.writeFileSync(path.join(temp, "extra"), "extra");
  assert.throws(() => assertPayloadUnchanged(original, treeManifest(temp)), /integrity mismatch/);
  fs.unlinkSync(path.join(temp, "extra"));
  fs.unlinkSync(script);
  assert.throws(() => assertPayloadUnchanged(original, treeManifest(temp)), /integrity mismatch/);
});

test("only the exact published source and version are accepted before output creation", t => {
  const temp = fixture(t);
  const source = path.join(temp, "unknown.zip");
  fs.writeFileSync(source, "not the published release");
  assert.throws(() => validateSource(source, "0.6.7"), /Source SHA256 mismatch/);
  assert.throws(() => validateSource(source, "0.6.8"), /Version must be 0.6.7/);
  const output = path.join(temp, "output");
  assert.throws(() => repackageDocs({ source, output, version: "0.6.7", revision: "install-r2", projectRoot: "/missing-project" }), /Source SHA256 mismatch/);
  assert.equal(fs.existsSync(output), false);
});

test("extension manifest version is read by xmllint and prevents relabeling runtime", t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "extension/CSXS"), { recursive: true });
  const manifest = path.join(root, "extension/CSXS/manifest.xml");
  fs.writeFileSync(manifest, '<ExtensionManifest ExtensionBundleVersion="0.6.8"/>');
  assert.throws(() => assertManifestVersion(root, "0.6.7"), /manifest version mismatch/);
  fs.writeFileSync(manifest, '<ExtensionManifest ExtensionBundleVersion="0.6.7"/>');
  assert.equal(assertManifestVersion(root, "0.6.7"), "0.6.7");
});

const publishedSource = process.env.LKFB_RELEASE_SOURCE || path.join(os.homedir(), "Desktop/LK‘s File Bridge 0.6.7 稳定性内测.zip");
test("known published archive has the pinned hash and matching extension manifest", { skip: !fs.existsSync(publishedSource) }, t => {
  assert.equal(validateSource(publishedSource, "0.6.7"), SOURCE_SHA256);
  const temp = fixture(t);
  extractZip(publishedSource, temp);
  const roots = fs.readdirSync(temp, { withFileTypes: true });
  assert.equal(roots.length, 1);
  assert.ok(roots[0].isDirectory());
  const root = path.join(temp, roots[0].name);
  assert.equal(assertManifestVersion(root, "0.6.7"), "0.6.7");
  const manifest = treeManifest(root);
  assert.ok(Object.keys(manifest).some(name => name.startsWith("extension/") && manifest[name].type === "file"));
  for (const name of Object.keys(manifest).filter(name => name.endsWith(".command"))) {
    assert.ok(manifest[name].mode & 0o111, name + " must remain executable");
  }
  assert.equal(validateSource(publishedSource, "0.6.7"), SOURCE_SHA256);
});

test("extraction preserves CRLF and binary bytes even with inherited unzip text-conversion options", t => {
  const temp = fixture(t);
  const root = path.join(temp, "Release");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "script.command"), "#!/bin/zsh\r\nexit 0\r\n", { mode: 0o755 });
  fs.writeFileSync(path.join(root, "binary"), Buffer.from([0, 13, 10, 255, 13, 10]));
  const archive = path.join(temp, "release.zip");
  execFileSync("/usr/bin/zip", ["-rqX", archive, "Release"], { cwd: temp });
  const previous = [process.env.UNZIP, process.env.UNZIPOPT];
  try {
    process.env.UNZIP = "-aa";
    process.env.UNZIPOPT = "-aa";
    extractZip(archive, path.join(temp, "extracted"));
  } finally {
    for (const [index, name] of ["UNZIP", "UNZIPOPT"].entries()) {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    }
  }
  assertPayloadUnchanged(treeManifest(root), treeManifest(path.join(temp, "extracted/Release")));
});
