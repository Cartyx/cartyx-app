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

  /*
   * --- THE GAP-TIMELINE FAMILY: audio parked past a `-t` window ---
   *
   * `ffmpeg -f concat` honours a `duration` directive that is LONGER than the
   * clip it applies to, and the difference becomes a hole in the timeline that
   * carries no audio. Presentation timestamps run straight through it, so
   * bounding a decode with `-t` — which cuts at a TIMELINE POSITION — reads only
   * whatever happens to sit before the hole.
   *
   * Every byte here comes from stock ffmpeg. Nothing is hand-crafted, and the
   * `concat` demuxer is an ordinary tool a user could reach for by accident.
   *
   * Measured with ffmpeg 8.1.2 on `gapTimeline` (5 s clip, `duration 3000`,
   * 20 s clip — 288 kB):
   *
   *   -t 1801 (what round 6 bounded the measuring pass with)   241 203 samples (5.02 s)
   *   boundedDecodeFilters, atrim=end=1801                   1 202 406 samples (25.05 s)
   *
   * The file is 25 s long. A pipeline that measures it the first way and then
   * encodes it publishes a `ready` row claiming 5 s over 25 s of audio.
   *
   * Matroska also reports `stream=duration` as N/A, so these double as the
   * "container with no per-stream duration" case: nothing but a decode can
   * answer the question at all.
   */
  const gapClip = p('gap-clip.mp3');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=5:sample_rate=44100',
    '-ac',
    '2',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '64k',
    gapClip,
  ]);
  const gapBody = p('gap-body.mp3');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=20:c=white:r=44100:a=0.8',
    '-ac',
    '2',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '96k',
    gapBody,
  ]);

  /** Concatenate `clip`, a `gapSeconds` hole, then `body`, into a Matroska. */
  const gapConcat = (name: string, clip: string, body: string, gapSeconds: number): string => {
    const list = p(`${name}.txt`);
    // The concat demuxer resolves `file` entries relative to the LIST, and
    // `-safe 0` is required for absolute paths.
    writeFileSync(list, `file '${clip}'\nduration ${gapSeconds}\nfile '${body}'\n`);
    const out = p(`${name}.mka`);
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
    return out;
  };

  // 25 s of audio sitting behind a 3000 s hole: under the cap, so it must be
  // PUBLISHED, at 25 s and not at 5 s.
  const gapTimeline = gapConcat('gap-timeline', gapClip, gapBody, 3000);

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

  // `overCap`'s 31-minute header claim over only the first 40 kB of payload —
  // it decodes to ~40 s. It is therefore a 40-second file, and is PUBLISHED.
  // The pipeline used to reject it as over the cap on the strength of the claim
  // alone, and that is the same arithmetic that rejected honest 17-minute VBR
  // music: a header is not a length. What made judging it on the header look
  // necessary was the cost of decoding an hours-long source, and the bounded
  // decode (see `MEASURE_LIMIT_SECONDS`) removes that cost instead.
  const overCapTruncated = p('over-cap-truncated.mp3');
  truncate(overCap, overCapTruncated, 40_000 / readFileSync(overCap).length);

  // 31 minutes of audio parked behind the same 3000 s hole. Under a `-t` bound
  // this measures 5 s and is PUBLISHED at 5 s with 31-minute renditions; under
  // the decoded-sample bound it measures over the cap and is refused. This is
  // the fixture that separates the two bounds on the OUTCOME and not just on
  // the number.
  //
  // Its body is built at gapClip's OWN rate and layout (44.1 kHz stereo) rather
  // than reusing `overCap`, which is 8 kHz mono. That is not tidiness: joining
  // two different formats makes ffmpeg rebuild the filter graph, so the old
  // fixture was over the cap AND multi-format at once, and once
  // `assertDecodedUsable` learned to refuse multi-format sources it was refused
  // for that instead — leaving the over-cap-behind-a-gap path, the thing this
  // fixture exists for, asserted by nothing. One property per fixture.
  const gapOverCapBody = p('gap-over-cap-body.mp3');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:duration=1860:sample_rate=44100',
    '-ac',
    '2',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '32k',
    gapOverCapBody,
  ]);
  const gapOverCap = gapConcat('gap-over-cap', gapClip, gapOverCapBody, 3000);

  /*
   * A source that changes SAMPLE RATE AND CHANNEL LAYOUT part way through: a
   * raw concatenation of a 3 s 44.1 kHz stereo MP3 and a 4 s 8 kHz mono one.
   *
   * ffmpeg rebuilds the entire filter graph at the change, which re-instantiates
   * every filter in it. Two consequences, and the pipeline has to survive both:
   *
   * - `astats` reports PER SEGMENT. Reading the last report called this 7.12 s
   *   file 4.10 s. `analyze` sums them.
   * - `asetpts`/`atrim` RESET, so the bound is per segment rather than per file.
   *   Sound only because the summed measurement is then over the cap and the
   *   source is refused; see `analyze`'s comment for the argument.
   *
   * It also renders SHORT — the teardown discards `loudnorm`'s 3-second
   * lookahead, so 7.12 s measured comes out 4.21 s rendered — which is what
   * `assertRenditionComplete` is for. The file must FAIL, not publish.
   */
  const rateA = p('rate-a.mp3');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3:sample_rate=44100',
    '-ac',
    '2',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    rateA,
  ]);
  const rateB = p('rate-b.mp3');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=4:sample_rate=8000',
    '-ac',
    '1',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '32k',
    rateB,
  ]);
  const multiRate = p('multi-rate.mp3');
  writeFileSync(multiRate, Buffer.concat([readFileSync(rateA), readFileSync(rateB)]));

  /*
   * THE SAME SHAPE, THIRTY TIMES OVER — the fixture that made the filter
   * prefix's own failure mode visible.
   *
   * Thirty 2 s segments alternating 44.1 kHz and 32 kHz, raw-concatenated, so
   * ffmpeg rebuilds the filter graph twenty-nine times in one file. `multiRate`
   * above rebuilds it twice and hides what that costs; the cost is per output
   * FRAME, so only a file with many rebuilds and real length shows it.
   *
   * With the previous prefix (`asetpts=N/SR/TB,atrim=end=<limit>`) each rebuild
   * restarted `asetpts`'s sample counter, so the timestamps handed to the
   * `-f null -` muxer jumped backwards and ffmpeg emitted one
   * "non monotonically increasing dts" warning per frame until they caught up.
   * `analyze` is the only stage running at `-v info`, so it was the only one
   * that collected them. Measured on a 60 s version of this file (thirty 60 s
   * segments, 7.2 MB):
   *
   *   asetpts=N/SR/TB,atrim=end=1801      7 140 647 B of stderr, 57 191 warnings
   *   atrim=end_sample=86 448 000            13 908 B of stderr,      0 warnings
   *
   * At 8 MiB — `FFMPEG_STDERR_MAX_BYTES` — the first overflows `execFile`'s
   * buffer and the asset fails on `stderr maxBuffer length exceeded`: an opaque
   * message, three times over, on a row the UI offered a Retry button for.
   *
   * Kept SHORT (2 s segments) because the property under test is the rebuild
   * COUNT, not the duration; the byte volumes above were measured on the long
   * version and do not need to be paid on every push. It must FAIL, permanently,
   * naming its format changes — and it must do so from `analyze`'s measurement,
   * before either encoder runs.
   */
  const manySegments = p('many-segments.mp3');
  {
    const parts: Buffer[] = [];
    for (let i = 0; i < 30; i++) {
      const seg = p(`seg-${i}.mp3`);
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${300 + i * 10}:duration=2:sample_rate=${i % 2 === 0 ? 44100 : 32000}`,
        '-ac',
        '2',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '32k',
        seg,
      ]);
      parts.push(readFileSync(seg));
    }
    writeFileSync(manySegments, Buffer.concat(parts));
  }

  /*
   * THE FIXTURE THAT KILLS THE HEADER PRE-GATE.
   *
   * An honest, complete, in-cap MP3, ONE audio format end to end, whose
   * `format=duration` claims FOUR AND A HALF TIMES the cap.
   *
   * 2 s at 8 kbit/s followed by 400 s at 160 kbit/s, both 24 kHz mono — MPEG-2
   * Layer III, whose bitrate range at that sample rate is 8 to 160 kbit/s.
   * ffmpeg reads the first frame's 8 kbit/s and extrapolates the whole 8.0 MB
   * across it, so the claim is 8003 s while the file is 402 s. Measured with
   * ffmpeg 8.1.2:
   *
   *   stream=duration / format=duration    8 003 229 ms   (2h 13m, 4.45x the cap)
   *   decoded                              19 300 608 samples = 402 096 ms
   *
   * THIS IS WHY THERE IS NO HEADER PRE-GATE. The tempting rule is "reject when
   * the header claims something absurd — several times the cap — since
   * over-reports only inflate, so it cannot false-positive". The over-report
   * factor is `avg_bitrate / first_frame_bitrate`, which does not depend on the
   * file's LENGTH at all, so "absurd" is not a property a threshold can
   * separate: this honest 6.7-minute file claims 4.45x the cap, while the
   * hostile gap-timeline Matroska the bound actually exists for claims 4000 s,
   * i.e. 2.2x. Any threshold low enough to catch the second permanently rejects
   * the first, and permanently rejecting complete ordinary MP3s on a header
   * arithmetic is round 5's defect exactly.
   *
   * `-write_xing 0` on both halves: a Xing/VBRI frame carries a real frame
   * count, and its presence is precisely what stops ffmpeg extrapolating.
   */
  const claimIntro = p('claim-intro.mp3');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=200:duration=2:sample_rate=24000',
    '-ac',
    '1',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '8k',
    '-write_xing',
    '0',
    claimIntro,
  ]);
  const claimBody = p('claim-body.mp3');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=400:c=white:r=24000:a=0.8',
    '-ac',
    '1',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '160k',
    '-write_xing',
    '0',
    claimBody,
  ]);
  const absurdHeaderClaim = p('absurd-header-claim.mp3');
  writeFileSync(
    absurdHeaderClaim,
    Buffer.concat([readFileSync(claimIntro), readFileSync(claimBody)])
  );

  // --- container shapes the pipeline had never been driven with ---

  // Raw ADTS AAC: no container at all, just a frame stream. No `stream=duration`
  // worth the name, and the encoder delay/padding a real AAC decoder applies is
  // exactly the kind of thing a millisecond-level duration comparison trips on.
  const adtsAac = p('adts.aac');
  ffmpeg(['-i', tone, '-c:a', 'aac', '-f', 'adts', adtsAac]);

  // Ogg/Opus: a source already in one of the two output codecs, at Opus's own
  // 48 kHz, with its own pre-skip.
  const oggOpus = p('source.opus');
  ffmpeg(['-i', tone, '-c:a', 'libopus', '-f', 'ogg', oggOpus]);

  // --- sources that must NOT be rejected ---

  /*
   * THE SHAPE THAT MATTERS.
   *
   * ffmpeg does not measure an MP3 with no Xing/VBRI header — it divides the
   * file size by the FIRST FRAME's bitrate, so the reported duration is wrong
   * by `avg_bitrate / first_frame_bitrate` and that ratio is bounded only by
   * the format (8 kbit/s to 320 kbit/s, i.e. up to 40x).
   *
   * The suite already had a VBR-no-Xing fixture (`vbrNoXing` below) and it
   * passed every check, because its shape is 5 s of quiet followed by 1 s of
   * loud — the arrangement that MINIMISES the ratio, giving a mild 12%
   * over-report. Real music is the inverse: a short quiet intro and a long loud
   * body. That inversion is the entire difference between a fixture that
   * catches the bug and one that certifies it, and the truncation detector
   * shipped rejecting ordinary MP3s because the suite only had the latter.
   *
   * Measured with ffmpeg 8.1.2 (`stream=duration` vs the decoded sample count):
   *
   *   quietIntroVbr    10 554 ms claimed   5 042 ms real   (109% over)
   *   concatBitrate    82 506 ms claimed  10 057 ms real   (8.2x over)
   *   vbrNoXing         6 778 ms claimed   6 034 ms real   ( 12% over)
   *
   * Against the old rule — reject when the rendition falls more than
   * `max(500, claimed * 0.25)` ms short of the CLAIM — the first two are
   * permanently rejected as "truncated" (shortfall 5512 vs allowance 2639, and
   * 72 449 vs 20 626) while the third passes with room to spare. All three are
   * complete, valid, ordinary files.
   */
  const vbrIntro = p('vbr-intro.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '1', vbrIntro]);
  const vbrBody = p('vbr-body.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=d=4:c=white:r=44100:a=0.8', '-ac', '2', vbrBody]);
  const quietIntroSrc = p('quiet-intro-src.wav');
  ffmpeg([
    '-i',
    vbrIntro,
    '-i',
    vbrBody,
    '-filter_complex',
    '[0:a][1:a]concat=n=2:v=0:a=1',
    quietIntroSrc,
  ]);
  const quietIntroVbr = p('quiet-intro-vbr.mp3');
  ffmpeg([
    '-i',
    quietIntroSrc,
    '-c:a',
    'libmp3lame',
    '-q:a',
    '0',
    '-write_xing',
    '0',
    quietIntroVbr,
  ]);

  // Two CBR segments at wildly different bitrates, concatenated — which for MP3
  // is a legitimate file (the format is a bare frame stream, and joining a
  // low-bitrate intro stinger onto a high-bitrate body is exactly what
  // `cat`-style editors and many podcast tools emit). ffmpeg reads the 32 kbit/s
  // first frame and extrapolates the whole 330 kB across it.
  const segLo = p('seg-lo.mp3');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=200:duration=2:sample_rate=44100',
    '-ac',
    '2',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '32k',
    '-write_xing',
    '0',
    segLo,
  ]);
  const segHi = p('seg-hi.mp3');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=8:c=white:r=44100:a=0.8',
    '-ac',
    '2',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '320k',
    '-write_xing',
    '0',
    segHi,
  ]);
  const concatBitrate = p('concat-bitrate.mp3');
  writeFileSync(concatBitrate, Buffer.concat([readFileSync(segLo), readFileSync(segHi)]));

  // The mild case, kept as the control: same defect, arranged so it barely
  // shows. 5 s quiet then 1 s loud — a 12% over-report the old rule survived,
  // which is why it certified the rule as safe.
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
    gapTimeline,
    gapOverCap,
    multiRate,
    manySegments,
    absurdHeaderClaim,
    adtsAac,
    oggOpus,
    vbrNoXing,
    quietIntroVbr,
    concatBitrate,
    quiet,
    trailingMarker,
    veryShort,
  };
}
