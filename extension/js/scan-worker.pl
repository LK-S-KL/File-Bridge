use strict;
use warnings;
use JSON::PP;
use Encode qw(decode FB_DEFAULT);

# Filesystem calls live outside CEP's shared libuv thread pool. A hung mount
# can then be abandoned without blocking scans of other mounted locations.
my ($root, $max_files, $max_depth, $include_directories) = @ARGV;
my $json = JSON::PP->new->utf8;
$| = 1;
sub text_path { return decode('UTF-8', $_[0], FB_DEFAULT); }
sub emit { print $json->encode($_[0]), "\n"; }
my @pending = ([$root, 0]);
my @batch;
my $count = 0;
my %skip = map { $_ => 1 } ('.git', '.svn', '@eaDir', 'node_modules', 'System Volume Information', '$RECYCLE.BIN');
my %types;
for my $pair (
  ['video', 'mp4 mov m4v mkv avi webm mxf mts m2ts mpg mpeg vob hevc h265 braw'],
  ['image', 'jpg jpeg jpe png webp bmp tif tiff gif heic heif avif psd psb ai eps svg dng cr2 cr3 arw nef raf rw2'],
  ['audio', 'mp3 wav m4a aac aif aiff flac ogg opus ac3'], ['lut', 'cube']
) { $types{$_} = $pair->[0] for split / /, $pair->[1]; }
sub flush_batch { emit({type => 'progress', assets => [@batch], found => $count, pending => scalar @pending}); @batch = (); }
unless (defined($root) && -d $root) { emit({type => 'done', offline => JSON::PP::true}); exit 0; }
while (@pending && $count < $max_files) {
  my ($directory, $depth) = @{pop @pending};
  my $handle;
  unless (opendir($handle, $directory)) {
    emit({type => 'warning', path => text_path($directory)});
    if ($directory eq $root) { emit({type => 'done', offline => JSON::PP::true}); exit 0; }
    next;
  }
  my @names = readdir($handle);
  closedir($handle);
  for my $name (@names) {
    next if $name =~ /^\./;
    my $absolute = $directory eq '/' ? "/$name" : "$directory/$name";
    my @stat = lstat($absolute);
    unless (@stat) { emit({type => 'warning', path => text_path($absolute)}); next; }
    next if -l _;
    my $type;
    my ($extension) = $name =~ /\.([^.]+)$/;
    $extension = lc($extension || '');
    if (-d _) {
      if ($depth < $max_depth && !$skip{$name}) {
        push @pending, [$absolute, $depth + 1];
        $type = 'folder' if $include_directories;
      }
    } elsif (-f _) { $type = $types{$extension}; }
    next unless $type;
    my $relative = substr($absolute, length($root)); $relative =~ s{^/}{};
    my $folder = $relative; $folder =~ s{/[^/]+$}{};
    $folder = '' if $folder eq $relative;
    push @batch, {id => text_path($absolute), path => text_path($absolute), name => text_path($name), relativePath => text_path($relative), folder => text_path($folder), extension => $extension, type => $type, size => $type eq 'folder' ? 0 : $stat[7], modifiedMs => $stat[9] * 1000};
    $count += 1;
    flush_batch() if @batch >= 36;
    last if $count >= $max_files;
  }
  flush_batch();
}
flush_batch() if @batch;
emit({type => 'done', offline => JSON::PP::false, truncated => $count >= $max_files ? JSON::PP::true : JSON::PP::false});
