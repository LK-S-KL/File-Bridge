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
const assetOpsPath = path.join(extensionRoot, "js", "asset-ops.js");
const projectPackagerPath = path.join(extensionRoot, "js", "project-packager.js");
const interactionToolsPath = path.join(extensionRoot, "js", "interaction-tools.js");
const pluginFolderOpsPath = path.join(extensionRoot, "js", "plugin-folder-ops.js");
const hostPath = path.join(extensionRoot, "jsx", "host.jsx");
const manifestPath = path.join(extensionRoot, "CSXS", "manifest.xml");
const debugPath = path.join(extensionRoot, ".debug");

for (const sourcePath of [mainPath, libraryPath, mediaToolsPath, lutToolsPath, timecodePath, stateStorePath, fileOpsPath, assetOpsPath, projectPackagerPath, interactionToolsPath, pluginFolderOpsPath, hostPath]) {
  const source = fs.readFileSync(sourcePath, "utf8");
  new vm.Script(source, { filename: sourcePath });
}

childProcess.execFileSync("/usr/bin/xmllint", ["--noout", manifestPath]);
childProcess.execFileSync("/usr/bin/xmllint", ["--noout", debugPath]);

const manifest = fs.readFileSync(manifestPath, "utf8");
const indexSource = fs.readFileSync(path.join(extensionRoot, "index.html"), "utf8");
const panelCssSource = fs.readFileSync(path.join(extensionRoot, "css", "panel.css"), "utf8");
assert.match(manifest, /Host Name="PPRO"/);
assert.match(manifest, /Host Name="AEFT"/);
assert.match(manifest, /RequiredRuntime Name="CSXS" Version="12\.0"/);
assert.match(manifest, /ExtensionBundleName="LK‘s File Bridge"/);

