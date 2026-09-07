#!/usr/bin/perl
use strict;
use warnings;
use Cwd qw(abs_path);
use Digest::SHA;
use Encode qw(decode FB_DEFAULT);
use File::Spec;
use File::Temp qw(tempdir);
use JSON::PP;
use POSIX qw(WNOHANG _exit);
use Time::HiRes qw(time sleep);

# This is shared by the installer and CEP runtime; stdout is a single JSON reply.
my $started = time();
my $step_seconds = bounded_timeout('LKFB_MEDIA_PROBE_TIMEOUT_MS', 3000, 50, 3000) / 1000;
my $deadline = $started + bounded_timeout('LKFB_MEDIA_TOTAL_TIMEOUT_MS', 20000, 100, 20000) / 1000;
my $temporary;
my $active_pid;
my $command_number = 0;
my @attempts;
my $interrupted = 0;
$SIG{TERM} = $SIG{INT} = sub { $interrupted = 1; die "Media tool validation interrupted\n"; };

sub bounded_timeout {
    my ($name, $default, $minimum, $maximum) = @_;
    my $value = $ENV{$name};
    return $default unless defined($value) && $value =~ /^\d+$/;
    return $minimum if $value < $minimum;
    return $maximum if $value > $maximum;
    return 0 + $value;
}

sub fail {
    my ($code, $message) = @_;
    die { code => $code, message => $message };
}

sub check_deadline {
    fail('VALIDATION_INTERRUPTED', 'Media tool validation was interrupted') if $interrupted;
    fail('VALIDATION_TIMEOUT', 'Media tool validation exceeded its time limit') if time() >= $deadline;
}

sub terminate_child {
    my ($pid) = @_;
    return unless $pid;
    # Each command owns a process group, including descendants started by wrappers.
    kill 'TERM', -$pid;
    kill 'TERM', $pid;
    my $until = time() + 0.1;
    my $reaped = 0;
    while (time() < $until) {
        $reaped = 1 if !$reaped && waitpid($pid, WNOHANG) == $pid;
        sleep 0.01;
    }
    kill 'KILL', -$pid;
    kill 'KILL', $pid unless $reaped;
    waitpid($pid, 0) unless $reaped;
    $active_pid = undef;
}

sub read_output {
    my ($file) = @_;
    open my $handle, '<:raw', $file or return '';
    my $output = '';
    read($handle, $output, 2 * 1024 * 1024);
    close $handle;
    return $output;
}

sub run_command {
    my ($binary, @arguments) = @_;
    check_deadline();
    my $stdout = File::Spec->catfile($temporary, ++$command_number . '.out');
    my $stderr = File::Spec->catfile($temporary, $command_number . '.err');
    my $until = time() + $step_seconds;
    $until = $deadline if $until > $deadline;
    my $pid = fork();
    fail('EXECUTION_FAILED', 'Could not start media validation process') unless defined $pid;
    if (!$pid) {
        POSIX::setpgid(0, 0) == 0 or _exit(125);
        open STDIN, '<', '/dev/null' or _exit(125);
        open STDOUT, '>:raw', $stdout or _exit(125);
        open STDERR, '>:raw', $stderr or _exit(125);
        delete $ENV{FFREPORT};
        exec { $binary } $binary, @arguments or _exit(127);
    }
    $active_pid = $pid;
    POSIX::setpgid($pid, $pid);
    my ($status, $failure);
    while (1) {
        my $finished = waitpid($pid, WNOHANG);
        if ($finished == $pid) { $status = $?; last; }
        if ($finished == -1) { $failure = 'EXECUTION_FAILED'; last; }
        if (time() >= $until) { $failure = 'COMMAND_TIMEOUT'; last; }
        if ((-s $stdout || 0) + (-s $stderr || 0) > 2 * 1024 * 1024) {
            $failure = 'OUTPUT_LIMIT'; last;
        }
        sleep 0.01;
    }
    if ($failure) {
        terminate_child($pid);
    } else {
        kill 'KILL', -$pid;
        $active_pid = undef;
    }
    my $out = read_output($stdout);
    my $err = read_output($stderr);
    unlink $stdout, $stderr;
    fail($failure, $failure eq 'COMMAND_TIMEOUT' ? 'Media tool command timed out' : 'Media tool command could not complete') if $failure;
    fail('EXECUTION_FAILED', 'Media tool command failed: ' . (File::Spec->splitpath($binary))[2]) unless defined($status) && $status == 0;
    return ($out, $err);
}

