import { describe, it, expect } from 'vitest';

describe('audio schemas', () => {
  it('createAudioUploadSchema rejects an unknown kind', async () => {
    const { createAudioUploadSchema } = await import('~/types/schemas/audio');
    const r = createAudioUploadSchema.safeParse({
      filename: 'storm.wav',
      contentType: 'audio/wav',
      bytes: 1024,
      kind: 'podcast',
    });
    expect(r.success).toBe(false);
  });

  it('createAudioUploadSchema accepts a valid payload with metadata', async () => {
    const { createAudioUploadSchema } = await import('~/types/schemas/audio');
    const r = createAudioUploadSchema.safeParse({
      filename: 'storm.wav',
      contentType: 'audio/wav',
      bytes: 1024,
      kind: 'ambience',
      environment: ['coast'],
      mood: ['tense'],
      intensity: 4,
      tags: ['Storm', 'storm', ' rain '],
    });
    expect(r.success).toBe(true);
  });

  it('createAudioUploadSchema rejects bytes over the 50MB cap', async () => {
    const { createAudioUploadSchema } = await import('~/types/schemas/audio');
    const r = createAudioUploadSchema.safeParse({
      filename: 'huge.wav',
      contentType: 'audio/wav',
      bytes: 50 * 1024 * 1024 + 1,
      kind: 'ambience',
    });
    expect(r.success).toBe(false);
  });

  it('listAudioAssetsSchema defaults limit and accepts filters', async () => {
    const { listAudioAssetsSchema } = await import('~/types/schemas/audio');
    const r = listAudioAssetsSchema.safeParse({ kind: 'music', tags: ['epic'] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it('bulkTagAudioAssetsSchema requires at least one id', async () => {
    const { bulkTagAudioAssetsSchema } = await import('~/types/schemas/audio');
    const r = bulkTagAudioAssetsSchema.safeParse({ ids: [], tags: ['x'] });
    expect(r.success).toBe(false);
  });
});
