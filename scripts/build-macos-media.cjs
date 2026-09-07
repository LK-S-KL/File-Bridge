#!/usr/bin/env node
"use strict";

// Build GPL FFmpeg subprocess tools without redistributing Homebrew libraries.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.resolve(process.env.MEDIA_BUILD_OUTPUT || path.join(ROOT, "build", "macos-media"));
const SOURCES = path.join(OUTPUT, "sources");
const LEGAL = path.join(OUTPUT, "legal");
const LOGS = path.join(OUTPUT, "logs");
const JOBS = Number(process.env.MEDIA_BUILD_JOBS || 6);
const MIN_MACOS = "12.0";
const FFMPEG_VERSION = "8.0.3";
const X264_COMMIT = "0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee";
const SIGNING_FINGERPRINT = "FCF986EA15E6E293A5644F10B4322F04D67658D8";
const sourceSpecs = [
  { name: "ffmpeg", version: FFMPEG_VERSION, file: `ffmpeg-${FFMPEG_VERSION}.tar.xz`, url: `https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz`, sha256: "6136812ea6d4e68bdba27e33c2a94382711cdf4f8602ffef056ff792bd6f9818", license: "GPL-2.0-or-later" },
  { name: "x264", commit: X264_COMMIT, file: `x264-${X264_COMMIT}.tar.gz`, repository: "https://code.videolan.org/videolan/x264.git", sha256: "91c2f4bae6f8a33eceea90851f20298067a64fc3901f449aa4a74f5f52f13036", license: "GPL-2.0-or-later" },
  { name: "pkgconf", version: "2.3.0", file: "pkgconf-2.3.0.tar.xz", url: "https://distfiles.ariadne.space/pkgconf/pkgconf-2.3.0.tar.xz", sha256: "3a9080ac51d03615e7c1910a0a2a8df08424892b5f13b0628a204d3fcce0ea8b", license: "ISC", buildOnly: true }
];

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options }).trim();
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function logRun(command, args, cwd, logFile, extraEnv = {}) {
  fs.appendFileSync(logFile, `\n$ ${command} ${args.map(arg => JSON.stringify(arg)).join(" ")}\n`);
  const fd = fs.openSync(logFile, "a");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", fd, fd] });
    child.on("error", error => { fs.closeSync(fd); reject(error); });
    child.on("exit", code => {
      fs.closeSync(fd);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}; see ${logFile}`));
    });
  });
}

function download(url, destination) {
  if (!fs.existsSync(destination)) run("curl", ["--fail", "--location", "--retry", "3", "--output", destination, url]);
}

function extract(archive, destination) {
  fs.mkdirSync(destination, { recursive: true });
  run("tar", ["-xf", archive, "-C", destination]);
}

function copyLicense(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function verifyBinary(file, expectedArchitecture) {
  const architecture = run("lipo", ["-archs", file]);
  if (architecture !== expectedArchitecture) throw new Error(`Wrong architecture for ${file}: ${architecture}`);
  const dependencies = run("otool", ["-L", file]).split("\n").slice(1).map(line => line.trim().split(" (compatibility")[0]);
  const unexpected = dependencies.filter(value => !value.startsWith("/System/Library/") && !value.startsWith("/usr/lib/"));
  if (unexpected.length) throw new Error(`Non-system dependencies in ${file}: ${unexpected.join(", ")}`);
  const loadCommands = run("otool", ["-l", file]);
  const minimum = loadCommands.match(/\bminos\s+(\S+)/);
  if (!minimum || minimum[1] !== MIN_MACOS) throw new Error(`Unexpected deployment target in ${file}`);
  run("codesign", ["--verify", "--strict", file]);
  return { path: path.relative(OUTPUT, file), sha256: sha256(file), bytes: fs.statSync(file).size, architecture, minimumMacOS: minimum[1], dependencies, signing: "ad-hoc" };
}

function smokeTest(target, architecture) {
  const prefix = architecture === "x86_64" && os.arch() === "arm64" ? ["-x86_64"] : [];
  const output = path.join(OUTPUT, "verification", target);
  fs.mkdirSync(output, { recursive: true });
  const ffmpeg = path.join(OUTPUT, target, "ffmpeg");
  const ffprobe = path.join(OUTPUT, target, "ffprobe");
  const invoke = (binary, args) => prefix.length ? run("arch", [...prefix, binary, ...args]) : run(binary, args);
  try { invoke(ffmpeg, ["-version"]); } catch (error) {
    if (prefix.length) return { status: "not-run", reason: "Intel executable could not run through Rosetta on this host", error: error.message };
    throw error;
  }
  const mp4 = path.join(output, "x264-aac.mp4");
  const jpeg = path.join(output, "poster.jpg");
  const waveform = path.join(output, "waveform.png");
  const sprite = path.join(output, "sprite.jpg");
  invoke(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-y", mp4]);
  const probe = JSON.parse(invoke(ffprobe, ["-v", "error", "-show_format", "-show_streams", "-of", "json", mp4]));
  if (!probe.streams.some(stream => stream.codec_name === "h264") || !probe.streams.some(stream => stream.codec_name === "aac")) throw new Error("H.264/AAC smoke probe failed");
  invoke(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", mp4, "-vf", "trim=end_frame=1,scale=160:-2,format=yuv420p,signalstats,metadata=select:key=lavfi.signalstats.YAVG:value=20:function=greater", "-frames:v", "1", "-y", jpeg]);
  invoke(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", mp4, "-filter_complex", "[0:a:0]aformat=channel_layouts=mono,showwavespic=s=600x120:colors=0x62d684:scale=sqrt:draw=full[wave]", "-map", "[wave]", "-frames:v", "1", "-an", "-sn", "-dn", "-y", waveform]);
  invoke(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", mp4, "-filter_complex", "[0:v]scale=160:90,split=2[a][b];[a][b]xstack=inputs=2:layout=0_0|160_0:fill=black,format=yuvj420p[sheet]", "-map", "[sheet]", "-frames:v", "1", "-y", sprite]);
  for (const file of [mp4, jpeg, waveform, sprite]) if (fs.statSync(file).size < 100) throw new Error(`Empty smoke output ${file}`);
  const filters = invoke(ffmpeg, ["-hide_banner", "-filters"]);
  const decoders = invoke(ffmpeg, ["-hide_banner", "-decoders"]);
  const encoders = invoke(ffmpeg, ["-hide_banner", "-encoders"]);
  for (const filter of ["xstack", "showwavespic", "scale", "signalstats", "metadata"]) if (!new RegExp(`\\b${filter}\\b`).test(filters)) throw new Error(`Missing filter ${filter}`);
  for (const decoder of ["h264", "hevc", "aac", "mjpeg", "png"]) if (!new RegExp(`\\b${decoder}\\b`).test(decoders)) throw new Error(`Missing decoder ${decoder}`);
  for (const encoder of ["libx264", "h264_videotoolbox", "aac", "mjpeg", "png"]) if (!new RegExp(`\\b${encoder}\\b`).test(encoders)) throw new Error(`Missing encoder ${encoder}`);
  fs.writeFileSync(path.join(output, "probe.json"), JSON.stringify(probe, null, 2) + "\n");
  return { status: "passed", execution: prefix.length ? "Rosetta 2" : "native", checks: ["libx264 + AAC MP4", "ffprobe JSON", "JPEG poster + signalstats + metadata", "PNG waveform", "xstack sprite", "required filters/decoders/encoders"], output: path.relative(OUTPUT, output) };
}

async function main() {
  if (process.platform !== "darwin") throw new Error("This build requires macOS and Apple Command Line Tools.");
  if (!Number.isInteger(JOBS) || JOBS < 1 || JOBS > 32) throw new Error("MEDIA_BUILD_JOBS must be 1-32 (per architecture).");
  for (const directory of [SOURCES, LEGAL, LOGS]) fs.mkdirSync(directory, { recursive: true });
  const work = process.env.MEDIA_BUILD_WORK_DIR ? path.resolve(process.env.MEDIA_BUILD_WORK_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), "file-bridge-media-"));
  if (!path.basename(work).startsWith("file-bridge-media-") || !fs.statSync(work).isDirectory()) throw new Error("MEDIA_BUILD_WORK_DIR must identify a previous file-bridge-media-* build directory.");
  // Keep the bounded build directory for diagnosis; do not remove other builds.
  console.log(`Build directory: ${work}`);
  const sdk = run("xcrun", ["--sdk", "macosx", "--show-sdk-path"]);
  const cc = run("xcrun", ["--find", "clang"]);
  for (const source of sourceSpecs) {
    const archive = path.join(SOURCES, source.file);
    if (source.repository && !fs.existsSync(archive)) {
      const checkout = path.join(work, "x264-download");
      run("git", ["clone", "--no-checkout", "--depth", "1", source.repository, checkout]);
      run("git", ["-C", checkout, "fetch", "--depth", "1", "origin", source.commit]);
      run("git", ["-C", checkout, "archive", "--format=tar.gz", `--prefix=x264-${source.commit}/`, `--output=${archive}`, source.commit]);
    } else if (source.url) download(source.url, archive);
    if (sha256(archive) !== source.sha256) throw new Error(`Source SHA-256 mismatch: ${source.file}`);
  }
  download(`https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz.asc`, path.join(SOURCES, `ffmpeg-${FFMPEG_VERSION}.tar.xz.asc`));
  download("https://ffmpeg.org/ffmpeg-devel.asc", path.join(SOURCES, "ffmpeg-devel.asc"));
  const gpgHome = path.join(work, "gpg");
  fs.mkdirSync(gpgHome, { mode: 0o700, recursive: true });
  const fingerprint = run("gpg", ["--homedir", gpgHome, "--batch", "--with-colons", "--import-options", "show-only", "--import", path.join(SOURCES, "ffmpeg-devel.asc")]).split("\n").find(line => line.startsWith("fpr:"));
  if (!fingerprint || fingerprint.split(":")[9] !== SIGNING_FINGERPRINT) throw new Error("FFmpeg signing-key fingerprint mismatch");
  run("gpg", ["--homedir", gpgHome, "--batch", "--import", path.join(SOURCES, "ffmpeg-devel.asc")]);
  const signature = run("gpg", ["--homedir", gpgHome, "--batch", "--status-fd", "1", "--verify", path.join(SOURCES, `ffmpeg-${FFMPEG_VERSION}.tar.xz.asc`), path.join(SOURCES, `ffmpeg-${FFMPEG_VERSION}.tar.xz`)]);
  if (!signature.includes(`VALIDSIG ${SIGNING_FINGERPRINT}`)) throw new Error("FFmpeg release signature did not validate");
  fs.writeFileSync(path.join(LEGAL, "ffmpeg-signature-verification.txt"), signature + "\n");
  console.log("Pinned source hashes and official FFmpeg PGP signature verified.");

  const pkgSource = path.join(work, "pkgconf-2.3.0");
  if (!fs.existsSync(pkgSource)) extract(path.join(SOURCES, "pkgconf-2.3.0.tar.xz"), work);
  const pkgPrefix = path.join(work, "build-tools");
  const pkgLog = path.join(LOGS, "pkgconf.log");
  const pkgEnv = { CC: cc, SDKROOT: sdk, CFLAGS: `-isysroot ${sdk}`, LDFLAGS: `-isysroot ${sdk}` };
  const pkgconfig = path.join(pkgPrefix, "bin", "pkgconf");
  if (!fs.existsSync(pkgconfig)) {
    await logRun("./configure", [`--prefix=${pkgPrefix}`, "--disable-shared", "--enable-static", "--disable-dependency-tracking"], pkgSource, pkgLog, pkgEnv);
    await logRun("make", [`-j${JOBS}`, "install"], pkgSource, pkgLog, pkgEnv);
  }
  copyLicense(path.join(pkgSource, "COPYING"), path.join(LEGAL, "pkgconf-COPYING"));

  const buildResults = await Promise.allSettled([
    { target: "darwin-arm64", architecture: "arm64", ffArch: "aarch64", host: "aarch64-apple-darwin" },
    { target: "darwin-x64", architecture: "x86_64", ffArch: "x86_64", host: "x86_64-apple-darwin" }
  ].map(async architecture => {
    const { target, host, ffArch } = architecture;
    const archRoot = path.join(work, target);
    const prefix = path.join(archRoot, "prefix");
    const targetDir = path.join(OUTPUT, target);
    const logFile = path.join(LOGS, `${target}.log`);
    const configDir = path.join(LEGAL, target);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    const x264 = path.join(archRoot, `x264-${X264_COMMIT}`);
    const ffmpeg = path.join(archRoot, `ffmpeg-${FFMPEG_VERSION}`);
    if (!fs.existsSync(x264)) extract(path.join(SOURCES, sourceSpecs[1].file), archRoot);
    if (!fs.existsSync(ffmpeg)) extract(path.join(SOURCES, sourceSpecs[0].file), archRoot);
    const flags = `-arch ${architecture.architecture} -isysroot ${sdk} -mmacosx-version-min=${MIN_MACOS}`;
    const env = { CC: cc, MACOSX_DEPLOYMENT_TARGET: MIN_MACOS, PKG_CONFIG: pkgconfig, PKG_CONFIG_LIBDIR: path.join(prefix, "lib", "pkgconfig"), PKG_CONFIG_PATH: "" };
    const x264Args = [`--prefix=${prefix}`, `--host=${host}`, `--sysroot=${sdk}`, "--enable-static", "--enable-pic", "--disable-cli", "--disable-opencl", "--disable-avs", "--disable-swscale", "--disable-lavf", "--disable-ffms", "--disable-gpac", "--disable-lsmash", `--extra-cflags=${flags}`, `--extra-ldflags=${flags}`, `--extra-asflags=${flags}`];
    if (architecture.architecture === "x86_64") x264Args.push("--disable-asm");
    console.log(`${target}: building static x264`);
    if (!fs.existsSync(path.join(prefix, "lib", "libx264.a"))) {
      await logRun("./configure", x264Args, x264, logFile, env);
      await logRun("make", [`-j${JOBS}`, "install-lib-static"], x264, logFile, env);
    }
    copyLicense(path.join(x264, "config.mak"), path.join(configDir, "x264-config.mak"));
    copyLicense(path.join(x264, "config.h"), path.join(configDir, "x264-config.h"));
    copyLicense(path.join(x264, "COPYING"), path.join(configDir, "x264-COPYING"));
    const ffmpegArgs = [`--prefix=${prefix}`, "--target-os=darwin", `--arch=${ffArch}`, "--enable-cross-compile", `--cc=${cc}`, `--sysroot=${sdk}`, `--pkg-config=${pkgconfig}`, "--pkg-config-flags=--static", "--disable-autodetect", "--disable-shared", "--enable-static", "--disable-debug", "--disable-doc", "--disable-ffplay", "--disable-network", "--disable-indevs", "--enable-indev=lavfi", "--disable-outdevs", "--enable-gpl", "--enable-libx264", "--enable-zlib", "--enable-videotoolbox", "--enable-audiotoolbox", "--enable-pthreads", `--extra-cflags=${flags}`, `--extra-ldflags=${flags}`];
    if (architecture.architecture === "x86_64") ffmpegArgs.push("--disable-x86asm");
    console.log(`${target}: configuring FFmpeg`);
    await logRun("./configure", ffmpegArgs, ffmpeg, logFile, env);
    console.log(`${target}: compiling FFmpeg and ffprobe`);
    await logRun("make", [`-j${JOBS}`, "ffmpeg", "ffprobe"], ffmpeg, logFile, env);
    for (const file of ["config.h", "config_components.h", "ffbuild/config.mak"]) copyLicense(path.join(ffmpeg, file), path.join(configDir, `ffmpeg-${path.basename(file)}`));
    for (const file of ["COPYING.GPLv2", "COPYING.GPLv3", "COPYING.LGPLv2.1", "COPYING.LGPLv3", "LICENSE.md"]) copyLicense(path.join(ffmpeg, file), path.join(configDir, file));
    fs.writeFileSync(path.join(configDir, "configure-arguments.json"), JSON.stringify({ x264: x264Args, ffmpeg: ffmpegArgs, environment: env }, null, 2) + "\n");
    const binaries = {};
    for (const name of ["ffmpeg", "ffprobe"]) {
      const binary = path.join(targetDir, name);
      fs.copyFileSync(path.join(ffmpeg, name), binary);
      fs.chmodSync(binary, 0o755);
      run("strip", ["-x", binary]);
      run("codesign", ["--force", "--sign", "-", "--timestamp=none", binary]);
      binaries[name] = verifyBinary(binary, architecture.architecture);
    }
    const smoke = smokeTest(target, architecture.architecture);
    console.log(`${target}: verification ${smoke.status}`);
    return { ...architecture, binaries, smoke };
  }));
  const failures = buildResults.filter(result => result.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), "One or more architecture builds failed");
  fs.copyFileSync(__filename, path.join(LEGAL, "build-macos-media.cjs"));
  fs.writeFileSync(path.join(LEGAL, "README.txt"), [
    "File Bridge macOS media tools", "",
    "FFmpeg and ffprobe are independent subprocess executables built from FFmpeg 8.0.3 and statically linked x264.",
    "These executables are GPL-2.0-or-later. No --enable-nonfree or --enable-version3 configuration is used.",
    "Copyright belongs to the respective FFmpeg, x264 and pkgconf contributors; see the included license files and full source archives.",
    "The sibling sources directory contains the complete unmodified corresponding FFmpeg and x264 source archives.",
    "It also includes the native pkgconf build-tool source, FFmpeg detached release signature and official public key.",
    "The copied build-macos-media.cjs and per-architecture configure files describe how these executables were built.",
    "To rebuild, place this script in a scripts directory and copy the supplied sources into build/macos-media/sources, then run node scripts/build-macos-media.cjs on macOS with Apple Command Line Tools and GnuPG installed.",
    "MEDIA_BUILD_OUTPUT can override that output/source directory and MEDIA_BUILD_JOBS sets parallel jobs per architecture (default 6).",
    "Distribution must keep the corresponding source archives, license notices and build instructions with the executables.",
    "System frameworks and libSystem/libz are provided by macOS and are not copied into this distribution.",
    "The executables are ad-hoc signed for local integrity. They are not Developer ID signed or notarized.",
    "Intel assembly is disabled to avoid an unbundled NASM build dependency; Intel software encoding may be slower.", ""
  ].join("\n"));
  const manifest = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), ffmpegVersion: FFMPEG_VERSION,
    license: "GPL-2.0-or-later", minimumMacOS: MIN_MACOS,
    sourceSignature: { fingerprint: SIGNING_FINGERPRINT, officialFingerprintUrl: "https://ffmpeg.org/download.html", status: "verified" },
    sources: sourceSpecs.map(source => ({ ...source, path: `sources/${source.file}` })),
    build: { script: "legal/build-macos-media.cjs", compiler: run(cc, ["--version"]), sdk: run("xcrun", ["--sdk", "macosx", "--show-sdk-version"]), jobsPerArchitecture: JOBS, isolatedBuildDirectory: work },
    architectures: Object.fromEntries(buildResults.map(result => [result.value.target, result.value])),
    distributionDirectories: ["darwin-arm64", "darwin-x64", "legal", "sources"]
  };
  fs.writeFileSync(path.join(OUTPUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Complete: ${path.join(OUTPUT, "manifest.json")}`);
}

main().catch(error => { console.error(error); if (error.errors) for (const cause of error.errors) console.error(cause); process.exitCode = 1; });
