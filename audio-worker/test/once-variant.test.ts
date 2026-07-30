import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 18: the destination field follows the row's `variant`, and — the
 * load-bearing case the task brief names explicitly — a once-variant run
 * must never collide with an existing main rendition's storage key.
 *
 * A collision test needs a fixture where the main rendition ALREADY EXISTS,
 * or there's nothing for a collision to overwrite. This file therefore runs
 * `processAsset` for `variant: 'main'` FIRST (producing real PUTs at the
 * main rendition keys, with real bytes captured per key), then runs it
 * AGAIN for `variant: 'once'` on the SAME asset id, and asserts the bytes
 * recorded at the main keys after the first run are byte-for-byte identical
 * after the second — i.e. the once run never re-PUT the main keys.
 */
const hooks = vi.hoisted(() => ({
  // key -> the exact Buffer last PUT to it. A collision would show up here
  // as the main key's bytes changing between the two processAsset calls.
  puts: new Map<string, Buffer>(),
  putOrder: [] as string[],
  // Every key `downloadSource` GetObject'd, in order. Task 18 review
  // Important finding: the original "downloads the once-variant's own
  // source object" test didn't track this at all, so it passed even with
  // `effectiveSourceKey` hardcoded to the main `sourceKey` — the reviewer
  // confirmed that mutation left all 5 tests green. This is what makes the
  // assertion real.
  gets: [] as string[],
}));

vi.mock('@aws-sdk/client-s3', () => {
  class GetObjectCommand {
    constructor(public input: { Key: string }) {}
  }
  class PutObjectCommand {
    constructor(public input: { Key: string; Body: Buffer }) {}
  }
  class DeleteObjectCommand {
    constructor(public input: unknown) {}
  }
  class FakeS3Client {
    async send(cmd: unknown): Promise<unknown> {
      if (cmd instanceof GetObjectCommand) {
        hooks.gets.push(cmd.input.Key);
        return { ContentLength: 16, Body: Readable.from([Buffer.alloc(16)]) };
      }
      if (cmd instanceof PutObjectCommand) {
        hooks.puts.set(cmd.input.Key, Buffer.from(cmd.input.Body));
        hooks.putOrder.push(cmd.input.Key);
      }
      return {};
    }
  }
  return { S3Client: FakeS3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand };
});

// Each transcode call writes DIFFERENT bytes depending on which "run" of the
// test it belongs to, so a real overwrite (not just a same-content PUT that
// would pass a byte-comparison by accident) is detectable. Content is keyed
// off the output path's basename, which differs between the main run
// (out.opus/out.m4a written once) and... — see the two separate mkdtemp
// dirs `processAsset` uses internally per call, which already guarantees
// non-overlapping temp files. What must NOT overlap is the R2 KEY the two
// runs upload to, which is exactly what's under test.
let transcodeCounter = 0;
vi.mock('../src/ffmpeg.js', async () => {
  const actual = await vi.importActual<typeof import('../src/ffmpeg.js')>('../src/ffmpeg.js');
  return {
    ...actual,
    probe: vi.fn().mockResolvedValue({ durationMs: 1000, sampleRate: 44100, channels: 2 }),
    analyze: vi.fn().mockResolvedValue({ samples: 48_000, peakDb: -3 }),
    transcode: vi.fn(async (_src: string, out: string) => {
      transcodeCounter += 1;
      // Distinct content per invocation, so "same bytes at the main key
      // after both runs" is a real assertion, not a coincidence of both
      // legs writing identical zero-filled buffers.
      writeFileSync(out, Buffer.from(`run-${transcodeCounter}`.padEnd(32, '\0')));
    }),
  };
});

vi.mock('../src/peaks.js', () => ({ extractPeaks: vi.fn().mockResolvedValue([0.5, 0.5]) }));

import { processAsset } from '../src/process.js';
import { analyze, probe } from '../src/ffmpeg.js';
import { MAX_ATTEMPTS } from '../src/claim.js';

