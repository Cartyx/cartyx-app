import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

/**
 * F3 — the heartbeat threshold and the code have to agree.
 *
 * `DEFAULT_HEARTBEAT_MAX_AGE_MS` is 600 s, and its stated justification is
 * "2x the longest legitimate gap between two beats", the longest single stage
 * being `FFMPEG_TIMEOUT_MS` (300 s). That arithmetic is only true if EVERY
 * stage boundary is beaten. It wasn't: between the beat after the AAC transcode
 * and the beat after `extractPeaks` sat two `probe()` calls and the peak decode
 * — three capped child processes back to back, a real worst case of 900 s, i.e.
 * 1.5x the threshold. The liveness probe could therefore kill a worker that was
 * transcoding perfectly happily, and `downloadSource` was unbeaten too.
 *
 * So this test asserts the INVARIANT rather than a count: no two consecutive
 * stages without a beat between them. It records an interleaved trace of every
 * stage the pipeline runs and every beat it writes, and fails if any two stages
 * are adjacent in it. A new stage added without a beat fails here, which is the
 * only thing keeping the config comment honest.
 */

const trace = vi.hoisted(() => ({ events: [] as string[] }));

vi.mock('../src/heartbeat.js', () => ({
  beat: () => trace.events.push('beat'),
  isHeartbeatFresh: () => true,
}));

vi.mock('../src/ffmpeg.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ffmpeg.js')>();
  return {
    ...actual,
    probe: async () => {
      trace.events.push('stage:probe');
      return { durationMs: 2000, sampleRate: 48_000, channels: 2 };
    },
    analyze: async () => {
      trace.events.push('stage:analyze');
      return { samples: 96_000, peakDb: -12 };
    },
    transcode: async (_src: string, out: string) => {
      trace.events.push('stage:transcode');
      const { writeFileSync } = await import('node:fs');
      writeFileSync(out, Buffer.alloc(64));
    },
  };
});

vi.mock('../src/peaks.js', () => ({
  extractPeaks: async () => {
    trace.events.push('stage:peaks');
    return new Array(400).fill(0.5);
  },
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
  class DeleteObjectsCommand {
    constructor(public input: unknown) {}
  }
  class FakeS3Client {
    async send(cmd: unknown): Promise<unknown> {
      if (cmd instanceof GetObjectCommand) {
        trace.events.push('stage:get');
        // Several chunks, so the per-chunk beat inside downloadSource is
        // exercised: a 50 MB source over a slow link can outlast the threshold
        // while making steady progress, and the S3 request timeout is socket
        // INACTIVITY, which a trickle never trips.
        return {
          ContentLength: 3072,
          Body: Readable.from([Buffer.alloc(1024), Buffer.alloc(1024), Buffer.alloc(1024)]),
        };
      }
      if (cmd instanceof PutObjectCommand) {
        trace.events.push('stage:put');
        return {};
      }
      return {};
    }
  }
  return {
    S3Client: FakeS3Client,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
  };
});

const { processAsset } = await import('../src/process.js');

const R2_ENV = {
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET: 'test-bucket',
  CDN_URL: 'https://cdn.example.test',
};

beforeEach(() => {
  Object.assign(process.env, R2_ENV);
  trace.events = [];
});

describe('every pipeline stage is followed by a beat', () => {
  it('leaves no two stages adjacent in the trace', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await processAsset(
      { updateOne },
      { _id: 'a1', sourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/x', attempts: 0 },
      'worker-heartbeat-test'
    );
    expect(updateOne.mock.calls[0][1].$set.status).toBe('ready');

    // Every stage the pipeline actually ran, in order.
    const stages = trace.events.filter((e) => e !== 'beat');
    expect(stages).toEqual([
      'stage:get',
      'stage:probe',
      'stage:analyze',
      'stage:transcode',
      'stage:transcode',
      'stage:probe',
      'stage:probe',
      'stage:peaks',
      'stage:put',
      'stage:put',
    ]);

    // The invariant. Each of these is capped at FFMPEG_TIMEOUT_MS (300 s) or at
    // S3_REQUEST_TIMEOUT_MS x the SDK's retries, so one unbeaten pair doubles
    // the worst-case gap and three in a row is the 900 s that shipped.
    const unbeatenPairs: string[] = [];
    for (let i = 1; i < trace.events.length; i++) {
      const prev = trace.events[i - 1];
      const cur = trace.events[i];
      if (prev !== 'beat' && cur !== 'beat') unbeatenPairs.push(`${prev} -> ${cur}`);
    }
    expect(unbeatenPairs).toEqual([]);
  });

  it('beats as the source streams in, not only once it has finished', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await processAsset(
      { updateOne },
      { _id: 'a1', sourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/x', attempts: 0 },
      'worker-heartbeat-test'
    );

    // Three chunks arrive between the GET and the first probe, and each one has
    // to count as progress — otherwise a slow but healthy 50 MB transfer ages
    // the heartbeat out and the probe restarts the pod mid-download.
    const get = trace.events.indexOf('stage:get');
    const probe = trace.events.indexOf('stage:probe');
    const between = trace.events.slice(get + 1, probe).filter((e) => e === 'beat');
    expect(between.length).toBeGreaterThanOrEqual(4);
  });
});
