#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const GUIDE_NAME = "README-内测安装说明.txt";
const REPORT_NAME = "INSTALLATION_COMPATIBILITY.md";
const DOC_PATHS = new Set([GUIDE_NAME, REPORT_NAME]);
const SOURCE_VERSION = "0.6.7";
const SOURCE_SHA256 = "0eec1a4ddf0e75b3b467b39e1300dacd053aa7b613b21e2a03f77217d5a37b95";

function validateVersion(version) {
  if (version !== SOURCE_VERSION) throw new Error(`Version must be ${SOURCE_VERSION}; this utility only repackages that published release.`);
  return version;
}

function validateRevision(revision) {
  if (!/^install-r[1-9]\d*$/.test(revision || "")) throw new Error("Revision must be install-r followed by a positive integer.");
  return revision;
}

function renderGuide(template, version) {
  validateVersion(version);
  if (!template.includes("{{VERSION}}")) throw new Error("Installation guide has no {{VERSION}} token.");
  const rendered = template.replaceAll("{{VERSION}}", version);
  if (/\{\{[^{}]+\}\}/.test(rendered)) throw new Error("Installation guide has unresolved template tokens.");
  return rendered;
}

function outputPaths(output, version, revision) {
  validateVersion(version);
  validateRevision(revision);
  const base = `File-Bridge-${version}-macOS-${revision}`;
  return {
    zip: path.join(output, base + ".zip"),
    dmg: path.join(output, base + ".dmg"),
    guide: path.join(output, `File-Bridge-${version}-macOS-Install-Guide.txt`),
    checksums: path.join(output, `SHA256SUMS-${version}-${revision}.txt`),
    verification: path.join(output, "verification.json")
  };
}