sub version_of {
    my ($binary, $name) = @_;
    my ($out, $err) = run_command($binary, '-version');
    my ($version, $major) = ($out . "\n" . $err) =~ /^\Q$name\E version (n?(\d+)(?:[.\w+\-]*))/m;
    fail('INCOMPATIBLE_VERSION', "$name must report a release version of 6 or newer") unless defined($major) && $major >= 6;
    return ($version, 0 + $major);
}

sub require_capabilities {
    my ($binary, $option, @required) = @_;
    my ($out, $err) = run_command($binary, '-hide_banner', $option);
    my $combined = $out . "\n" . $err;
    my %available;
    while ($combined =~ /^\s*[A-Z.]{2,6}\s+([a-zA-Z0-9_]+)\s+/mg) { $available{$1} = 1; }
    my @missing = grep { !$available{$_} } @required;
    fail('MISSING_CAPABILITY', "$option missing: " . join(', ', @missing)) if @missing;
}

sub verify_bundle {
    my ($root, $architecture, $ffmpeg, $ffprobe) = @_;
    my $base = File::Spec->catdir($root, 'vendor', 'media');
    my $target = 'darwin-' . $architecture;
    for my $directory (File::Spec->catdir($root, 'vendor'), $base, File::Spec->catdir($base, $target)) {
        fail('UNTRUSTED_BUNDLE', 'Bundled media directories must not be symbolic links') if -l $directory;
    }
    my $manifest_path = File::Spec->catfile($base, 'manifest.json');
    fail('INVALID_MANIFEST', 'Bundled media manifest is missing or too large') unless -f $manifest_path && !-l $manifest_path && -s $manifest_path <= 1024 * 1024;
    my $manifest = eval { JSON::PP->new->utf8->decode(read_output($manifest_path)) };
    fail('INVALID_MANIFEST', 'Bundled media manifest is invalid') unless ref($manifest) eq 'HASH' && !ref($manifest->{schemaVersion}) && ($manifest->{schemaVersion} || '') eq '1';
    my $architectures = $manifest->{architectures};
    my $entry = ref($architectures) eq 'HASH' ? $architectures->{$target} : undef;
    my $binaries = ref($entry) eq 'HASH' ? $entry->{binaries} : undef;
    fail('INVALID_MANIFEST', 'No manifest entry for the native media tool architecture') unless ref($binaries) eq 'HASH';
    for my $name ('ffmpeg', 'ffprobe') {
        check_deadline();
        my $record = $binaries->{$name};
        fail('INVALID_MANIFEST', 'Bundled media path or SHA-256 is invalid') unless ref($record) eq 'HASH' && ($record->{path} || '') eq "$target/$name" && ($record->{sha256} || '') =~ /^[a-fA-F0-9]{64}$/;
        my $file = $name eq 'ffmpeg' ? $ffmpeg : $ffprobe;
        fail('UNTRUSTED_BUNDLE', 'Bundled media tools must not be symbolic links') if -l $file;
        open my $handle, '<:raw', $file or fail('HASH_MISMATCH', 'Could not read bundled media tool');
        my $sha = Digest::SHA->new(256);
        my $buffer;
        while (1) {
            check_deadline();
            my $count = read($handle, $buffer, 1024 * 1024);
            fail('HASH_MISMATCH', 'Could not read bundled media tool') unless defined $count;
            last unless $count;
            $sha->add($buffer);
        }
        close $handle;
        fail('HASH_MISMATCH', "Bundled $name failed SHA-256 verification") unless $sha->hexdigest eq lc($record->{sha256});
    }
}