const WORKER = 'worker-once-variant';
const PREFIX_ROOT = 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/';
const FAKE_R2_ENV = {
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET: 'test-bucket',
  CDN_URL: 'https://cdn.example.test/',
};
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of Object.keys(FAKE_R2_ENV)) originalEnv[key] = process.env[key];
  Object.assign(process.env, FAKE_R2_ENV);
  const heartbeatPath = join(mkdtempSync(join(tmpdir(), 'cartyx-hb-')), 'beat');
  process.env.HEARTBEAT_FILE = heartbeatPath;
  hooks.puts.clear();
  hooks.putOrder = [];
  hooks.gets = [];
  transcodeCounter = 0;
});

afterEach(() => {
  for (const key of Object.keys(FAKE_R2_ENV)) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  delete process.env.HEARTBEAT_FILE;
});

describe('the destination field follows the row variant', () => {
  it('writes renditions (not onceRenditions) for a main-pipeline claim', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await processAsset(
      { updateOne } as never,
      { _id: 'asset-main', sourceKey: `${PREFIX_ROOT}x.wav`, attempts: 1 },
      WORKER
    );
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('ready');
    expect(update.$set.renditions).toBeDefined();
    expect(update.$set.onceRenditions).toBeUndefined();
    // The main write also carries the content-describing fields — proof
    // this is really the main branch, not just "no onceRenditions".
    expect(update.$set.durationMs).toBeDefined();
    expect(update.$set.durationSamples).toBeDefined();
  });

  it('writes onceRenditions (not renditions) for a once-variant claim, and resets variant to main', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await processAsset(
      { updateOne } as never,
      {
        _id: 'asset-once',
        sourceKey: `${PREFIX_ROOT}x.wav`,
        onceSourceKey: `${PREFIX_ROOT}y.wav`,
        variant: 'once',
        attempts: 1,
      },
      WORKER
    );
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('ready');
    expect(update.$set.onceRenditions).toBeDefined();
    // Not merely falsy — genuinely ABSENT from the $set, so a real MongoDB
    // $set leaves whatever `renditions` the row already had untouched. A
    // `renditions: undefined` key would still overwrite the field via $set.
    expect('renditions' in update.$set).toBe(false);
    // The main-describing fields must be equally absent, not just
    // `renditions` — an implementation that still recomputed and wrote
    // durationMs/peaks/etc from the ONCE source would corrupt the numbers
    // phase 2's gapless looping reads for the MAIN rendition.
    expect('durationMs' in update.$set).toBe(false);
    expect('durationSamples' in update.$set).toBe(false);
    expect('sampleRate' in update.$set).toBe(false);
    expect('channels' in update.$set).toBe(false);
    expect('peaks' in update.$set).toBe(false);
    expect(update.$set.variant).toBe('main');
  });

  it("downloads the once-variant's own source object, not the main sourceKey", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await processAsset(
      { updateOne } as never,
      {
        _id: 'asset-once-src',
        sourceKey: `${PREFIX_ROOT}main-source.wav`,
        onceSourceKey: `${PREFIX_ROOT}once-source.wav`,
        variant: 'once',
        attempts: 1,
      },
      WORKER
    );
    // Task 18 review Important fix: this now asserts the ACTUAL
    // GetObjectCommand key, not just that the run happened to succeed
    // (which it would have even downloading the wrong object, since the
    // fake client answers every GetObject identically). Exactly one
    // download, and it is the ONCE source — never the main one.
    expect(hooks.gets).toEqual([`${PREFIX_ROOT}once-source.wav`]);
    expect(hooks.gets).not.toContain(`${PREFIX_ROOT}main-source.wav`);
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('ready');
  });

  it('downloads the main sourceKey (not any onceSourceKey) for a main-pipeline claim', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await processAsset(
      { updateOne } as never,
      { _id: 'asset-main-src', sourceKey: `${PREFIX_ROOT}main-source.wav`, attempts: 1 },
      WORKER
    );
    expect(hooks.gets).toEqual([`${PREFIX_ROOT}main-source.wav`]);
  });

  /**
   * Task 18 review Critical 2 fix: this used to assert `status: 'failed'` +
   * `permanentFailure: true` — which, on a real row, is the MAIN asset
   * being bricked over a malformed once-attach row. Reverts to ready/main
   * instead, same as every other once-variant terminal failure; see the
   * `markOnceFailed` doc comment in process.ts.
   */
  it('reverts to ready/main (not failed) for a once-variant claim with no onceSourceKey, and never retries it', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await processAsset(
      { updateOne } as never,
      { _id: 'asset-once-no-key', sourceKey: `${PREFIX_ROOT}x.wav`, variant: 'once', attempts: 0 },
      WORKER
    );
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('ready');
    expect(update.$set.variant).toBe('main');
    expect(update.$set.onceLastError).toMatch(/onceSourceKey/);
    expect('permanentFailure' in update.$set).toBe(false);
    expect('lastError' in update.$set).toBe(false);
    expect(hooks.puts.size).toBe(0);
  });
});

