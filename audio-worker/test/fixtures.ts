import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Real media, generated at test time.
 *
 * No binaries in the repo, and — more importantly — no synthesised `sine` WAV
 * standing in for "an audio file". A bare 48 kHz stereo sine is the one shape
 * that hides almost every defect in this pipeline: it has no cover art, one
 * audio stream, two channels, an exact header duration and a full payload. The
 * cover-art bug (`-map 0:a:0`) shipped precisely because the only fixture in
 * the suite was that sine, and it passed.
 *
 * Every builder below produces a file that is legitimate in the wild and that
 * the pre-fix pipeline mishandles.
 */

/** ffmpeg's banner and progress lines go to stderr unconditionally; silence them. */
function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

/**
 * Write a canonical 16-bit PCM WAV from an exact sample array.
 *
 * Used where the sample COUNT is the thing under test and ffmpeg's own
 * generators can't express it — a file of exactly 16 399 samples, or one with
 * a valid `fmt ` chunk and an empty `data` chunk.
 */
export function writeWav(
  path: string,
  samples: Int16Array,
  sampleRate: number,
  channels: number
): void {
  const dataBytes = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  const body = Buffer.from(samples.buffer, samples.byteOffset, dataBytes);
  writeFileSync(path, Buffer.concat([header, body]));
}

function sine(count: number, freq: number, rate: number, amplitude: number): Int16Array {
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * freq * i) / rate));
  }
  return out;
}

/** Truncate a file to a fraction of its bytes — a half-finished upload. */
function truncate(src: string, dst: string, fraction: number): void {
  const bytes = readFileSync(src);
  writeFileSync(dst, bytes.subarray(0, Math.max(1, Math.floor(bytes.length * fraction))));
}

export type Fixtures = Record<string, string>;

/**
 * Builds every fixture into `dir` and returns absolute paths by name.
 * Total cost is well under a second — the 31-minute source is 8 kbit/s mono,
 * which lavfi+LAME produce in ~0.7 s.
 */
