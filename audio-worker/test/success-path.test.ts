import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The success path, with ffmpeg and R2 stubbed out, so the two things that only
 * happen on a successful run can be asserted: the `ready` write is fenced on
 * this worker's claim (B3), and the loop leaves a heartbeat behind (B7).
 */
const hooks = vi.hoisted(() => ({ puts: [] as unknown[] }));

vi.mock('@aws-sdk/client-s3', () => {
  class GetObjectCommand {
    constructor(public input: unknown) {}
  }
  class PutObjectCommand {
    constructor(public input: unknown) {}
  }
  class DeleteObjectCommand {
    constructor(public input: unknown) {}
  }
  class FakeS3Client {
    async send(cmd: unknown): Promise<unknown> {
      if (cmd instanceof GetObjectCommand) {
        return { ContentLength: 16, Body: Readable.from([Buffer.alloc(16)]) };
      }
      hooks.puts.push(cmd);
      return {};
    }
  }
  return { S3Client: FakeS3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand };
});

vi.mock('../src/ffmpeg.js', async () => {
  const actual = await vi.importActual<typeof import('../src/ffmpeg.js')>('../src/ffmpeg.js');
  return {
    ...actual,
    probe: vi.fn().mockResolvedValue({ durationMs: 1000, sampleRate: 44100, channels: 2 }),
    analyze: vi.fn().mockResolvedValue({ samples: 48_000, peakDb: -3 }),
    // The real transcode writes the rendition; the upload step reads it back.
    transcode: vi.fn(async (_src: string, out: string) => {
      writeFileSync(out, Buffer.alloc(32));
    }),
  };
});

vi.mock('../src/peaks.js', () => ({ extractPeaks: vi.fn().mockResolvedValue([0.5, 0.5]) }));

import { processAsset } from '../src/process.js';

const WORKER = 'worker-success';
/** The owner's storage namespace; every key this run touches lives under it. */
const PREFIX_ROOT = 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/';
const FAKE_R2_ENV = {
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET: 'test-bucket',
  CDN_URL: 'https://cdn.example.test/',
};
const originalEnv: Record<string, string | undefined> = {};
let heartbeatPath: string;

beforeEach(() => {
  for (const key of Object.keys(FAKE_R2_ENV)) originalEnv[key] = process.env[key];
  Object.assign(process.env, FAKE_R2_ENV);
  heartbeatPath = join(mkdtempSync(join(tmpdir(), 'cartyx-hb-')), 'beat');
  process.env.HEARTBEAT_FILE = heartbeatPath;
  hooks.puts = [];
});

afterEach(() => {
  for (const key of Object.keys(FAKE_R2_ENV)) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  delete process.env.HEARTBEAT_FILE;
});

async function runOnce(): Promise<ReturnType<typeof vi.fn>> {
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  await processAsset(
    { updateOne } as never,
    { _id: 'asset-ok', sourceKey: `${PREFIX_ROOT}x.wav`, attempts: 1 },
    WORKER
  );
  return updateOne;
}

describe('the successful write', () => {
  it('publishes a ready asset with both renditions', async () => {
    const updateOne = await runOnce();
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('ready');
    expect(Object.keys(update.$set.renditions)).toEqual(['opus', 'aac']);
    expect(hooks.puts).toHaveLength(2);
  });

  /**
   * The rendition key layout is a CROSS-SERVICE CONTRACT, not an internal
   * detail. Both renditions must land INSIDE the owner's storage namespace —
   * the `uploads/audio/<prefix>/` segment carried by the source key — because
   * that prefix is the entire basis of the app's owner-scoped cleanup
   * (app/server/functions/audio-cleanup.ts lists it and treats anything no row
   * references as reclaimable). A rendition written to a shared
   * `uploads/audio/renditions/` root, which is what this used to do, falls
   * outside every user's listing and is unreclaimable by anyone: the worker PUTs
   * both renditions and only then issues the fenced write, so one lost write
   * strands them forever. The two packages cannot import each other, so each
   * pins the literal.
   */
  it("writes renditions inside the owner's namespace, beside the source", async () => {
    const updateOne = await runOnce();
    const [, update] = updateOne.mock.calls[0];
    const renditions = update.$set.renditions as Record<string, { key: string }>;
    expect(renditions.opus.key).toBe(`${PREFIX_ROOT}renditions/asset-ok.opus`);
    expect(renditions.aac.key).toBe(`${PREFIX_ROOT}renditions/asset-ok.m4a`);
    expect(hooks.puts.map((p) => (p as { input: { Key: string } }).input.Key)).toEqual([
      `${PREFIX_ROOT}renditions/asset-ok.opus`,
      `${PREFIX_ROOT}renditions/asset-ok.m4a`,
    ]);
    // The prefix is the SOURCE's, not a constant: a second owner's asset must
    // not land in the first owner's namespace.
    for (const put of hooks.puts) {
      expect((put as { input: { Key: string } }).input.Key.startsWith(PREFIX_ROOT)).toBe(true);
    }
  });

  /**
   * A source key from before the per-owner layout gives the worker nowhere safe
   * to put renditions: the old shared root is outside every user's listing
   * prefix, so anything written there can never be reclaimed by its owner.
   * Permanent, not retryable — the source key is fixed, so every attempt lands
   * in the same place. Nothing is uploaded at all.
   */
  it('permanently fails a legacy source key instead of writing outside a namespace', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await processAsset(
      { updateOne } as never,
      { _id: 'asset-legacy', sourceKey: 'uploads/audio/1700000000000-deadbeef.wav', attempts: 0 },
      WORKER
    );

    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('failed');
    expect(update.$set.permanentFailure).toBe(true);
    expect(update.$set.lastError).toMatch(/per-owner storage layout/);
    expect(hooks.puts).toHaveLength(0);
  });

  it('is fenced on the claim this worker holds', async () => {
    const updateOne = await runOnce();
    const [filter] = updateOne.mock.calls[0];
    // Unfenced, a worker whose claim the reaper revoked mid-job would publish
    // `ready` — with its own rendition keys — over a row a second worker is
    // concurrently transcoding.
    expect(filter).toEqual({ _id: 'asset-ok', status: 'processing', claimedBy: WORKER });
  });
});

describe('the heartbeat', () => {
  it('is written while an asset is being processed, not only between assets', async () => {
    // A single asset can hold the loop for tens of minutes, so a heartbeat
    // written only per iteration would need a threshold too generous to catch
    // anything. processAsset must beat after each stage.
    expect(existsSync(heartbeatPath)).toBe(false);
    await runOnce();
    expect(existsSync(heartbeatPath)).toBe(true);
    const written = Number(readFileSync(heartbeatPath, 'utf8'));
    expect(Date.now() - written).toBeLessThan(60_000);
  });
});
