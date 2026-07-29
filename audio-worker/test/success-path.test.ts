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
    { _id: 'asset-ok', sourceKey: 'uploads/audio/x.wav', attempts: 1 },
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
   * The rendition key format is a CROSS-SERVICE CONTRACT, not an internal
   * detail. The app's owner-scoped audio cleanup
   * (`renditionKeysFor` in app/server/functions/audio-cleanup.ts) reconstructs
   * these two names from an asset id in order to find renditions this worker
   * PUT but never recorded on the row — the window between these PutObjects and
   * the fenced write below. That reconstruction is also what makes the cleanup
   * owner-scoped: it derives keys from the caller's own rows instead of listing
   * a bucket whose keys carry no owner. The two packages cannot import each
   * other, so each pins the literal; change one without the other and those
   * objects become permanently unreclaimable.
   */
  it('writes renditions to the deterministic key namespace the app reconstructs', async () => {
    const updateOne = await runOnce();
    const [, update] = updateOne.mock.calls[0];
    const renditions = update.$set.renditions as Record<string, { key: string }>;
    expect(renditions.opus.key).toBe('uploads/audio/renditions/asset-ok.opus');
    expect(renditions.aac.key).toBe('uploads/audio/renditions/asset-ok.m4a');
    expect(hooks.puts.map((p) => (p as { input: { Key: string } }).input.Key)).toEqual([
      'uploads/audio/renditions/asset-ok.opus',
      'uploads/audio/renditions/asset-ok.m4a',
    ]);
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
