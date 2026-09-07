#!/usr/bin/perl
use strict;
use warnings;
use Fcntl qw(:flock F_GETFD F_SETFD FD_CLOEXEC);
use JSON::PP qw(decode_json encode_json);
use POSIX qw(:sys_wait_h);
use File::Copy qw(copy);

if ($ARGV[0] eq '--index') {
    my (undef, $destination, $temporary, $json) = @ARGV;
    my $incoming = decode_json($json);
    open(my $guard, '>>', "$destination.lock") or die "CACHE_INDEX_LOCK: $!\n";
    flock($guard, LOCK_EX) or die "CACHE_INDEX_LOCK: $!\n";
    my $previous;
    if (open(my $old, '<', $destination)) { local $/; my $data = <$old>; close $old; eval { $previous = decode_json($data); }; }
    if ($previous && ref($previous) eq 'HASH' && ($previous->{version} // 0) == 1 && ($previous->{source} // '') eq $incoming->{source}) {
        $previous->{artifacts} = {} unless ref($previous->{artifacts}) eq 'HASH';
        if (($previous->{signature} // '') eq $incoming->{signature}) {
            $incoming->{artifacts} = { %{$previous->{artifacts} || {}}, %{$incoming->{artifacts}} };
        } elsif (($previous->{validatedAt} // 0) > ($incoming->{validatedAt} // 0)) {
            $incoming->{signature} = $previous->{signature};
            $incoming->{artifacts} = $previous->{artifacts};
            $incoming->{validatedAt} = $previous->{validatedAt};
        }
        if (($previous->{pinnedAt} // 0) > ($incoming->{pinnedAt} // 0)) {
            $incoming->{pinned} = $previous->{pinned}; $incoming->{pinnedAt} = $previous->{pinnedAt};
        }
    }
    open(my $out, '>', $temporary) or die "CACHE_INDEX_WRITE: $!\n";
    print $out encode_json($incoming); close $out or die $!;
    rename($temporary, $destination) or die "CACHE_INDEX_PUBLISH: $!\n";
    print encode_json($incoming);
    exit 0;
}

# An advisory OS lock has no stale-owner timeout: the kernel releases it only
# after the worker and any inherited decoder descriptors have actually closed.
my ($lock_path, $binary, $temporary, $destination, $limit, $background, $sprite_json, @args) = @ARGV;
POSIX::setsid() >= 0 or die "MEDIA_PROCESS_GROUP: $!\n";
open(my $lock, '>>', $lock_path) or die "MEDIA_LOCK_OPEN: $!\n";
flock($lock, LOCK_EX) or die "MEDIA_LOCK_ACQUIRE: $!\n";
fcntl($lock, F_SETFD, fcntl($lock, F_GETFD, 0) & ~FD_CLOEXEC) or die "MEDIA_LOCK_INHERIT: $!\n";
my $configuration = $sprite_json ? decode_json($sprite_json) : {};
my $sprite_spec = $configuration->{sprite};
my $budget = $configuration->{budget};
my $usage;
my $usage_path;
my $layer = $destination =~ m{/(?:proxies|audio)/} ? 'proxies' : 'images';
sub measure_usage {
    my %totals = (images => 0, proxies => 0);
    for my $directory (qw(metadata posters sprites waveforms proxies frames audio stills)) {
        my $root = "$budget->{root}/$directory";
        opendir(my $entries, $root) or next;
        while (my $name = readdir $entries) {
            next unless $name =~ /^[a-f0-9]{40}[-.].+\.(?:png|jpg|mp4|m4a|json)$/ && $name !~ /\.part\./;
            my $file = "$root/$name";
            next unless -f $file && !-l $file;
            $totals{$directory eq 'proxies' || $directory eq 'audio' ? 'proxies' : 'images'} += -s $file;
        }
        closedir $entries;
    }
    return \%totals;
}
sub budget_exceeded {
    my ($extra) = @_;
    return $usage->{images} + $usage->{proxies} + $extra > $budget->{maxBytes} || $usage->{$layer} + $extra > $budget->{$layer};
}
sub check_budget {
    my ($extra) = @_;
    return unless $budget;
    if (budget_exceeded($extra)) { $usage = measure_usage(); }
    die "CACHE_BUDGET_EXCEEDED\n" if budget_exceeded($extra);
}
sub valid_output {
    my ($file) = @_;
    return 0 unless -f $file && !-l $file && -s $file;
    if ($file =~ /\.(png|jpg|jpeg)$/i) {
        open(my $image, '<', $file) or return 0; binmode $image;
        read($image, my $head, 8); close $image;
        return 0 if $file =~ /\.png$/i ? $head ne "\x89PNG\r\n\x1a\n" : substr($head, 0, 3) ne "\xff\xd8\xff";
    }
    return 1;
}
my $valid = $destination && valid_output($destination);
if ($valid && $sprite_spec) {
    my $info;
    if (open(my $sidecar, '<', "$destination.json")) { local $/; my $data = <$sidecar>; close $sidecar; eval { $info = decode_json($data); }; }
    $valid = $info && ref($info->{sampleTimes}) eq 'ARRAY' && @{$info->{sampleTimes}} == 12;
}
if ($valid) {
    print "LKFB_CACHE_HIT\n";
    exit 0;
}
if ($destination && -e $destination) { unlink $destination or die "CACHE_INVALID_OUTPUT: $!\n"; }
if ($destination && $budget) {
    $usage_path = "$budget->{root}/resource-usage-v1.json";
    if (open(my $stored, '<', $usage_path)) { local $/; my $data = <$stored>; close $stored; eval { $usage = decode_json($data); }; }
    $usage = measure_usage() unless $usage && ref($usage) eq 'HASH' && defined $usage->{images} && defined $usage->{proxies};
    check_budget($limit || 0);
}
my $child = 0;
my $stopping = 0;
$SIG{TERM} = $SIG{INT} = sub { $stopping = 1; kill 'TERM', $child if $child; };
sub run_command {
    my ($capture, @command) = @_;
    die "JOB_CANCELLED\n" if $stopping;
    pipe(my $reader, my $writer) or die "MEDIA_PIPE: $!\n";
    $child = fork();
    die "MEDIA_FORK: $!\n" unless defined $child;
    if (!$child) {
        close $reader;
        if ($capture) { open STDERR, '>&', $writer or die $!; }
        close $writer;
        if ($background) { exec '/usr/bin/nice', '-n', '10', @command; }
        else { exec @command; }
        die "MEDIA_EXEC: $!\n";
    }
    close $writer;
    my $stderr = '';
    if ($capture) { local $/; $stderr = <$reader> // ''; }
    close $reader;
    my $waited;
    do { $waited = waitpid($child, 0); } while ($waited == -1 && $!{EINTR});
    my $status = $?;
    $child = 0;
    die "JOB_CANCELLED\n" if $stopping;
    die "MEDIA_EXEC_FAILED: $status\n$stderr" if $status;
    return $stderr;
}
my @cleanup;
my $work;
my $times;
my $error;
eval {
    if ($sprite_spec) {
        my $spec = $sprite_spec;
        $work = $spec->{work};
        mkdir $work or die "SPRITE_WORK_DIRECTORY: $!\n";
        my @actual;
        for my $i (0 .. $#{$spec->{times}}) {
            my $frame = sprintf('%s/frame-%02d.jpg', $work, $i);
            push @cleanup, $frame;
            my $actual;
            my $retry = $spec->{times}[$i] > 1 ? $spec->{times}[$i] - 1 : 0;
            for my $seek ($spec->{times}[$i], $retry) {
                my $stderr;
                my $ok = eval { $stderr = run_command(1, $binary, '-hide_banner', '-loglevel', 'info', '-threads', $spec->{threads} || 1, '-filter_threads', '1', '-filter_complex_threads', '1', '-copyts', '-ss', $seek, '-i', $spec->{source}, '-map', '0:v:' . $spec->{stream}, '-frames:v', '1', '-vf', 'trim=end_frame=1,scale=240:136:force_original_aspect_ratio=increase,crop=240:136,setsar=1,format=yuvj420p,showinfo', '-threads', '1', '-q:v', '4', '-an', '-sn', '-dn', '-y', $frame); 1; };
                die "JOB_CANCELLED\n" if $stopping;
                next unless $ok && valid_output($frame);
                my ($pts) = $stderr =~ /\bpts_time:([\d.eE+-]+)/;
                next unless defined $pts;
                $actual = 0 + $pts - ($spec->{startTime} || 0);
                last;
            }
            # Some transport streams seek past the final GOP. A previous
            # decoded sample is a truthful bounded fallback, with its own PTS.
            if ($i && (!defined $actual || $actual < $actual[-1])) {
                copy(sprintf('%s/frame-%02d.jpg', $work, $i - 1), $frame) or die "SPRITE_FRAME_COPY: $!\n";
                $actual = $actual[-1];
            }
            die "SPRITE_TIMESTAMP_UNAVAILABLE\n" unless defined $actual && $actual >= -.001;
            push @actual, $actual < 0 ? 0 : $actual;
        }
        run_command(0, $binary, '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', '-framerate', '1', '-i', "$work/frame-%02d.jpg", '-frames:v', '1', '-vf', 'tile=4x3,format=yuvj420p', '-threads', '1', '-q:v', '4', '-fs', $limit, '-y', $temporary);
        $times = \@actual;
    } else { run_command(0, $binary, @args); }
    if ($destination) {
        die "OUTPUT_NOT_CREATED\n" unless -f $temporary && !-l $temporary && -s $temporary;
        die "CACHE_OUTPUT_LIMIT\n" if $limit && (-s $temporary) >= $limit * .98;
        check_budget(-s $temporary);
        if ($times) {
            my $sidecar = "$temporary.json";
            push @cleanup, $sidecar;
            open(my $info, '>', $sidecar) or die "SPRITE_INFO: $!\n";
            print $info encode_json({ sampleTimes => $times }); close $info or die $!;
            rename($sidecar, "$destination.json") or die "SPRITE_INFO_PUBLISH: $!\n";
        }
        link($temporary, $destination) or die "CACHE_PUBLISH: $!\n";
        if ($usage) {
            $usage->{$layer} += -s $destination;
            $usage->{$layer} += -s "$destination.json" if $times;
            my $usage_temporary = "$usage_path.$$.part";
            push @cleanup, $usage_temporary;
            open(my $updated, '>', $usage_temporary) or die "CACHE_USAGE_WRITE: $!\n";
            print $updated encode_json($usage); close $updated or die $!;
            rename($usage_temporary, $usage_path) or die "CACHE_USAGE_PUBLISH: $!\n";
        }
    }
    1;
} or $error = $@ || 'MEDIA_WORKER_FAILED';
unlink $_ for @cleanup;
rmdir $work if $work;
die $error if $error;
