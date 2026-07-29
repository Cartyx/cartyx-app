import { describe, it, expect, beforeAll } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probe, transcode } from '../src/ffmpeg.js';
import { extractPeaks } from '../src/peaks.js';

const run = promisify(execFile);

let dir: string;
let src: string;

/** Probe an arbitrary file's codec name — used only to verify test OUTPUTS. */
async function probeCodec(path: string): Promise<string> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name',
    '-of',
    'json',
    path,
  ]);
  const parsed = JSON.parse(stdout) as { streams?: { codec_name?: string }[] };
  return parsed.streams?.[0]?.codec_name ?? '';
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'audio-worker-'));
  src = join(dir, 'tone.wav');
  // 2s 440Hz stereo tone — deterministic fixture, no binary in the repo.
  execFileSync(
    'ffmpeg',
    [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2:sample_rate=48000',
      '-ac',
      '2',
      '-y',
      src,
      // ffmpeg's version/config banner and per-frame progress line go to
      // stderr unconditionally at this verbosity; execFileSync inherits the
      // parent's stderr by default, so without this it leaks into the test
      // run's console output on every invocation. Silence it — the tests
      // assert on ffprobe/PCM output, not on console noise.
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );
});

describe('ffmpeg pipeline', () => {
  it('probes accurate duration, sample rate and channels', async () => {
    const meta = await probe(src);
    expect(meta.durationMs).toBeGreaterThan(1950);
    expect(meta.durationMs).toBeLessThan(2050);
    expect(meta.sampleRate).toBe(48000);
    expect(meta.channels).toBe(2);
  });

  it('produces a real opus rendition, not just a non-empty file', async () => {
    const out = join(dir, 'out.opus');
    await transcode(src, out, 'opus');
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(0);

    // A truncated file or a wrong-codec file would pass a bare
    // exists+non-empty check. Probing the output catches both: assert the
    // codec is really opus and the duration round-trips close to the source.
    expect(await probeCodec(out)).toBe('opus');
    const meta = await probe(out);
    expect(meta.durationMs).toBeGreaterThan(1800);
    expect(meta.durationMs).toBeLessThan(2200);
  });

  it('produces a real aac rendition, not just a non-empty file', async () => {
    const out = join(dir, 'out.m4a');
    await transcode(src, out, 'aac');
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(0);

    expect(await probeCodec(out)).toBe('aac');
    const meta = await probe(out);
    expect(meta.durationMs).toBeGreaterThan(1800);
    expect(meta.durationMs).toBeLessThan(2200);
  });

  it('extracts the requested number of peaks in 0..1', async () => {
    const peaks = await extractPeaks(src, 100);
    expect(peaks).toHaveLength(100);
    for (const p of peaks) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    // This ffmpeg build's `sine` lavfi source (no `amplitude` option exists
    // on it — verified via `ffmpeg -h filter=sine`) emits a fixed peak of
    // ~0.088 for this fixture, not full scale. Confirmed empirically against
    // the raw s16le PCM before wiring this assertion, so 0.05 is a real
    // signal-detection threshold, not a guess — well above the silence
    // floor (0) and comfortably below the measured ~0.088 peak.
    expect(Math.max(...peaks)).toBeGreaterThan(0.05);
  });

  it('extracts a silent buffer as all-zero peaks, not garbage', async () => {
    const silent = join(dir, 'silence.wav');
    execFileSync(
      'ffmpeg',
      ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1', '-y', silent],
      { stdio: ['ignore', 'ignore', 'ignore'] }
    );
    const peaks = await extractPeaks(silent, 20);
    expect(peaks).toHaveLength(20);
    for (const p of peaks) expect(p).toBe(0);
  });
});