/**
 * THE LOAD-BEARING CASE. A fixture where the asset has no existing main
 * rendition cannot detect a collision — every key is "new" either way. This
 * suite runs the MAIN pipeline first (real PUTs, real captured bytes), then
 * runs the ONCE pipeline for the same asset id, and proves the once run
 * never re-PUT the main keys.
 */
describe('a once-variant run does not collide with an existing main rendition', () => {
  it('writes the once-variant renditions to different keys and leaves the main rendition bytes untouched', async () => {
    const id = 'asset-collision';

    // Run 1: the ordinary main pipeline. Real PUTs land at
    // `<id>.opus`/`<id>.m4a`.
    const mainUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await processAsset(
      { updateOne: mainUpdateOne } as never,
      { _id: id, sourceKey: `${PREFIX_ROOT}x.wav`, attempts: 1 },
      WORKER
    );
    const mainKeys = [`${PREFIX_ROOT}renditions/${id}.opus`, `${PREFIX_ROOT}renditions/${id}.m4a`];
    for (const key of mainKeys) expect(hooks.puts.has(key)).toBe(true);
    const mainBytesAfterFirstRun = mainKeys.map((k) => Buffer.from(hooks.puts.get(k)!));

    // Run 2: attach a once-variant to the SAME asset id. If the worker
    // computed the once-variant's rendition key the same way as the main
    // one, this PUT would silently overwrite the bytes captured above.
    const onceUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await processAsset(
      { updateOne: onceUpdateOne } as never,
      {
        _id: id,
        sourceKey: `${PREFIX_ROOT}x.wav`,
        onceSourceKey: `${PREFIX_ROOT}y.wav`,
        variant: 'once',
        attempts: 1,
      },
      WORKER
    );

    // The once-variant landed at DIFFERENT keys...
    const onceKeys = [
      `${PREFIX_ROOT}renditions/${id}.once.opus`,
      `${PREFIX_ROOT}renditions/${id}.once.m4a`,
    ];
    for (const key of onceKeys) expect(hooks.puts.has(key)).toBe(true);
    for (const key of onceKeys) expect(mainKeys).not.toContain(key);

    // ...and the main keys' bytes are BYTE-FOR-BYTE identical to what run 1
    // wrote — the once run never re-PUT them. A same-key collision would
    // fail this: run 2's transcode mock writes different content
    // (`transcodeCounter` advances across the whole test), so a silent
    // overwrite is detectable, not masked by both runs writing the same
    // zero-filled buffer.
    mainKeys.forEach((key, i) => {
      expect(Buffer.from(hooks.puts.get(key)!).equals(mainBytesAfterFirstRun[i])).toBe(true);
    });

    // And the once PUTs never touched a main key at all — belt and braces
    // beyond the byte comparison above.
    const onceRunPutOrder = hooks.putOrder.slice(hooks.putOrder.length - 2);
    for (const key of onceRunPutOrder) expect(mainKeys).not.toContain(key);

    const [, onceUpdate] = onceUpdateOne.mock.calls[0];
    expect(onceUpdate.$set.onceRenditions.opus.key).toBe(onceKeys[0]);
    expect(onceUpdate.$set.onceRenditions.aac.key).toBe(onceKeys[1]);
  });
});

/**
 * Task 18 review Critical 2, fixed: a once-variant run must NEVER leave the
 * row `status: 'failed'` — reviewer-reported mechanism was feeding a
 * `PermanentError`-triggering once file (any of: over-cap length, zero
 * samples, digital silence, an incomplete rendition) and observing
 * `permanentFailure: true` land on what could be a perfectly good,
 * already-`ready` music asset, with `retryAudioAsset` then refusing the row
 * forever. These tests drive the REAL failure paths (a real thrown
 * `PermanentError` from `assertDecodedUsable`, and a real exhausted retry
 * budget), not a proxy assertion about `markOnceFailed` in isolation.
 */
