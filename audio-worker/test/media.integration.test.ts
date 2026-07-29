import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probe, analyze, transcode, RENDITION_SAMPLE_RATE } from '../src/ffmpeg.js';
import { extractPeaks } from '../src/peaks.js';
import { buildFixtures, type Fixtures } from './fixtures.js';

const run = promisify(execFile);

/**
 * R2 stands in for a directory of real files: `GetObject` streams whichever
 * fixture the current test points at, and every `PutObject` is recorded so the
 * assertions can inspect the bytes the pipeline actually published.
 *
 * Everything else in `processAsset` — ffprobe, ffmpeg, loudnorm, the peak
 * decode — runs for real. Mocking those would test the mock.
 */
const s3 = vi.hoisted(() => ({
  sourcePath: '',
  puts: [] as { Key: string; Body: Buffer; ContentType: string }[],
}));

vi.mock('@aws-sdk/client-s3', () => {
  class GetObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class PutObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class DeleteObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class FakeS3Client {
    async send(command: GetObjectCommand | PutObjectCommand): Promise<unknown> {
      if (command instanceof GetObjectCommand) {
        const { createReadStream, statSync } = await import('node:fs');
        // A real stream with a real ContentLength: the worker streams the
        // source to disk under a size cap rather than buffering it.
        return {
          ContentLength: statSync(s3.sourcePath).size,
          Body: createReadStream(s3.sourcePath),
        };
      }
      const input = command.input as { Key: string; Body: Buffer; ContentType: string };
      s3.puts.push({ Key: input.Key, Body: input.Body, ContentType: input.ContentType });
      return {};
    }
  }
  return { S3Client: FakeS3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand };
});

const { processAsset, DECODE_LIMIT_SECONDS, MAX_SOURCE_DURATION_MS } =
  await import('../src/process.js');

let dir: string;
let fx: Fixtures;

const R2_ENV = {
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET: 'test-bucket',
  CDN_URL: 'https://cdn.example.test',
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'audio-media-'));
  fx = buildFixtures(dir);
  Object.assign(process.env, R2_ENV);
}, 60_000);

afterAll(() => {
  for (const key of Object.keys(R2_ENV)) delete process.env[key];
  rmSync(dir, { recursive: true, force: true });
});

/** Read a rendition's real stream properties — used only to check OUTPUTS. */
async function streamInfo(
  path: string
): Promise<{ codec: string; sampleRate: number; channels: number }> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name,sample_rate,channels',
    '-of',
    'json',
    path,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: { codec_name?: string; sample_rate?: string; channels?: number }[];
  };
  const s = parsed.streams?.[0] ?? {};
  return {
    codec: s.codec_name ?? '',
    sampleRate: Number(s.sample_rate ?? 0),
    channels: Number(s.channels ?? 0),
  };
}

type Written = Record<string, unknown>;

