const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const resolver = path.resolve(__dirname, "../extension/js/resolve-media-tools.pl");
const encoders = ["libx264", "aac", "png"];
const decoders = ["h264", "hevc"];
const filters = ["scale", "pad", "format", "xstack", "showwavespic", "signalstats", "metadata", "trim", "tile"];

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lkfb-resolver space-")));
  const result = {
    directory,
    root: path.join(directory, "extension \u5a92\u4f53"),
    home: path.join(directory, "user home"),
    system: path.join(directory, "system tools"),
    log: path.join(directory, "calls.jsonl"),
    pids: path.join(directory, "pids.txt"),
    temporary: path.join(directory, "temporary")
  };
  for (const key of ["root", "home", "system", "temporary"]) fs.mkdirSync(result[key], { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return result;
}

function mockPair(directory, fixture, overrides = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const config = {
    log: fixture.log, pids: fixture.pids, versions: { ffmpeg: "8.0.3", ffprobe: "8.0.3" },
    encoders, decoders, filters, ...overrides
  };
  const script = `#!/usr/bin/perl
use strict;
use warnings;
use JSON::PP;
use Encode qw(decode);
use Time::HiRes qw(sleep);
my $config = do {
  open my $input, '<:raw', "$0.json" or die $!;
  local $/;
  JSON::PP->new->utf8->decode(<$input>);
};
my ($name) = $0 =~ m{([^/]+)$};
open my $log, '>>', $config->{log} or die $!;
print $log JSON::PP->new->utf8->encode({binary => decode('UTF-8', $0), args => [map { decode('UTF-8', $_) } @ARGV]}), "\\n";
close $log;
if ($config->{hang} && $ARGV[0] eq '-version') {
  $SIG{TERM} = 'IGNORE';
  open my $pids, '>>', $config->{pids} or die $!;
  print $pids "$$\\n";
  close $pids;
  if ($config->{descendant}) {
    my $child = fork();
    if (!$child) {
      open my $children, '>>', $config->{pids} or die $!;
      print $children "$$\\n";
      close $children;
      sleep 30 while 1;
    }
  }
  sleep 30 while 1;
}
if ($ARGV[0] eq '-version') { print "$name version $config->{versions}{$name} mock\\n"; exit 0; }
for my $kind ('encoders', 'decoders', 'filters') {
  if (grep { $_ eq "-$kind" } @ARGV) {
    my $flags = $kind eq 'filters' ? ($config->{filterFlags} || '..') : 'V.....';
    print " $flags $_ Mock capability\\n" for @{$config->{$kind}};
    print " V..... decoy libx264 is only a description\\n" if $config->{decoy};
    exit 0;
  }
}
if ($name eq 'ffprobe') {
  if ($config->{badProbe}) { print '{invalid'; exit 0; }
  print JSON::PP->new->encode({streams => [
    {codec_type => 'video', codec_name => 'h264', width => 64, height => 64},
    {codec_type => 'audio', codec_name => 'aac'}
  ], format => {duration => '0.2'}});
  exit 0;
}
exit 1 if $config->{failEncode};
my $output = $ARGV[-1];
die 'unexpected overwrite' if -e $output;
open my $file, '>:raw', $output or die $!;
if ($output =~ /\\.png$/) {
  print $file $config->{badPng} ? 'invalid png' : pack('H*', '89504e470d0a1a0a0000000d494844520000004000000040');
} else { print $file 'mock H264 AAC sample'; }
close $file;
`;
  for (const name of ["ffmpeg", "ffprobe"]) {
    fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(config));
    fs.writeFileSync(path.join(directory, name), script, { mode: 0o755 });
  }
  return directory;
}

function bundle(fixture, architecture = "arm64", overrides = {}) {
  const target = `darwin-${architecture}`;
  const base = path.join(fixture.root, "vendor", "media");
  const directory = mockPair(path.join(base, target), fixture, overrides);
  const manifestPath = path.join(base, "manifest.json");
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { schemaVersion: 1, architectures: {} };
  manifest.architectures[target] = { binaries: Object.fromEntries(["ffmpeg", "ffprobe"].map(name => [name, {
    path: `${target}/${name}`, sha256: digest(path.join(directory, name))
  }])) };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return directory;
}

