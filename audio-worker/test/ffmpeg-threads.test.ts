import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, transcode } from '../src/ffmpeg.js';
import { extractPeaks } from '../src/peaks.js';
import { MEASURE_LIMIT_SECONDS, RENDER_LIMIT_SECONDS } from '../src/config.js';

/**
 * Every decoding stage must pin ffmpeg's thread pools to 1 — see `SINGLE_THREAD`
 * in ffmpeg.ts for why (ffmpeg sizes its pools from `nproc` = 36 while the pod's
 * cgroup quota is 1 CPU, a measured 3x penalty: aac 205s vs 69s in-pod).
 *
 * ASSERTED ON THE ARGV THAT ACTUALLY REACHES THE PROCESS, not on the exported
 * constant and not on the source text. A constant nobody splices in, or one
 * spliced into three call sites out of four, satisfies every cheaper form of
 * this check while the deployed worker still opens 36 threads. So this test
 * puts a recording `ffmpeg` shim first on `PATH` and lets the real code spawn
 * it: what lands in the log is exactly what the kernel would have been handed.
 *
 * The POSITIONS are asserted separately because they are separate thread pools
 * and each one alone leaves the other at `nproc`. Measured with `ps -M` on a
 * live transcode: an mp3 source runs 21 threads by default and 6 with the
 * output-side flag alone — which is why an mp3-only fixture would call the
 * one-sided version fixed — while a flac source runs 22 with the output-side
 * flag alone and only drops to 6 once the input-side flag is there too.
 */

let dir: string;
let log: string;

/** One recorded invocation: its argv, in order. */
function invocations(): string[][] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\u001f').slice(0, -1));
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'audio-worker-threads-'));
  log = join(dir, 'argv.log');

  // A stand-in for ffmpeg that records its argv and exits 0. Arguments are
  // written unit-separator delimited, one invocation per line — no ffmpeg
  // argument this worker builds contains \x1f or a newline.
  const shim = join(dir, 'ffmpeg');
  writeFileSync(
    shim,
    '#!/bin/sh\n' +
      '{ for a in "$@"; do printf \'%s\\037\' "$a"; done; printf \'\\n\'; } >> "$FFMPEG_ARGV_LOG"\n' +
      'exit 0\n',
    { mode: 0o755 }
  );

  process.env.FFMPEG_ARGV_LOG = log;
  process.env.PATH = `${dir}:${process.env.PATH ?? ''}`;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(log, { force: true });
});

/**
 * `-threads 1` before the input (the decoder's pool) and again after it (the
 * filter/encoder pool). `-i` is the divider: ffmpeg reads options positionally,
 * so the same flag means a different pool on each side of it.
 */
function expectBothPoolsPinned(argv: string[]): void {
  const input = argv.indexOf('-i');
  expect(input).toBeGreaterThan(-1);

  const pinned = argv
    .map((arg, i) => (arg === '-threads' && argv[i + 1] === '1' ? i : -1))
    .filter((i) => i !== -1);

  expect(pinned.filter((i) => i < input)).toHaveLength(1);
  expect(pinned.filter((i) => i > input)).toHaveLength(1);
}

describe('every decoding ffmpeg invocation pins both thread pools', () => {
  it('pins them in analyze()', async () => {
    await analyze(join(dir, 'src.mp3'), MEASURE_LIMIT_SECONDS);
    const calls = invocations();
    expect(calls).toHaveLength(1);
    expectBothPoolsPinned(calls[0]);
  });

  it.each(['opus', 'aac'] as const)('pins them in the %s transcode leg', async (codec) => {
    await transcode(join(dir, 'src.mp3'), join(dir, `out.${codec}`), codec, RENDER_LIMIT_SECONDS);
    const calls = invocations();
    expect(calls).toHaveLength(1);
    expectBothPoolsPinned(calls[0]);
  });

  it('pins them in extractPeaks()', async () => {
    await extractPeaks(join(dir, 'rendition.opus'), 10, RENDER_LIMIT_SECONDS);
    const calls = invocations();
    expect(calls).toHaveLength(1);
    expectBothPoolsPinned(calls[0]);
  });

  /**
   * The flag has to survive contact with a real ffmpeg, not just the shim: a
   * misplaced `-threads` is a hard "Option not found" exit, and a shim that
   * exits 0 on anything would never notice. The integration suite transcodes
   * for real through the same code path, so this only needs to prove the
   * argument list is accepted at the position the shim recorded it in.
   */
  it('builds argv the real ffmpeg accepts', async () => {
    const path = process.env.PATH;
    process.env.PATH = (path ?? '').split(':').slice(1).join(':');
    try {
      // A nonexistent input fails at open, AFTER option parsing — so a rejected
      // option produces a different message, and that is the discrimination.
      await expect(
        transcode(join(dir, 'nope.wav'), join(dir, 'x.opus'), 'opus', 5)
      ).rejects.toThrow(/No such file or directory/);
    } finally {
      process.env.PATH = path;
    }
  });
});