/** Run the whole pipeline against a fixture and return what it wrote to Mongo. */
async function processFixture(
  sourcePath: string,
  attempts = 0
): Promise<{ written: Written; puts: typeof s3.puts }> {
  s3.sourcePath = sourcePath;
  s3.puts = [];
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  await processAsset(
    { updateOne },
    { _id: 'asset-1', sourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/x', attempts },
    'worker-media-test'
  );
  expect(updateOne).toHaveBeenCalledTimes(1);
  const [, update] = updateOne.mock.calls[0] as unknown as [
    unknown,
    { $set: Record<string, unknown> },
  ];
  return { written: update.$set, puts: s3.puts };
}

describe('transcode produces 48 kHz stereo in both codecs, whatever the source is', () => {
  /**
   * Each of these sources breaks a DIFFERENT assumption the pipeline made:
   *
   * - `mp3WithArt` / `flacWithArt`: an embedded cover reaches the M4A muxer and
   *   the AAC leg dies (`Could not find tag for codec h264`, exit 234, 0 bytes).
   *   Since both legs are required, that discards the good Opus leg too. This
   *   is what most real music files look like.
   * - `surround`: 5.1 passed straight through as 6 channels sharing one
   *   bitrate (measured 134.9 kbit/s total, ~22 kbit/s per channel).
   * - `tone` / `mono8k` / `stereo96k`: loudnorm emits 192 kHz and the aac
   *   encoder clamps it to 96 kHz, so EVERY AAC rendition was 96 kHz — even
   *   from a plain 48 kHz source.
   */
  const cases = ['tone', 'mp3WithArt', 'flacWithArt', 'surround', 'mono8k', 'stereo96k'] as const;

  for (const name of cases) {
    for (const codec of ['opus', 'aac'] as const) {
      it(`${name} -> ${codec}`, async () => {
        const out = join(dir, `out-${name}.${codec === 'opus' ? 'opus' : 'm4a'}`);
        await transcode(fx[name], out, codec);

        const info = await streamInfo(out);
        expect(info.codec).toBe(codec);
        expect(info.sampleRate).toBe(RENDITION_SAMPLE_RATE);
        expect(info.channels).toBe(2);
        expect(readFileSync(out).length).toBeGreaterThan(0);

        // The audio survived, not just the container.
        const meta = await probe(out);
        expect(meta.durationMs).toBeGreaterThan(1800);
        expect(meta.durationMs).toBeLessThan(2200);
      }, 30_000);
    }
  }
});

describe('probe reads the audio stream, not the container', () => {
  it('reports the a:0 length of a two-audio-stream M4A, not the longest stream', async () => {
    // format.duration is 8000 ms here (the second stream); a:0 is 2000 ms.
    const meta = await probe(fx.multiStream);
    expect(meta.durationMs).toBeGreaterThan(1900);
    expect(meta.durationMs).toBeLessThan(2100);
  });

  it('reports the audio length of a video-plus-audio MP4, not the video length', async () => {
    // format.duration is 10 000 ms (the video); the audio track is 3000 ms.
    const meta = await probe(fx.videoWithAudio);
    expect(meta.durationMs).toBeGreaterThan(2900);
    expect(meta.durationMs).toBeLessThan(3100);
  });

  it('falls back to the format duration when the container carries no stream duration', async () => {
    // Matroska reports `stream=duration` as N/A; without the fallback this
    // would be 0 and every downstream duration check would misfire.
    const meta = await probe(fx.noStreamDuration);
    expect(meta.durationMs).toBeGreaterThan(1900);
    expect(meta.durationMs).toBeLessThan(2100);
  });
});

describe('analyze reports what the file decodes to', () => {
  it('counts samples exactly, at the rendition rate', async () => {
    const decoded = await analyze(fx.tone);
    // 2 s at 48 kHz. Exact — this is the number phase 2 loops on.
    expect(decoded.samples).toBe(96_000);
    expect(Number.isFinite(decoded.peakDb)).toBe(true);
  });

  it('reports -Infinity for a file that is digital silence end to end', async () => {
    const decoded = await analyze(fx.silence);
    expect(decoded.peakDb).toBe(Number.NEGATIVE_INFINITY);
    expect(decoded.samples).toBeGreaterThan(0);
  });

  it('reports zero samples for a header-only WAV', async () => {
    const decoded = await analyze(fx.empty);
    expect(decoded.samples).toBe(0);
  });

  it('sees a truncated MP3 as its real length, not its header length', async () => {
    const claimed = await probe(fx.truncatedMp3);
    const decoded = await analyze(fx.truncatedMp3);
    expect(claimed.durationMs).toBeGreaterThan(1900);
    // ~793 ms of actual audio behind a header that claims 2000.
    expect(decoded.samples / 48).toBeLessThan(1000);
  });
});

describe('extractPeaks covers the whole file', () => {
  it('represents the final samples instead of dropping samples % buckets', async () => {
    // 16 399 samples at 8 kHz whose last 400 are full scale. A fixed
    // `floor(samples / buckets)` stride covers only 16 000 of them, so the
    // marker is invisible: measured peak 0.3308 instead of 0.9766.
    const peaks = await extractPeaks(fx.trailingMarker, 400);
    expect(peaks).toHaveLength(400);
    expect(Math.max(...peaks)).toBeGreaterThan(0.9);
    expect(peaks[peaks.length - 1]).toBeGreaterThan(0.9);
  });

  it('fills every bucket when there are fewer samples than buckets', async () => {
    // 20 ms -> 160 samples at the 8 kHz peak rate. With a clamped stride only
    // the first 159 buckets were ever written and the waveform stopped 40% of
    // the way across, flat for the rest.
    const peaks = await extractPeaks(fx.veryShort, 400);
    expect(peaks).toHaveLength(400);
    expect(peaks.filter((p) => p > 0).length).toBeGreaterThan(390);
    expect(peaks[399]).toBeGreaterThan(0);
  });
});

describe('processAsset end to end', () => {
  it('publishes a sample-exact duration alongside the millisecond one', async () => {
    const { written } = await processFixture(fx.tone);
    expect(written.status).toBe('ready');
    expect(written.durationSamples).toBe(96_000);
    expect(written.durationMs).toBe(2000);
    expect(written.permanentFailure).toBe(false);
  }, 30_000);

  it('derives durationSamples from the decode, not from the rounded milliseconds', async () => {
    // The Matroska/Opus source's container duration is 2008 ms, so a
    // `durationMs * 48` derivation yields 96 384 samples. The file really
    // decodes to 96 000. That 384-sample gap is an audible tick on every loop
    // repeat, which is the whole reason this field exists.
    const { written } = await processFixture(fx.noStreamDuration);
    expect(written.status).toBe('ready');
    expect(written.durationSamples).toBe(96_000);
  }, 30_000);

  it('publishes both renditions for a source carrying cover art', async () => {
    const { written, puts } = await processFixture(fx.mp3WithArt);
    expect(written.status).toBe('ready');
    const renditions = written.renditions as Record<string, { key: string; bytes: number }>;
    expect(renditions.opus.bytes).toBeGreaterThan(0);
    expect(renditions.aac.bytes).toBeGreaterThan(0);
    expect(puts).toHaveLength(2);
    for (const put of puts) expect(put.Body.length).toBeGreaterThan(0);
  }, 30_000);

  it('draws the waveform from the normalized rendition, not the raw source', async () => {
    // A -69 dBFS source. Peaks taken from the source measured 0.0001 — a flat
    // line — for an asset that plays back near full scale after loudnorm. The
    // waveform is the only visual affordance for picking a sound mid-session,
    // so the loudest asset in the library rendered as silence.
    const { written } = await processFixture(fx.quiet);
    expect(written.status).toBe('ready');
    const peaks = written.peaks as number[];
    expect(peaks).toHaveLength(400);
    expect(Math.max(...peaks)).toBeGreaterThan(0.5);
  }, 30_000);

  /**
   * THE SHIP-STOPPER, on real files.
   *
   * `probe()` does not measure an MP3 without a Xing header, it extrapolates
   * from the first frame's bitrate — so a quiet intro or a joined-in
   * low-bitrate segment makes it over-report without bound. Comparing a
   * rendition against that number rejected complete, ordinary music
   * PERMANENTLY: `permanentFailure: true`, which `retryAudioAsset` refuses, so
   * the owner's only recourse was to re-encode the file outside the product.
   *
   * Each case asserts the file is published AND that the old rule really did
   * reject it — a regression test that cannot itself regress into vacuity.
   */
  const overReporting: [string, keyof Fixtures][] = [
    ['a 1 s quiet intro before a loud body (109% over-report)', 'quietIntroVbr'],
    ['a 32 kbit/s segment joined to a 320 kbit/s one (8.2x over-report)', 'concatBitrate'],
    ['the mild 12% over-report the old fixture had', 'vbrNoXing'],
  ];

  for (const [label, fixture] of overReporting) {
    it(`publishes a complete VBR MP3 with ${label}`, async () => {
      const claimedMs = (await probe(fx[fixture])).durationMs;
      const decodedMs = Math.round((await analyze(fx[fixture])).samples / 48);

      const { written } = await processFixture(fx[fixture]);
      expect(written.status).toBe('ready');
      expect(written.permanentFailure).toBe(false);
      // The published length is the DECODED one, not the claim.
      expect(written.durationMs).toBe(decodedMs);
      expect(written.durationSamples).toBe((await analyze(fx[fixture])).samples);

      // And the header really was unusable: for the first two, the old rule
      // (`claimed - rendition > max(500, claimed * 0.25)`) rejected them.
      if (fixture !== 'vbrNoXing') {
        expect(claimedMs - decodedMs).toBeGreaterThan(Math.max(500, claimedMs * 0.25));
      }
    }, 60_000);
  }

  it('rejects a source for being too long on the decode, not on the header', async () => {
    // `overCap` is a genuine 31-minute file: header and decode agree.
    const { written } = await processFixture(fx.overCap, 0);
    expect(written.status).toBe('failed');
    expect(written.permanentFailure).toBe(true);
    expect(written.lastError).toMatch(/30 minute limit/i);
  }, 120_000);

  it('publishes a file whose header claims 31 minutes but which is really 40 s', async () => {
    // `overCapTruncated` carries `overCap`'s 1 860 000 ms header claim over
    // ~40 s of payload. The old pipeline rejected it as over the cap on that
    // claim alone. A claim is not a length: this file is 40 seconds long, and
    // the same header arithmetic that rejected it here is what rejected honest
    // 17-minute VBR music. The decode is bounded (see DECODE_LIMIT_SECONDS), so
    // asking the file rather than its header costs nothing.
    const { written } = await processFixture(fx.overCapTruncated);
    expect(written.status).toBe('ready');
    expect(written.durationMs).toBeGreaterThan(30_000);
    expect(written.durationMs).toBeLessThan(60_000);
  }, 60_000);

  it('bounds the decode so an hours-long source cannot amplify into a stall', async () => {
    // The bound is what lets the cap be decided on a measurement instead of on
    // a header. `overCap` is 31 minutes; a decode limited to 30 min + 1 s reads
    // strictly less of it than an unlimited one, and still enough to fail it.
    const bounded = await analyze(fx.overCap, DECODE_LIMIT_SECONDS);
    const full = await analyze(fx.overCap);
    expect(bounded.samples).toBeLessThan(full.samples);
    expect(bounded.samples).toBeGreaterThan((MAX_SOURCE_DURATION_MS / 1000) * 48_000);
  }, 120_000);

  it.each(['truncatedMp3', 'truncatedFlac'] as const)(
    'publishes %s with its real length rather than its header claim',
    async (fixture) => {
      // A half-transferred upload is no longer a permanent rejection, because
      // detecting one means trusting the header and the header is an
      // extrapolation. What A10 actually complained of — a `ready` row whose
      // recorded duration came from the header while its audio did not — is
      // closed here instead: both durations come from the decode, so the row is
      // honest about being short and the owner can see it and re-upload.
      const claimedMs = (await probe(fx[fixture])).durationMs;
      const { written } = await processFixture(fx[fixture]);
      expect(written.status).toBe('ready');
      expect(claimedMs).toBeGreaterThan(1900);
      expect(written.durationMs).toBeLessThan(1000);
    },
    60_000
  );

  /**
   * The permanent-failure cases. `attempts: 0` throughout: a retryable error at
   * that attempt count goes to `pending`, so `status: 'failed'` here is what
   * proves the retry budget was skipped, and `permanentFailure: true` is what
   * stops `retryAudioAsset` from handing the same poison file back to the
   * worker on a button click.
   */
  const rejections: [string, keyof Fixtures, RegExp][] = [
    ['a wholly silent source', 'silence', /completely silent/i],
    ['a WAV with no samples at all', 'empty', /no audio samples/i],
  ];

  for (const [label, fixture, message] of rejections) {
    it(`fails ${label} permanently, without consuming a retry`, async () => {
      const { written, puts } = await processFixture(fx[fixture], 0);
      expect(written.status).toBe('failed');
      expect(written.permanentFailure).toBe(true);
      expect(written.lastError).toMatch(message);
      // A readable sentence, not a leaked command line.
      expect(written.lastError).not.toMatch(/Command failed|ffmpeg -v error/);
      // Nothing was published: a rejected source must not leave renditions in
      // R2 for an asset that will never be `ready`.
      expect(puts).toHaveLength(0);
    }, 60_000);
  }
});