sub smoke_test {
    my ($ffmpeg, $ffprobe) = @_;
    my $mp4 = File::Spec->catfile($temporary, 'sample-' . $command_number . '.mp4');
    my $png = File::Spec->catfile($temporary, 'sample-' . $command_number . '.png');
    run_command($ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=10:duration=0.2',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.2',
        '-t', '0.2', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-n', $mp4);
    fail('SMOKE_TEST_FAILED', 'Media tool did not create the H.264/AAC sample') unless -f $mp4 && -s $mp4 > 0;
    my ($probe_output) = run_command($ffprobe, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', $mp4);
    my $probe = eval { JSON::PP->new->utf8->decode($probe_output) };
    fail('SMOKE_TEST_FAILED', 'ffprobe returned invalid sample metadata') unless ref($probe) eq 'HASH' && ref($probe->{streams}) eq 'ARRAY';
    my ($video, $audio) = (0, 0);
    for my $stream (@{$probe->{streams}}) {
        next unless ref($stream) eq 'HASH';
        $video = 1 if ($stream->{codec_type} || '') eq 'video' && ($stream->{codec_name} || '') eq 'h264' && ($stream->{width} || '') eq '64' && ($stream->{height} || '') eq '64';
        $audio = 1 if ($stream->{codec_type} || '') eq 'audio' && ($stream->{codec_name} || '') eq 'aac';
    }
    fail('SMOKE_TEST_FAILED', 'The test sample does not contain H.264 video and AAC audio') unless $video && $audio;
    run_command($ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', $mp4,
        '-frames:v', '1', '-vf', 'scale=32:32,pad=64:64:16:16,format=rgb24',
        '-c:v', 'png', '-threads', '1', '-n', $png);
    open my $image, '<:raw', $png or fail('SMOKE_TEST_FAILED', 'Media tool did not decode the sample to PNG');
    my $header;
    my $count = read($image, $header, 24);
    close $image;
    fail('SMOKE_TEST_FAILED', 'Media tool returned an invalid PNG sample') unless $count && $count == 24 && substr($header, 0, 8) eq "\x89PNG\r\n\x1a\n" && substr($header, 12, 4) eq 'IHDR' && unpack('N', substr($header, 16, 4)) == 64 && unpack('N', substr($header, 20, 4)) == 64;
    unlink $mp4, $png;
}

sub native_architecture {
    if (-x '/usr/sbin/sysctl') {
        my $result = eval { my ($out) = run_command('/usr/sbin/sysctl', '-n', 'hw.optional.arm64'); $out };
        return 'arm64' if defined($result) && $result =~ /^1\s*$/;
    }
    my ($machine) = run_command('/usr/bin/uname', '-m');
    return 'arm64' if $machine =~ /^(?:arm64|aarch64)\s*$/;
    return 'x64' if $machine =~ /^(?:x86_64|amd64)\s*$/;
    fail('UNSUPPORTED_ARCHITECTURE', 'Only Apple Silicon and Intel Macs are supported');
}

sub resolve_tools {
    my %options;
    while (@ARGV) {
        my $name = shift @ARGV;
        fail('INVALID_ARGUMENT', 'Expected --root, --home, --system-dir, or --arch') unless $name =~ /^--(root|home|system-dir|arch)$/ && @ARGV;
        fail('INVALID_ARGUMENT', 'Duplicate resolver argument') if exists $options{$1};
        $options{$1} = shift @ARGV;
    }
    for my $required ('root', 'home') {
        fail('INVALID_ARGUMENT', "--$required must be an absolute directory") unless defined($options{$required}) && File::Spec->file_name_is_absolute($options{$required}) && -d $options{$required};
    }
    fail('INVALID_ARGUMENT', '--system-dir must be absolute') if exists($options{'system-dir'}) && !File::Spec->file_name_is_absolute($options{'system-dir'});
    fail('INVALID_ARGUMENT', '--arch must be arm64 or x64') if exists($options{arch}) && $options{arch} !~ /^(?:arm64|x64)$/;
    $temporary = tempdir('lkfb-media-validation-XXXXXXXX', TMPDIR => 1, CLEANUP => 1);
    my $root = abs_path($options{root});
    my $architecture = $options{arch} || native_architecture();
    my @system = exists($options{'system-dir'}) ? ($options{'system-dir'}) : (File::Spec->catdir($options{home}, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin');
    my @candidates = ((map { { source => 'system', directory => $_ } } @system), { source => 'bundled', directory => File::Spec->catdir($root, 'vendor', 'media', 'darwin-' . $architecture) });
    for my $candidate (@candidates) {
        my $directory = File::Spec->canonpath($candidate->{directory});
        my $ffmpeg = File::Spec->catfile($directory, 'ffmpeg');
        my $ffprobe = File::Spec->catfile($directory, 'ffprobe');
        my $result = eval {
            check_deadline();
            fail('INCOMPLETE_PAIR', 'Both ffmpeg and ffprobe must be executable files in this directory') unless -f $ffmpeg && -x $ffmpeg && -f $ffprobe && -x $ffprobe;
            verify_bundle($root, $architecture, $ffmpeg, $ffprobe) if $candidate->{source} eq 'bundled';
            my ($version, $major) = version_of($ffmpeg, 'ffmpeg');
            my (undef, $probe_major) = version_of($ffprobe, 'ffprobe');
            fail('VERSION_MISMATCH', 'ffmpeg and ffprobe must have the same major release') unless $major == $probe_major;
            require_capabilities($ffmpeg, '-encoders', 'libx264', 'aac', 'png');
            require_capabilities($ffmpeg, '-decoders', 'h264', 'hevc');
            require_capabilities($ffmpeg, '-filters', 'scale', 'pad', 'format', 'xstack', 'showwavespic', 'signalstats', 'metadata', 'trim', 'tile');
            smoke_test($ffmpeg, $ffprobe);
            { ok => JSON::PP::true, ffmpeg => $ffmpeg, ffprobe => $ffprobe, source => $candidate->{source}, architecture => $architecture, version => $version };
        };
        return $result if $result;
        my $error = $@;
        terminate_child($active_pid) if $active_pid;
        push @attempts, { source => $candidate->{source}, directory => $directory, code => ref($error) eq 'HASH' ? $error->{code} : 'VALIDATION_FAILED', message => ref($error) eq 'HASH' ? $error->{message} : 'Media tool validation failed' };
        last if $interrupted || time() >= $deadline;
    }
    fail('MEDIA_TOOLS_UNAVAILABLE', 'No compatible ffmpeg and ffprobe pair is available');
}

sub json_strings {
    my ($value) = @_;
    return { map { $_ => json_strings($value->{$_}) } keys %$value } if ref($value) eq 'HASH';
    return [ map { json_strings($_) } @$value ] if ref($value) eq 'ARRAY';
    return $value if ref($value) || !defined($value) || utf8::is_utf8($value);
    return decode('UTF-8', $value, FB_DEFAULT);
}

my $result = eval { resolve_tools() };
unless ($result) {
    my $error = $@;
    terminate_child($active_pid) if $active_pid;
    $result = { ok => JSON::PP::false, code => 'MEDIA_TOOLS_UNAVAILABLE', message => ref($error) eq 'HASH' ? $error->{message} : 'Media tool validation failed', attempts => \@attempts };
}
print JSON::PP->new->utf8->canonical->encode(json_strings($result)), "\n";
exit($result->{ok} ? 0 : 1);