describe('Critical 2 fix: a failed once-variant run reverts to ready, never failed', () => {
  it('reverts to ready/main on a PermanentError (digital silence), without permanentFailure or touching any main-describing field', async () => {
    // A REAL PermanentError, thrown by the real (unmocked) assertDecodedUsable
    // — only `analyze`'s result is faked, exactly as the rest of this file's
    // ffmpeg mock already does for the happy path.
    vi.mocked(analyze).mockResolvedValueOnce({ samples: 48_000, peakDb: Number.NEGATIVE_INFINITY });

    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await processAsset(
      { updateOne } as never,
      {
        _id: 'asset-once-permanent',
        sourceKey: `${PREFIX_ROOT}x.wav`,
        onceSourceKey: `${PREFIX_ROOT}silent-once.wav`,
        variant: 'once',
        attempts: 1,
      },
      WORKER
    );

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [, update] = updateOne.mock.calls[0];
    // The load-bearing assertion: NEVER 'failed'.
    expect(update.$set.status).toBe('ready');
    expect(update.$set.variant).toBe('main');
    expect(update.$set.onceLastError).toMatch(/silent/i);
    expect(update.$set.onceSourceKey).toBeNull();
    // permanentFailure is not merely false — it is ABSENT from the $set, so
    // a real MongoDB $set leaves whatever the row already had (always
    // `false`, since the asset was `ready` before this attach started)
    // completely untouched, exactly like the "leaves renditions untouched"
    // assertion elsewhere in this file.
    expect('permanentFailure' in update.$set).toBe(false);
    expect('lastError' in update.$set).toBe(false);
    expect('renditions' in update.$set).toBe(false);
    expect('onceRenditions' in update.$set).toBe(false);
    expect('durationMs' in update.$set).toBe(false);
    // Never reached a PUT at all — the rejection happens before transcode.
    expect(hooks.puts.size).toBe(0);
  });

  it('reverts to ready/main once a TRANSIENT once failure exhausts the retry budget, never landing on failed', async () => {
    vi.mocked(probe).mockRejectedValueOnce(new Error('simulated transient R2/ffmpeg blip'));

    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await processAsset(
      { updateOne } as never,
      {
        _id: 'asset-once-exhausted',
        sourceKey: `${PREFIX_ROOT}x.wav`,
        onceSourceKey: `${PREFIX_ROOT}flaky-once.wav`,
        variant: 'once',
        // At the cap: `attempts < MAX_ATTEMPTS` is false, so this is the
        // LAST word on the job, exactly the case that used to call
        // `markFailed` (non-permanent, but still `status: 'failed'`).
        attempts: MAX_ATTEMPTS,
      },
      WORKER
    );

    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('ready');
    expect(update.$set.variant).toBe('main');
    expect(update.$set.onceLastError).toMatch(/simulated transient/i);
    expect('permanentFailure' in update.$set).toBe(false);
    expect('renditions' in update.$set).toBe(false);
  });

  it('still retries a transient once failure WITHIN budget via the unchanged pending/backoff path', async () => {
    vi.mocked(probe).mockRejectedValueOnce(new Error('simulated transient blip'));

    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await processAsset(
      { updateOne } as never,
      {
        _id: 'asset-once-retry',
        sourceKey: `${PREFIX_ROOT}x.wav`,
        onceSourceKey: `${PREFIX_ROOT}flaky-once.wav`,
        variant: 'once',
        attempts: 1,
      },
      WORKER
    );

    const [, update] = updateOne.mock.calls[0];
    // Unchanged behaviour: still the normal backoff-and-retry path, not
    // `markOnceFailed` — a once job under budget resumes the SAME job on
    // its next claim, which is why `variant`/`onceSourceKey` must be
    // ABSENT from this $set (requeueForRetry never touches them).
    expect(update.$set.status).toBe('pending');
    expect(update.$set.nextAttemptAt).toBeInstanceOf(Date);
    expect('variant' in update.$set).toBe(false);
    expect('onceSourceKey' in update.$set).toBe(false);
    expect('onceLastError' in update.$set).toBe(false);
  });
});
