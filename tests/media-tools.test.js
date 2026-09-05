const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const mediaTools = require("../extension/js/media-tools.js");

function fixtureStat() {
  return {
    size: 111562500,
    mtime: new Date("2026-09-05T08:00:00.000Z"),
    mtimeMs: Date.parse("2026-09-05T08:00:00.000Z")
  };
}

function fileDigest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("normalizes the requested technical metadata from ffprobe JSON", () => {
  const raw = {
    streams: [
      {
        index: 0,
        codec_type: "video",
        codec_name: "hevc",
        codec_long_name: "H.265 / HEVC",
        codec_tag_string: "hvc1",
        profile: "Main 10",
        level: 153,
        pix_fmt: "yuv420p10le",
        width: 3840,
        height: 2160,
        avg_frame_rate: "30000/1001",
        r_frame_rate: "30000/1001",
        bit_rate: "82000000",
        duration: "10.500000",
        color_space: "bt2020nc",
        color_primaries: "bt2020",
        color_transfer: "smpte2084",
        color_range: "tv",
        disposition: { default: 1 },
        tags: { creation_time: "2026-08-03T04:05:06.000000Z" }
      },
      {
        index: 1,
        codec_type: "audio",
        codec_name: "aac",
        codec_long_name: "AAC (Advanced Audio Coding)",
        profile: "LC",
        sample_fmt: "fltp",
        sample_rate: "48000",
        channels: 2,
        channel_layout: "stereo",
        bit_rate: "320000",
        duration: "10.496000",
        disposition: { default: 1 }
      }
    ],
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      format_long_name: "QuickTime / MOV",
      duration: "10.500000",
      bit_rate: "85000000",
      probe_score: 100,
      tags: { creation_time: "2026-08-03T04:05:06.000000Z" }
    }
  };

  const metadata = mediaTools.normalizeProbe(raw, fixtureStat());

  assert.equal(metadata.format, "QuickTime / MOV");
  assert.equal(metadata.formatShort, "mov,mp4,m4a,3gp,3g2,mj2");
  assert.equal(metadata.duration, 10.5);
  assert.equal(metadata.totalBitrate, 85000000);
  assert.equal(metadata.videoCodecShort, "hevc");
  assert.equal(metadata.videoProfile, "Main 10");
  assert.equal(metadata.pixelFormat, "yuv420p10le");
  assert.equal(metadata.resolution, "3840 × 2160");
  assert.ok(Math.abs(metadata.frameRate - 29.97002997) < 0.00001);
  assert.equal(metadata.audioCodecShort, "aac");
  assert.equal(metadata.audioChannels, "stereo");
  assert.equal(metadata.audioSampleRate, 48000);
  assert.equal(metadata.colorMatrix, "bt2020nc");
  assert.equal(metadata.dynamicRangeCode, "HDR10");
  assert.equal(metadata.alphaPresent, false);
  assert.equal(metadata.creationTime, "2026-08-03T04:05:06.000000Z");
});

test("infers HLG, Dolby Vision, and alpha as best-effort values", () => {
  const hlg = mediaTools.dynamicRangeInfo({
    color_transfer: "arib-std-b67",
    color_primaries: "bt2020",
    color_space: "bt2020nc"
  });
  const dolby = mediaTools.dynamicRangeInfo({
    codec_name: "hevc",
    side_data_list: [{ side_data_type: "DOVI configuration record", dv_profile: 8 }]
  });
  const alpha = mediaTools.alphaInfo({ codec_name: "prores", profile: "4444", pix_fmt: "yuva444p12le" });

  assert.equal(hlg.code, "HLG");
  assert.equal(dolby.code, "DOLBY_VISION");
  assert.equal(alpha.present, true);
});

test("does not turn unavailable numeric metadata into zero", () => {
  const raw = {
    streams: [{
      index: 0,
      codec_type: "video",
      codec_name: "png",
      pix_fmt: "rgba",
      width: 1600,
      height: 900,
      avg_frame_rate: "25/1"
    }],
    format: { format_name: "png_pipe", format_long_name: "piped png sequence" }
  };
  const metadata = mediaTools.normalizeProbe(raw, fixtureStat());
  assert.equal(metadata.duration, null);
  assert.equal(metadata.totalBitrate, null);
  assert.equal(metadata.alphaPresent, true);
});

test("maps pointer progress to the correct video sprite frame", () => {
  const sprite = {
    frameCount: 12,
    columns: 4,
    rows: 3,
    cellWidth: 240,
    cellHeight: 136,
    width: 960,
    height: 408,
    sampleTimes: Array.from({ length: 12 }, (_, index) => index + 0.5)
  };

  assert.deepEqual(mediaTools.spriteFrameAtProgress(sprite, 0), {
    index: 0,
    column: 0,
    row: 0,
    sampleTime: 0.5,
    backgroundPosition: "0px 0px",
    backgroundSize: "960px 408px"
  });
  assert.equal(mediaTools.spriteFrameAtProgress(sprite, 0.51).index, 6);
  assert.equal(mediaTools.spriteFrameAtProgress(sprite, 1).index, 11);
  assert.equal(mediaTools.spriteFrameAtProgress(sprite, 1).backgroundPosition, "-720px -272px");
});

test("probes media and creates a cached sprite and waveform without changing the source", async (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fnos-media-tools-"));
  const sourcePath = path.join(fixture, "source clip.mp4");
  const service = mediaTools.create({
    fs,
    path,
    os: { homedir: () => fixture },
    crypto,
    childProcess
  });
  const ffmpeg = service.findBinary("ffmpeg");
  const ffprobe = service.findBinary("ffprobe");

  if (!ffmpeg || !ffprobe) {
    fs.rmSync(fixture, { recursive: true, force: true });
    t.skip("ffmpeg and ffprobe are required for the integration test");
    return;
  }

  try {
    childProcess.execFileSync(ffmpeg, [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=duration=2:size=320x180:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=2",
      "-c:v", "mpeg4", "-q:v", "5",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest", "-y", sourcePath
    ], { timeout: 30000 });

    const before = fs.statSync(sourcePath);
    const beforeDigest = fileDigest(sourcePath);
    const metadata = await service.metadataFor(sourcePath);

    assert.equal(metadata.videoCodecShort, "mpeg4");
    assert.equal(metadata.audioCodecShort, "aac");
    assert.equal(metadata.resolution, "320 × 180");
    assert.ok(metadata.duration > 1.8 && metadata.duration <= 2.1);

    const sprite = await service.spriteFor(sourcePath);
    assert.equal(sprite.frameCount, 12);
    assert.equal(sprite.width, 960);
    assert.equal(sprite.height, 408);
    assert.equal(fs.existsSync(sprite.path), true);
    assert.ok(fs.statSync(sprite.path).size > 0);

    const cachedSprite = await service.spriteFor(sourcePath);
    assert.equal(cachedSprite.path, sprite.path);

    const waveformPath = await service.waveformFor(sourcePath);
    assert.equal(fs.existsSync(waveformPath), true);
    assert.ok(fs.statSync(waveformPath).size > 0);

    const spriteMetadata = await service.metadataFor(sprite.path);
    const waveformMetadata = await service.metadataFor(waveformPath);
    assert.equal(spriteMetadata.resolution, "960 × 408");
    assert.equal(waveformMetadata.resolution, "600 × 120");

    const after = fs.statSync(sourcePath);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(fileDigest(sourcePath), beforeDigest);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