function resolve(fixture, options = {}) {
  const args = [resolver, "--root", fixture.root, "--home", fixture.home];
  if (!options.defaultSystem) args.push("--system-dir", fixture.system);
  if (!options.nativeArchitecture) args.push("--arch", options.architecture || "arm64");
  const result = childProcess.spawnSync("/usr/bin/perl", args, {
    encoding: "utf8", timeout: 25000, maxBuffer: 1024 * 1024,
    env: { ...process.env, TMPDIR: fixture.temporary, ...options.env }
  });
  assert.ifError(result.error);
  assert.equal(result.stderr, "", "the resolver should emit only its JSON reply");
  assert.equal(result.signal, null);
  const reply = JSON.parse(result.stdout);
  assert.equal(result.stdout.trim().split("\n").length, 1);
  assert.equal(result.status, reply.ok ? 0 : 1);
  assert.deepEqual(fs.readdirSync(fixture.temporary), [], "validation must clean up all temporary samples and logs");
  return reply;
}

function calls(fixture) {
  return fs.existsSync(fixture.log) ? fs.readFileSync(fixture.log, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
}

test("shared resolver selects a complete system pair and never executes the bundle", t => {
  const data = fixture(t);
  mockPair(data.system, data);
  const bundled = bundle(data);
  const reply = resolve(data);
  assert.deepEqual(reply, { ok: true, source: "system", architecture: "arm64", version: "8.0.3", ffmpeg: path.join(data.system, "ffmpeg"), ffprobe: path.join(data.system, "ffprobe") }, JSON.stringify(calls(data)));
  assert.ok(calls(data).length >= 8);
  assert.ok(calls(data).every(call => !call.binary.startsWith(bundled)));
  assert.ok(calls(data).some(call => call.args.includes("testsrc2=size=64x64:rate=10:duration=0.2")));
  assert.ok(calls(data).some(call => call.args.includes("libx264") && call.args.includes("aac")));
});

test("shared resolver checks the home local bin directory first", t => {
  const data = fixture(t);
  const local = mockPair(path.join(data.home, ".local", "bin"), data);
  bundle(data);
  const reply = resolve(data, { defaultSystem: true });
  assert.equal(reply.ffmpeg, path.join(local, "ffmpeg"));
  assert.ok(calls(data).every(call => call.binary.startsWith(local)));
});

test("shared resolver does not mix an incomplete system pair with bundled tools", t => {
  const data = fixture(t);
  mockPair(data.system, data);
  fs.unlinkSync(path.join(data.system, "ffprobe"));
  const bundled = bundle(data);
  const reply = resolve(data);
  assert.equal(reply.source, "bundled");
  assert.equal(reply.ffprobe, path.join(bundled, "ffprobe"));
  assert.ok(calls(data).every(call => call.binary.startsWith(bundled)));
});

test("shared resolver falls back from incompatible and mismatched releases", async t => {
  for (const versions of [{ ffmpeg: "5.1", ffprobe: "5.1" }, { ffmpeg: "8.0", ffprobe: "7.1" }]) {
    await t.test(JSON.stringify(versions), t => {
      const data = fixture(t);
      mockPair(data.system, data, { versions });
      bundle(data);
      assert.equal(resolve(data).source, "bundled");
      assert.ok(calls(data).filter(call => call.binary.startsWith(data.system)).every(call => call.args[0] === "-version"));
    });
  }
});

test("shared resolver requires actual codec and filter entries, not description matches", async t => {
  for (const [kind, missing] of [["encoders", "libx264"], ["decoders", "hevc"], ["filters", "xstack"]]) {
    await t.test(`${kind}: ${missing}`, t => {
      const data = fixture(t);
      const available = { encoders, decoders, filters };
      mockPair(data.system, data, { [kind]: available[kind].filter(name => name !== missing), decoy: true });
      bundle(data);
      assert.equal(resolve(data).source, "bundled");
    });
  }
});

test("shared resolver accepts both legacy and current FFmpeg filter flag columns", t => {
  const data = fixture(t);
  mockPair(data.system, data, { filterFlags: "..." });
  assert.equal(resolve(data).source, "system");
});

test("shared resolver rejects advertised support when conversion, probing, or decoding fails", async t => {
  for (const failure of ["failEncode", "badProbe", "badPng"]) {
    await t.test(failure, t => {
      const data = fixture(t);
      mockPair(data.system, data, { [failure]: true });
      bundle(data);
      assert.equal(resolve(data).source, "bundled");
    });
  }
});

test("shared resolver verifies both bundled hashes before executing either tool", t => {
  const data = fixture(t);
  const bundled = bundle(data);
  fs.appendFileSync(path.join(bundled, "ffprobe"), "\n# modified after manifest\n");
  const reply = resolve(data);
  assert.equal(reply.ok, false);
  assert.equal(reply.code, "MEDIA_TOOLS_UNAVAILABLE");
  assert.equal(reply.attempts.at(-1).code, "HASH_MISMATCH");
  assert.deepEqual(calls(data), []);
});

test("shared resolver rejects manifest traversal and symbolic link bundles before execution", async t => {
  for (const variant of ["manifest path", "binary symlink", "directory symlink"]) {
    await t.test(variant, t => {
      const data = fixture(t);
      const bundled = bundle(data);
      if (variant === "manifest path") {
        const manifestPath = path.join(data.root, "vendor", "media", "manifest.json");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        manifest.architectures["darwin-arm64"].binaries.ffmpeg.path = "../ffmpeg";
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      } else if (variant === "binary symlink") {
        const file = path.join(bundled, "ffmpeg");
        fs.renameSync(file, `${file}-original`);
        fs.symlinkSync(`${file}-original`, file);
      } else {
        fs.renameSync(bundled, `${bundled}-original`);
        fs.symlinkSync(`${bundled}-original`, bundled);
      }
      assert.equal(resolve(data).ok, false);
      assert.deepEqual(calls(data), []);
    });
  }
});

test("shared resolver chooses only the requested native bundle architecture", async t => {
  for (const architecture of ["arm64", "x64"]) {
    await t.test(architecture, t => {
      const data = fixture(t);
      bundle(data, "arm64");
      bundle(data, "x64");
      const reply = resolve(data, { architecture });
      assert.equal(reply.architecture, architecture);
      assert.equal(reply.source, "bundled");
      assert.ok(calls(data).every(call => call.binary.includes(`darwin-${architecture}`)));
    });
  }
});

test("shared resolver never executes the other architecture as a fallback", t => {
  const data = fixture(t);
  bundle(data, "x64");
  assert.equal(resolve(data, { architecture: "arm64" }).ok, false);
  assert.deepEqual(calls(data), []);
});

test("shared resolver terminates a stuck executable and its descendants then falls back", t => {
  const data = fixture(t);
  mockPair(data.system, data, { hang: true, descendant: true });
  bundle(data);
  const started = Date.now();
  const reply = resolve(data, { env: { LKFB_MEDIA_PROBE_TIMEOUT_MS: "800" } });
  assert.equal(reply.source, "bundled", JSON.stringify(reply));
  assert.ok(Date.now() - started < 5000);
  const pids = fs.readFileSync(data.pids, "utf8").trim().split("\n");
  assert.equal(pids.length, 2);
  for (const pid of pids) {
    const state = childProcess.spawnSync("/bin/ps", ["-o", "stat=", "-p", pid], { encoding: "utf8" });
    assert.ok(!state.stdout.trim() || state.stdout.trim().startsWith("Z"), `validation child ${pid} must not remain alive`);
  }
});

test("shared resolver enforces the overall deadline", t => {
  const data = fixture(t);
  mockPair(data.system, data, { hang: true });
  bundle(data);
  const started = Date.now();
  const reply = resolve(data, { env: { LKFB_MEDIA_TOTAL_TIMEOUT_MS: "200", LKFB_MEDIA_PROBE_TIMEOUT_MS: "3000" } });
  assert.equal(reply.ok, false);
  assert.equal(reply.attempts[0].code, "COMMAND_TIMEOUT");
  assert.ok(Date.now() - started < 3000);
});

test("shared resolver does not overwrite installed tools, the manifest, or user media", t => {
  const data = fixture(t);
  const bundled = bundle(data);
  const source = path.join(data.home, "source clip.mp4");
  fs.writeFileSync(source, "existing user media");
  const files = [source, path.join(bundled, "ffmpeg"), path.join(bundled, "ffprobe"), path.join(data.root, "vendor", "media", "manifest.json")];
  const before = files.map(file => ({ digest: digest(file), mtime: fs.statSync(file).mtimeMs }));
  const reply = resolve(data);
  assert.equal(reply.source, "bundled");
  files.forEach((file, index) => assert.deepEqual({ digest: digest(file), mtime: fs.statSync(file).mtimeMs }, before[index]));
  assert.ok(calls(data).filter(call => call.args.at(-1).endsWith(".mp4") || call.args.at(-1).endsWith(".png")).every(call => call.args.at(-1).startsWith(data.temporary)));
});

test("shared resolver detects the physical host and runs a real bounded H.264/AAC conversion", t => {
  const directory = ["/opt/homebrew/bin", "/usr/local/bin"].find(candidate => fs.existsSync(path.join(candidate, "ffmpeg")) && fs.existsSync(path.join(candidate, "ffprobe")));
  if (!directory || process.platform !== "darwin") return t.skip("a real macOS FFmpeg pair is required");
  const data = fixture(t);
  data.system = directory;
  const reply = resolve(data, { nativeArchitecture: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  const sysctl = childProcess.spawnSync("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"], { encoding: "utf8" });
  assert.equal(reply.architecture, sysctl.stdout.trim() === "1" ? "arm64" : "x64");
  assert.equal(reply.source, "system");
});
