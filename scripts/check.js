const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const extensionRoot = path.join(projectRoot, "extension");
const mainPath = path.join(extensionRoot, "js", "main.js");
const libraryPath = path.join(extensionRoot, "js", "library.js");
const mediaToolsPath = path.join(extensionRoot, "js", "media-tools.js");
const lutToolsPath = path.join(extensionRoot, "js", "lut-tools.js");
const timecodePath = path.join(extensionRoot, "js", "timecode.js");
const stateStorePath = path.join(extensionRoot, "js", "state-store.js");
const fileOpsPath = path.join(extensionRoot, "js", "file-ops.js");
const hostPath = path.join(extensionRoot, "jsx", "host.jsx");
const manifestPath = path.join(extensionRoot, "CSXS", "manifest.xml");
const debugPath = path.join(extensionRoot, ".debug");

for (const sourcePath of [mainPath, libraryPath, mediaToolsPath, lutToolsPath, timecodePath, stateStorePath, fileOpsPath, hostPath]) {
  const source = fs.readFileSync(sourcePath, "utf8");
  new vm.Script(source, { filename: sourcePath });
}

childProcess.execFileSync("/usr/bin/xmllint", ["--noout", manifestPath]);
childProcess.execFileSync("/usr/bin/xmllint", ["--noout", debugPath]);

const manifest = fs.readFileSync(manifestPath, "utf8");
assert.match(manifest, /Host Name="PPRO"/);
assert.match(manifest, /Host Name="AEFT"/);
assert.match(manifest, /RequiredRuntime Name="CSXS" Version="12\.0"/);
assert.match(manifest, /ExtensionBundleName="Rove"/);

const mainSource = fs.readFileSync(mainPath, "utf8");
const mediaToolsSource = fs.readFileSync(mediaToolsPath, "utf8");
const stateStoreSource = fs.readFileSync(stateStorePath, "utf8");
const fileOpsSource = fs.readFileSync(fileOpsPath, "utf8");
assert.equal(/\b(unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|truncate|truncateSync)\b/.test(mainSource), false, "Source file actions must never permanently delete or truncate media");
assert.equal(/\b(unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|truncate|truncateSync)\b/.test(fileOpsSource), false, "File operations must never permanently delete or truncate media");
assert.match(fileOpsSource, /trashItemAtURLResultingItemURLError/, "Trash must use the recoverable Foundation API");
assert.match(mainSource, /fileOps\.validateSource\(asset, state\.roots\)/, "Rename/trash must revalidate the selected source");
assert.match(mainSource, /com\.adobe\.cep\.dnd\.file\.0/, "Premiere CEP drag payload must be present");
assert.match(mainSource, /state\.hostId !== "PPRO"/, "Dragging must be disabled outside Premiere");
assert.match(mainSource, /scanLibraryAsync/, "CEP must use the asynchronous SMB scanner");
assert.match(mainSource, /previewProxyFor/, "The viewer must support compatibility proxies");
assert.match(mainSource, /audioProxyFor/, "The viewer must prepare an audio-only drag proxy");
assert.match(mainSource, /captureFrameForProject/, "The viewer must create persistent project screenshots");
assert.match(fs.readFileSync(lutToolsPath, "utf8"), /LUT_3D_SIZE/, "The LUT parser must support .cube 3D LUTs");
assert.match(mediaToolsSource, /MAX_FFMPEG_CONCURRENCY/, "Media jobs must have a global per-panel concurrency limit");
assert.match(mediaToolsSource, /cancelViewerJobs/, "Closing the viewer must be able to cancel preview transcodes");
assert.match(stateStoreSource, /\.state-write-lock/, "Cross-host local metadata writes must be serialized");
assert.match(fs.readFileSync(timecodePath, "utf8"), /isDropFrame/, "SMPTE drop-frame timecode support must be present");

const library = require(libraryPath);
const configuredRoot = "/Volumes/团队文件-剪辑共享/0813-MIniMax";
if (fs.existsSync(configuredRoot)) {
  const scan = library.scanLibrary(configuredRoot, { fs, path }, { maxFiles: 2500, maxDepth: 8 });
  assert.equal(scan.offline, false, "Configured SMB test directory must be mounted");
  assert.ok(scan.assets.length > 0, "Configured SMB test directory should contain supported media");
  console.log(`Static checks passed. SMB scan found ${scan.assets.length} supported assets; no permanent-delete path exists.`);
} else {
  console.log("Static checks passed. SMB integration scan skipped because the test share is not mounted.");
}
