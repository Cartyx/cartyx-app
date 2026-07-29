import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * B2 — the R2 calls were the only unbounded awaits left in the worker. The AWS
 * SDK's Node handler has NO request timeout by default, so a half-open socket
 * hangs `processAsset` forever; that hangs the single sequential loop, and
 * `reapStale` runs inside that loop, so nothing rescues the row either.
 */
const hooks = vi.hoisted(() => ({ configs: [] as Record<string, unknown>[] }));

vi.mock('@aws-sdk/client-s3', () => {
  class FakeS3Client {
    constructor(config: Record<string, unknown>) {
      hooks.configs.push(config);
    }
    async send(): Promise<never> {
      throw new Error('simulated R2 failure');
    }
  }
  class GetObjectCommand {
    constructor(public input: unknown) {}
  }
  class PutObjectCommand {
    constructor(public input: unknown) {}
  }
  class DeleteObjectCommand {
    constructor(public input: unknown) {}
  }
  return { S3Client: FakeS3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand };
});

import { processAsset } from '../src/process.js';
import { DEFAULT_S3_REQUEST_TIMEOUT_MS, DEFAULT_S3_CONNECT_TIMEOUT_MS } from '../src/config.js';

const FAKE_R2_ENV = {
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET: 'test-bucket',
  CDN_URL: 'https://cdn.example.test',
};
const originalEnv: Record<string, string | undefined> = {};

async function buildClient(): Promise<Record<string, unknown>> {
  hooks.configs = [];
  await processAsset(
    { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) } as never,
    { _id: 'x', sourceKey: 'uploads/audio/x.wav', attempts: 0 },
    'worker-test'
  );
  return hooks.configs[0];
}

beforeEach(() => {
  for (const key of Object.keys(FAKE_R2_ENV)) originalEnv[key] = process.env[key];
  Object.assign(process.env, FAKE_R2_ENV);
});

afterEach(() => {
  for (const key of Object.keys(FAKE_R2_ENV)) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  delete process.env.S3_REQUEST_TIMEOUT_MS;
  delete process.env.S3_CONNECT_TIMEOUT_MS;
});

describe('the R2 client is built with timeouts', () => {
  it('passes request and connection timeouts by default', async () => {
    const config = await buildClient();
    expect(config.requestHandler).toEqual({
      requestTimeout: DEFAULT_S3_REQUEST_TIMEOUT_MS,
      connectionTimeout: DEFAULT_S3_CONNECT_TIMEOUT_MS,
    });
  });

  it('honours the deployment overrides', async () => {
    process.env.S3_REQUEST_TIMEOUT_MS = '1234';
    process.env.S3_CONNECT_TIMEOUT_MS = '567';
    const config = await buildClient();
    expect(config.requestHandler).toEqual({ requestTimeout: 1234, connectionTimeout: 567 });
  });

  it('falls back to the defaults for the empty string Helm renders for a missing key', async () => {
    process.env.S3_REQUEST_TIMEOUT_MS = '';
    process.env.S3_CONNECT_TIMEOUT_MS = '';
    const config = await buildClient();
    // A 0 here would mean "no timeout" again in the SDK — the exact bug.
    expect(config.requestHandler).toEqual({
      requestTimeout: DEFAULT_S3_REQUEST_TIMEOUT_MS,
      connectionTimeout: DEFAULT_S3_CONNECT_TIMEOUT_MS,
    });
  });
});
