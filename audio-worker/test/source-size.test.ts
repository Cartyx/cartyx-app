import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';

/**
 * B1 — the TOCTOU hole.
 *
 * `confirmAudioUpload` HeadObjects the source and stamps `confirmedAt`, but the
 * presigned PUT that produced the object is valid for 300 s and is REUSABLE,
 * and nothing invalidates it after confirm succeeds. PUT 1 KB, let confirm
 * pass, then re-PUT 4 GB to the same URL: the worker used to
 * `transformToByteArray()` whatever it found into a pod limited to 768Mi and
 * get OOMKilled, leaving the row in `processing` for the reaper to requeue —
 * three OOMs, then `failed`, from which Retry accepts it because `confirmedAt`
 * really is set. At replicaCount 1 each OOM stalls every user's queue.
 *
 * These tests drive an oversized object through `processAsset` and assert the
 * body is never consumed, rather than asserting a size check exists.
 */

const hooks = vi.hoisted(() => ({
  contentLength: undefined as number | undefined,
  chunks: [] as Buffer[],
  /** Set the moment anything pulls from the response stream. */
  bodyRead: false,
  /** Set if anything asks the SDK to materialise the whole object. */
  buffered: false,
}));

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
      if (!(cmd instanceof GetObjectCommand)) throw new Error('unexpected command');
      const body = Readable.from(
        (function* () {
          for (const chunk of hooks.chunks) {
            hooks.bodyRead = true;
            yield chunk;
          }
        })()
      ) as Readable & { transformToByteArray?: () => Promise<Uint8Array> };
      body.transformToByteArray = async () => {
        hooks.buffered = true;
        return new Uint8Array(Buffer.concat(hooks.chunks));
      };
      return { ContentLength: hooks.contentLength, Body: body };
    }
  }
  return { S3Client: FakeS3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand };
});

import { processAsset } from '../src/process.js';
import { DEFAULT_MAX_SOURCE_BYTES } from '../src/config.js';

const WORKER = 'worker-test';
const FAKE_R2_ENV = {
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET: 'test-bucket',
  CDN_URL: 'https://cdn.example.test',
};
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of Object.keys(FAKE_R2_ENV)) originalEnv[key] = process.env[key];
  Object.assign(process.env, FAKE_R2_ENV);
  hooks.contentLength = undefined;
  hooks.chunks = [];
  hooks.bodyRead = false;
  hooks.buffered = false;
});

afterEach(() => {
  for (const key of Object.keys(FAKE_R2_ENV)) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  delete process.env.AUDIO_MAX_BYTES;
});

describe('processAsset enforces the size cap at point of use', () => {
  it('refuses a 4 GB object without reading a single byte of it', async () => {
    hooks.contentLength = 4 * 1024 * 1024 * 1024;
    // If the guard were removed, this would be pulled into a Buffer: 4 GB into
    // a 768Mi pod. The test asserts on consumption, not on a message.
    hooks.chunks = [Buffer.alloc(1024)];
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });

    await processAsset(
      { updateOne } as never,
      { _id: 'huge', sourceKey: 'uploads/audio/x.wav', attempts: 0 },
      WORKER
    );

    expect(hooks.bodyRead).toBe(false);
    expect(hooks.buffered).toBe(false);

    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('failed');
    // Permanent: the object is not going to shrink, so retrying is guaranteed
    // waste and the Retry button must not buy another pass either.
    expect(update.$set.permanentFailure).toBe(true);
    expect(update.$set.lastError).toContain(String(DEFAULT_MAX_SOURCE_BYTES));
  });

  it('still refuses when ContentLength lies or is absent, because the counter runs on the stream', async () => {
    process.env.AUDIO_MAX_BYTES = String(64 * 1024);
    hooks.contentLength = undefined; // no declared size at all
    hooks.chunks = [Buffer.alloc(32 * 1024), Buffer.alloc(32 * 1024), Buffer.alloc(32 * 1024)];
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });

    await processAsset(
      { updateOne } as never,
      { _id: 'liar', sourceKey: 'uploads/audio/x.wav', attempts: 0 },
      WORKER
    );

    // The header check alone would let this through: ContentLength comes from
    // the same place the bytes do.
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('failed');
    expect(update.$set.permanentFailure).toBe(true);
    expect(update.$set.lastError).toContain('exceeds');
  });

  it('never materialises an accepted source in memory — it streams to disk', async () => {
    hooks.contentLength = 2048;
    hooks.chunks = [Buffer.alloc(2048)];
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });

    await processAsset(
      { updateOne } as never,
      { _id: 'ok', sourceKey: 'uploads/audio/x.wav', attempts: 0 },
      WORKER
    );

    // Consumed as a stream, not via transformToByteArray.
    expect(hooks.bodyRead).toBe(true);
    expect(hooks.buffered).toBe(false);
    // 2 KB of zeros is not audio, so ffprobe rejects it — but as an ORDINARY
    // retryable failure, which is what proves the size guard didn't fire.
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('pending');
    expect(update.$set.permanentFailure).toBeUndefined();
  });
});