const mainSource = fs.readFileSync(mainPath, "utf8");
const mediaToolsSource = fs.readFileSync(mediaToolsPath, "utf8");
const stateStoreSource = fs.readFileSync(stateStorePath, "utf8");
const fileOpsSource = fs.readFileSync(fileOpsPath, "utf8");
const assetOpsSource = fs.readFileSync(assetOpsPath, "utf8");
const projectPackagerSource = fs.readFileSync(projectPackagerPath, "utf8");
const hostSource = fs.readFileSync(hostPath, "utf8");
const pluginFolderOpsSource = fs.readFileSync(pluginFolderOpsPath, "utf8");
assert.equal(/\b(unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|truncate|truncateSync)\b/.test(mainSource), false, "Source file actions must never permanently delete or truncate media");
assert.equal(/\b(unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|truncate|truncateSync)\b/.test(fileOpsSource), false, "File operations must never permanently delete or truncate media");
assert.match(fileOpsSource, /trashItemAtURLResultingItemURLError/, "Trash must use the recoverable Foundation API");
assert.match(mainSource, /fileOps\.validateSource\(asset, state\.roots\)/, "Rename/trash must revalidate the selected source");
assert.match(fs.readFileSync(interactionToolsPath, "utf8"), /com\.adobe\.cep\.dnd\.file\./, "Premiere CEP drag payload must be present");
assert.match(mainSource, /state\.hostId !== "PPRO"/, "Dragging must be disabled outside Premiere");
assert.match(mainSource, /scanLibraryAsync/, "CEP must use the asynchronous SMB scanner");
assert.match(mainSource, /previewProxyFor/, "The viewer must support compatibility proxies");
assert.match(mainSource, /audioProxyFor/, "The viewer must prepare an audio-only drag proxy");
assert.match(mainSource, /captureFrameForProject/, "The viewer must create persistent project screenshots");
assert.match(mainSource, /directImport: true/, "Project screenshots must import as standalone project files");
assert.match(mainSource, /selectionMode/, "Selection must enter an explicit check mode instead of selecting everything immediately");
assert.match(mainSource, /pluginFolders/, "Plugin-owned folders must be persisted independently of local folders");
assert.doesNotMatch(mainSource, /MAX_RENDERED_ASSETS/, "Search results must not stop at a fixed rendered-item cap");
assert.match(mainSource, /includeDirectories:\s*false/, "Local filesystem folders must not become library cards");
assert.match(mainSource, /media\.controls = false/, "The viewer must use one custom timeline instead of native duplicate controls");
assert.doesNotMatch(indexSource, /scanModeSelect|本次浏览范围/, "Root selection must use direct checkboxes without a separate scan mode");
assert.match(indexSource, /data-quality="auto"/, "The player quality menu must include Auto");
assert.match(indexSource, /data-quality="480"/, "The player quality menu must include 480p");
assert.match(indexSource, /data-command="play">打开/, "Open must remain the first file context action");
assert.match(panelCssSource, /V4_FINAL_CASCADE/, "The narrow-panel layout constraints must remain last in the stylesheet");
assert.match(fs.readFileSync(lutToolsPath, "utf8"), /LUT_3D_SIZE/, "The LUT parser must support .cube 3D LUTs");
assert.match(mediaToolsSource, /MAX_FFMPEG_CONCURRENCY/, "Media jobs must have a global per-panel concurrency limit");
assert.match(mediaToolsSource, /cancelViewerJobs/, "Closing the viewer must be able to cancel preview transcodes");
assert.match(mediaToolsSource, /MPEG-4 \/ MP4/, "MP4 metadata must not inherit the QuickTime/MOV long name");
assert.match(mediaToolsSource, /_Screenshot_/, "Project screenshots must use the stable source-name convention");
assert.match(stateStoreSource, /\.state-write-lock/, "Cross-host local metadata writes must be serialized");
assert.match(stateStoreSource, /pluginRootAssetKeys/, "Plugin root virtual placements must be persisted");
assert.match(pluginFolderOpsSource, /function paste\(/, "Virtual plugin-folder clipboard must support paste");
assert.match(mainSource, /pluginFolderOps\.makeClipboard/, "The panel must connect virtual clipboard operations");
assert.match(mainSource, /LUT_SAMPLE_SOURCE/, "The LUT preview must use the bundled reference image");
assert.match(fs.readFileSync(timecodePath, "utf8"), /isDropFrame/, "SMPTE drop-frame timecode support must be present");
assert.match(hostSource, /listUsedPremiereMedia/, "The host must expose the used-timeline-media inventory API");
assert.match(hostSource, /sequence\.videoTracks/, "Project packaging must inspect Premiere video tracks");
assert.match(hostSource, /sequence\.audioTracks/, "Project packaging must inspect Premiere audio tracks");
assert.match(hostSource, /payload\.position === "start"/, "Premiere insertion must support the first frame");
assert.match(hostSource, /payload\.position === "end"/, "Premiere insertion must support the sequence tail");
assert.match(hostSource, /captureRoots/, "Premiere packaging must accept explicitly opted-in plugin screenshot roots");
assert.match(hostSource, /directToProject/, "Plugin screenshots must be importable at the Premiere project root");
assert.match(hostSource, /applyLutToActiveVideo/, "Premiere host must expose guarded LUT application");
assert.match(projectPackagerSource, /function copyWithProgress/, "Project packaging must copy from the host-provided media inventory");
assert.match(projectPackagerSource, /function flatName/, "Project packaging must avoid recreating long source folder paths by default");
assert.match(projectPackagerSource, /OUT_OF_SCOPE/, "Project packaging must reject media outside configured roots");
assert.doesNotMatch(projectPackagerSource, /readdir|opendir/, "Project packaging must never scan unrelated files from configured roots");
assert.match(assetOpsSource, /COPYFILE_EXCL/, "External imports and copies must never overwrite existing media");
assert.match(assetOpsSource, /trashItemAtURLResultingItemURLError/, "Folder and batch deletion must use the recoverable Trash API");

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