export function buildFixtures(dir: string): Fixtures {
  const p = (name: string) => join(dir, name);

  // The baseline the suite used to rely on exclusively. Kept as the control.
  const tone = p('tone.wav');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2:sample_rate=48000',
    '-ac',
    '2',
    tone,
  ]);

  // --- cover art: what most real music files look like ---
  const art = p('cover.png');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-frames:v', '1', art]);

  const plainMp3 = p('plain.mp3');
  ffmpeg(['-i', tone, '-c:a', 'libmp3lame', plainMp3]);

  const mp3WithArt = p('with-art.mp3');
  ffmpeg([
    '-i',
    plainMp3,
    '-i',
    art,
    '-map',
    '0:a',
    '-map',
    '1:v',
    '-c:a',
    'copy',
    '-c:v',
    'copy',
    '-id3v2_version',
    '3',
    '-metadata:s:v',
    'title=Album cover',
    '-metadata:s:v',
    'comment=Cover (front)',
    mp3WithArt,
  ]);

  const flacWithArt = p('with-art.flac');
  ffmpeg([
    '-i',
    tone,
    '-i',
    art,
    '-map',
    '0:a',
    '-map',
    '1:v',
    '-c:a',
    'flac',
    '-c:v',
    'copy',
    '-disposition:v',
    'attached_pic',
    flacWithArt,
  ]);

  // --- channel / rate shapes that are not 48 kHz stereo ---
  const surround = p('surround.wav');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2:sample_rate=48000',
    '-af',
    'pan=5.1|c0=c0|c1=c0|c2=c0|c3=c0|c4=c0|c5=c0',
    surround,
  ]);

  const mono8k = p('mono8k.wav');
  ffmpeg(['-i', tone, '-ar', '8000', '-ac', '1', mono8k]);

  const stereo96k = p('stereo96k.wav');
  ffmpeg(['-i', tone, '-ar', '96000', stereo96k]);

  // --- containers whose FORMAT duration is not the a:0 duration ---
  const multiStream = p('two-audio-streams.m4a');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2:sample_rate=48000',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:duration=8:sample_rate=48000',
    '-map',
    '0:a',
    '-map',
    '1:a',
    '-c:a',
    'aac',
    multiStream,
  ]);

  const videoWithAudio = p('video-with-audio.mp4');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=160x120:rate=25:duration=10',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3:sample_rate=48000',
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    videoWithAudio,
  ]);

  // Matroska carries no per-stream duration at all (`stream=duration` is N/A),
  // which is the case `probe`'s format fallback exists for.
  const noStreamDuration = p('no-stream-duration.mka');
  ffmpeg(['-i', tone, '-c:a', 'libopus', noStreamDuration]);

  // --- sources that must be rejected ---

  // Header intact, payload cut short: a half-transferred upload.
  const truncatedMp3 = p('truncated.mp3');
  truncate(plainMp3, truncatedMp3, 0.4);

  const flac = p('plain.flac');
  ffmpeg(['-i', tone, '-c:a', 'flac', flac]);
  // A different codec whose truncation ALSO transcodes cleanly rather than
  // erroring: the FLAC header still declares 2000 ms and the renditions come
  // out around 200 ms. (Cut much harder than this and ffmpeg refuses to open
  // the input at all, which the ordinary retry path already handles loudly.)
  const truncatedFlac = p('truncated.flac');
  truncate(flac, truncatedFlac, 0.35);

  // Digital silence end to end — loudnorm divides by zero on this.
  const silence = p('silence.wav');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-t',
    '2',
    '-c:a',
    'pcm_s16le',
    silence,
  ]);

  // 44 bytes: a valid `fmt ` chunk and an empty `data` chunk.
  const empty = p('empty.wav');
  writeWav(empty, new Int16Array(0), 48000, 2);

  // 31 minutes, over the 30-minute cap. 8 kbit/s mono keeps it to ~1.8 MB.
  const overCap = p('over-cap.mp3');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=100:duration=1860:sample_rate=8000',
    '-ac',
    '1',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '8k',
    overCap,
  ]);

  // Same header claim, but only the first 40 kB of payload — it decodes to
  // ~40 s. The cap has to be applied to the HEADER, before anything decodes,
  // or this file is judged on its 40 s of payload instead of its 31 minute
  // claim. That ordering is the entire DoS mitigation.
  const overCapTruncated = p('over-cap-truncated.mp3');
  truncate(overCap, overCapTruncated, 40_000 / readFileSync(overCap).length);

  // --- sources that must NOT be rejected ---

  // A complete, valid VBR MP3 with no Xing header, so ffprobe can only
  // extrapolate the duration from the first frame's bitrate. Quiet content
  // first, loud content after, which makes that extrapolation OVER-report.
  // This is the false-positive the truncation tolerance has to survive.
  const quietHead = p('quiet-head.wav');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=100:duration=5:sample_rate=44100',
    '-af',
    'volume=-40dB',
    '-ac',
    '2',
    quietHead,
  ]);
  const loudTail = p('loud-tail.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=d=1:c=white:r=44100:a=0.9', '-ac', '2', loudTail]);
  const vbrWithXing = p('vbr.mp3');
  ffmpeg([
    '-i',
    quietHead,
    '-i',
    loudTail,
    '-filter_complex',
    '[0:a][1:a]concat=n=2:v=0:a=1',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '0',
    vbrWithXing,
  ]);
  const vbrNoXing = p('vbr-no-xing.mp3');
  ffmpeg(['-i', vbrWithXing, '-c:a', 'copy', '-write_xing', '0', '-f', 'mp3', vbrNoXing]);

  // Whisper-quiet but genuinely audible: -69 dBFS. Normalization lifts it to
  // near full scale, so peaks taken from the SOURCE describe a flat line while
  // peaks taken from the rendition describe what the user actually hears.
  const quiet = p('quiet.wav');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2:sample_rate=48000',
    '-af',
    'volume=-69dB',
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    quiet,
  ]);

  // --- peak-bucketing edge cases (exact sample counts, hence writeWav) ---

  // 16 399 samples at 8 kHz: `floor(16399 / 400) * 400 = 16000`, so a
  // fixed-stride bucketer drops the last 399 samples. Those last 400 samples
  // are full scale and everything before them is not.
  const markerSamples = sine(16_399, 440, 8000, 0.01);
  for (let i = markerSamples.length - 400; i < markerSamples.length; i++) {
    markerSamples[i] = Math.round(32767 * Math.sin((2 * Math.PI * 440 * i) / 8000));
  }
  const trailingMarker = p('trailing-marker.wav');
  writeWav(trailingMarker, markerSamples, 8000, 1);

  // 20 ms: fewer decoded samples (160 at the 8 kHz peak rate) than buckets.
  const veryShort = p('very-short.wav');
  writeWav(veryShort, sine(960, 440, 48_000, 0.9), 48_000, 1);

  return {
    tone,
    mp3WithArt,
    flacWithArt,
    surround,
    mono8k,
    stereo96k,
    multiStream,
    videoWithAudio,
    noStreamDuration,
    truncatedMp3,
    truncatedFlac,
    silence,
    empty,
    overCap,
    overCapTruncated,
    vbrNoXing,
    quiet,
    trailingMarker,
    veryShort,
  };
}