function assertNoExisting(paths) {
  for (const target of paths) {
    try {
      fs.lstatSync(target);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    throw new Error(`Output already exists; refusing to overwrite: ${target}`);
  }
}

function run(command, args, options = {}) {
  const env = { ...process.env, ...options.env };
  for (const name of ["UNZIP", "UNZIPOPT", "ZIPOPT"]) delete env[name];
  return execFileSync(command, args, { encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024, ...options, env });
}

function extractZip(source, destination) {
  run("/usr/bin/unzip", ["-b", "-q", source, "-d", destination]);
}

function sha256(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

// Only the exact published archive is trusted for extraction by this one-off tool.
function validateSource(filename, version) {
  validateVersion(version);
  if (!fs.statSync(filename).isFile()) throw new Error("Source must be a ZIP file.");
  const hash = sha256(filename);
  if (hash !== SOURCE_SHA256) throw new Error(`Source SHA256 mismatch; expected the published ${SOURCE_VERSION} ZIP (${SOURCE_SHA256}).`);
  return hash;
}

function assertManifestVersion(root, version) {
  validateVersion(version);
  const actual = run("/usr/bin/xmllint", ["--nonet", "--xpath", "string(/ExtensionManifest/@ExtensionBundleVersion)", path.join(root, "extension/CSXS/manifest.xml")]).trim();
  if (actual !== version) throw new Error(`Extension manifest version mismatch: expected ${version}, found ${actual || "no version"}.`);
  return actual;
}

function treeManifest(root, ignored = new Set()) {
  const result = {};
  function walk(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const entry = relative ? relative + "/" + name : name;
      if (ignored.has(entry)) continue;
      const filename = path.join(root, entry);
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Unsupported payload file: ${entry}`);
      result[entry] = { type: stat.isDirectory() ? "directory" : "file", mode: stat.mode & 0o7777 };
      if (stat.isDirectory()) walk(entry);
      else result[entry].sha256 = sha256(filename);
    }
  }
  walk("");
  return result;
}

function assertPayloadUnchanged(expected, actual) {
  try {
    assert.deepEqual(actual, expected);
  } catch {
    throw new Error("Payload integrity mismatch: file contents, paths, or permissions changed.");
  }
}

function publishFiles(pairs) {
  assertNoExisting(pairs.map(([, target]) => target));
  const created = [];
  try {
    for (const [source, target] of pairs) {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      created.push(target);
    }
  } catch (error) {
    for (const target of created) fs.unlinkSync(target);
    throw error;
  }
}

function repackageDocs({ source, output, version, revision, projectRoot = path.resolve(__dirname, "..") }) {
  if (!source || !output) throw new Error("Explicit --source ZIP and --output DIR are required.");
  source = path.resolve(source);
  output = path.resolve(output);
  const targets = outputPaths(output, version, revision);
  assertNoExisting(Object.values(targets));
  const sourceHash = validateSource(source, version);
  const guide = renderGuide(fs.readFileSync(path.join(projectRoot, "packaging/README-INTERNAL.txt"), "utf8"), version);
  const report = fs.readFileSync(path.join(projectRoot, "docs", REPORT_NAME));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "file-bridge-repack-"));
  const mount = path.join(temp, "mount");
  let mounted = false;
  function cleanup() {
    if (mounted) {
      try {
        run("/usr/bin/hdiutil", ["detach", mount]);
        mounted = false;
      } catch {
        console.error(`Could not detach ${mount}; retained temporary directory ${temp}.`);
      }
    }
    if (!mounted) fs.rmSync(temp, { recursive: true, force: true });
  }
  const onInterrupt = () => { cleanup(); process.exit(130); };
  const onTerminate = () => { cleanup(); process.exit(143); };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    const snapshot = path.join(temp, "source.zip");
    fs.copyFileSync(source, snapshot, fs.constants.COPYFILE_EXCL);
    validateSource(snapshot, version);
    const extracted = path.join(temp, "extracted");
    run("/usr/bin/unzip", ["-tq", snapshot]);
    extractZip(snapshot, extracted);
    const roots = fs.readdirSync(extracted, { withFileTypes: true });
    if (roots.length !== 1 || !roots[0].isDirectory()) throw new Error("Source ZIP must contain exactly one top-level directory.");
    const rootName = roots[0].name;
    const root = path.join(extracted, rootName);
    assertManifestVersion(root, version);
    const original = treeManifest(root, DOC_PATHS);
    if (original.extension?.type !== "directory" || !Object.keys(original).some(name => name.endsWith(".command")) ||
        original["extension-maintenance.zsh"]?.type !== "file" || !fs.statSync(path.join(root, GUIDE_NAME)).isFile()) {
      throw new Error("Source ZIP does not have the expected Mac release layout.");
    }
    fs.writeFileSync(path.join(root, GUIDE_NAME), guide);
    fs.writeFileSync(path.join(root, REPORT_NAME), report);
    assertPayloadUnchanged(original, treeManifest(root, DOC_PATHS));
    const complete = treeManifest(root);
    const staged = outputPaths(temp, version, revision);
    run("/usr/bin/zip", ["-r", "-X", staged.zip, rootName], { cwd: extracted, env: { ...process.env, COPYFILE_DISABLE: "1" } });
    run("/usr/bin/unzip", ["-tq", staged.zip]);
    const verifiedZip = path.join(temp, "verified-zip");
    extractZip(staged.zip, verifiedZip);
    assertPayloadUnchanged(complete, treeManifest(path.join(verifiedZip, rootName)));
    run("/usr/bin/hdiutil", ["create", "-volname", rootName, "-srcfolder", root, "-format", "UDZO", staged.dmg]);
    run("/usr/bin/hdiutil", ["verify", staged.dmg]);
    fs.mkdirSync(mount);
    mounted = true;
    run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, staged.dmg]);
    const disk = treeManifest(mount, new Set([".DS_Store", ".fseventsd", ".Trashes", ".Spotlight-V100"]));
    assertPayloadUnchanged(complete, disk);
    run("/usr/bin/hdiutil", ["detach", mount]);
    mounted = false;
    fs.writeFileSync(staged.guide, guide, { flag: "wx" });
    const verification = {
      version, revision,
      source: { filename: path.basename(source), sha256: sourceHash, manifestVersion: version },
      payload: {
        files: Object.values(original).filter(entry => entry.type === "file").length,
        directories: Object.values(original).filter(entry => entry.type === "directory").length,
        contentsAndPermissionsUnchanged: true,
        updatedDocuments: [...DOC_PATHS]
      },
      zip: { filename: path.basename(staged.zip), sha256: sha256(staged.zip), integrityCheck: "passed", contentsAndPermissionsMatch: true },
      dmg: { filename: path.basename(staged.dmg), sha256: sha256(staged.dmg), integrityCheck: "passed", contentsAndPermissionsMatch: true },
      installerTest: { status: "not-run", note: "Installer validation is performed separately from this documentation repack utility." }
    };
    fs.writeFileSync(staged.verification, JSON.stringify(verification, null, 2) + "\n", { flag: "wx" });
    fs.writeFileSync(staged.checksums, [staged.zip, staged.dmg, staged.guide, staged.verification].map(filename => `${sha256(filename)}  ${path.basename(filename)}\n`).join(""), { flag: "wx" });
    if (sha256(source) !== sourceHash) throw new Error("Source ZIP changed during repackaging.");
    fs.mkdirSync(output, { recursive: true });
    publishFiles(Object.keys(targets).map(key => [staged[key], targets[key]]));
    return targets;
  } finally {
    cleanup();
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].replace(/^--/, "");
    if (!["source", "output", "version", "revision"].includes(key) || !args[index].startsWith("--") ||
        !args[index + 1] || options[key]) throw new Error("Use --source ZIP --output DIR --version 0.6.7 --revision install-r2.");
    options[key] = args[index + 1];
  }
  return options;
}

if (require.main === module) {
  try {
    const result = repackageDocs(parseArgs(process.argv.slice(2)));
    console.log(Object.values(result).join("\n"));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { GUIDE_NAME, REPORT_NAME, SOURCE_VERSION, SOURCE_SHA256, renderGuide, validateRevision, validateSource, assertManifestVersion, outputPaths, assertNoExisting, extractZip, treeManifest, assertPayloadUnchanged, publishFiles, repackageDocs, parseArgs };
