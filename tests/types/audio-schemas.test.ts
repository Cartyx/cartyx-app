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

// ---------------------------------------------------------------------------
// Caps and id/cursor validation. These are the *only* enforcement of these
// properties: the schema is the shared boundary for both ingest adapters (the
// browser server-fns and the phase-3 HTTP routes), so anything it accepts
// reaches Mongo.
// ---------------------------------------------------------------------------

describe('listAudioAssetsSchema.tags caps', () => {
  /**
   * This field feeds `query.tags = { $all: data.tags }` directly. Uncapped, a
   * ~1 MB request body becomes a `$all` carrying tens of thousands of terms
   * against a shared Atlas cluster. The other two tag fields
   * (update/bulkTag) already capped at 30 elements of 40 chars; this was the
   * one that didn't.
   */
  it('rejects more than 30 tags', async () => {
    const { listAudioAssetsSchema } = await import('~/types/schemas/audio');
    const tags = Array.from({ length: 31 }, (_, i) => `t${i}`);
    expect(listAudioAssetsSchema.safeParse({ tags }).success).toBe(false);
    expect(listAudioAssetsSchema.safeParse({ tags: tags.slice(0, 30) }).success).toBe(true);
  });

  it('rejects a tag longer than 40 characters', async () => {
    const { listAudioAssetsSchema } = await import('~/types/schemas/audio');
    expect(listAudioAssetsSchema.safeParse({ tags: ['x'.repeat(41)] }).success).toBe(false);
    expect(listAudioAssetsSchema.safeParse({ tags: ['x'.repeat(40)] }).success).toBe(true);
  });
});

describe('listAudioAssetsSchema.cursor', () => {
  const OID = '507f1f77bcf86cd799439011';

  it('accepts a cursor of the shape encodeAudioCursor produces', async () => {
    const { listAudioAssetsSchema } = await import('~/types/schemas/audio');
    expect(listAudioAssetsSchema.safeParse({ cursor: `1700000000000_${OID}` }).success).toBe(true);
  });

  /**
   * The exact hostile value. `Number.isFinite(1e20)` is `true`, which is all the
   * old guard checked — but the largest Date JS can represent is 8.64e15 ms, so
   * `new Date(1e20)` is `Invalid Date`, which Mongoose turns into a CastError:
   * a guaranteed HTTP 500 plus a GlitchTip event from one request body.
   */
  it('rejects a finite-but-unrepresentable timestamp (1e20)', async () => {
    const { listAudioAssetsSchema } = await import('~/types/schemas/audio');
    expect(
      listAudioAssetsSchema.safeParse({ cursor: `100000000000000000000_${OID}` }).success
    ).toBe(false);
    // The boundary itself: 8.64e15 is the last representable ms, 8.64e15 + 1 is not.
    expect(listAudioAssetsSchema.safeParse({ cursor: `8640000000000000_${OID}` }).success).toBe(
      true
    );
    expect(listAudioAssetsSchema.safeParse({ cursor: `8640000000000001_${OID}` }).success).toBe(
      false
    );
  });

  it('rejects an id half that is not an ObjectId', async () => {
    const { listAudioAssetsSchema } = await import('~/types/schemas/audio');
    expect(listAudioAssetsSchema.safeParse({ cursor: '1700000000000_notanoid' }).success).toBe(
      false
    );
  });

  it('rejects a non-numeric timestamp half and a cursor with no delimiter', async () => {
    const { listAudioAssetsSchema } = await import('~/types/schemas/audio');
    expect(listAudioAssetsSchema.safeParse({ cursor: `abc_${OID}` }).success).toBe(false);
    expect(listAudioAssetsSchema.safeParse({ cursor: OID }).success).toBe(false);
  });
});

describe('ObjectId validation on every id field', () => {
  const OID = '507f1f77bcf86cd799439011';

  /**
   * Without this, `"x"` reached `AudioAsset.findOne`/`updateMany` and threw a
   * Mongoose CastError, which escaped as an HTTP 500 *and* filed a GlitchTip
   * event — for a client mistake whose correct answer is a 4xx. Validating at
   * the schema means it never reaches Mongo at all.
   */
  it.each([
    ['confirmAudioUploadSchema', 'assetId'],
    ['updateAudioAssetSchema', 'id'],
    ['deleteAudioAssetSchema', 'id'],
    ['retryAudioAssetSchema', 'id'],
  ])('%s rejects a non-ObjectId %s and accepts a real one', async (name, field) => {
    const mod = (await import('~/types/schemas/audio')) as unknown as Record<
      string,
      { safeParse: (v: unknown) => { success: boolean } }
    >;
    expect(mod[name].safeParse({ [field]: 'x' }).success).toBe(false);
    expect(mod[name].safeParse({ [field]: '' }).success).toBe(false);
    // Right length, wrong alphabet — a length check alone would let this through.
    expect(mod[name].safeParse({ [field]: 'z'.repeat(24) }).success).toBe(false);
    expect(mod[name].safeParse({ [field]: OID }).success).toBe(true);
  });

  /**
   * CASE-CANONICAL. The regex accepts either case — Mongo's own cast is
   * case-insensitive, so refusing upper-case hex would refuse ids Mongo
   * resolves fine — but the value the schema PRODUCES is always lower-case,
   * which is the form `String(someObjectId)` renders on the server.
   *
   * Without this, an id's case survived into comparisons between a
   * client-supplied id and a server-derived one, and `deleteAudioAsset`'s
   * package prune was silently a no-op for an upper-cased id: the asset and
   * its R2 objects went, every referencing package item stayed behind forever
   * against the 64-item cap.
   */
  it('lower-cases the id it produces, while still accepting upper-case input', async () => {
    const { deleteAudioAssetSchema } = await import('~/types/schemas/audio');
    const parsed = deleteAudioAssetSchema.safeParse({ id: OID.toUpperCase() });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.id).toBe(OID);
  });

  it('lower-cases every id in a batch', async () => {
    const { bulkTagAudioAssetsSchema } = await import('~/types/schemas/audio');
    const parsed = bulkTagAudioAssetsSchema.safeParse({ ids: [OID.toUpperCase(), OID] });
    expect(parsed.success && parsed.data.ids).toEqual([OID, OID]);
  });

  it('bulkTagAudioAssetsSchema rejects the whole batch when any id is malformed', async () => {
    const { bulkTagAudioAssetsSchema } = await import('~/types/schemas/audio');
    expect(bulkTagAudioAssetsSchema.safeParse({ ids: [OID, 'x'] }).success).toBe(false);
    expect(bulkTagAudioAssetsSchema.safeParse({ ids: [OID] }).success).toBe(true);
  });
});

describe('deleteOrphanAudioSchema', () => {
  it('requires at least one key and caps the batch at 500', async () => {
    const { deleteOrphanAudioSchema } = await import('~/types/schemas/audio');
    expect(deleteOrphanAudioSchema.safeParse({ keys: [] }).success).toBe(false);
    expect(deleteOrphanAudioSchema.safeParse({ keys: ['uploads/audio/x.opus'] }).success).toBe(
      true
    );
    expect(
      deleteOrphanAudioSchema.safeParse({ keys: Array.from({ length: 501 }, () => 'k') }).success
    ).toBe(false);
  });
});
