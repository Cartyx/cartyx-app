import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('~/server/utils/helpers', () => ({
  normalizeTags: (t: string[]) => Array.from(new Set(t.map((x) => x.trim().toLowerCase()))),
}));

/*
 * setup.ts mocks mongoose with a MockSchema that does not track paths (and
 * whose `model()` returns a plain object, not a constructor). Schema-level
 * tests need real mongoose, so unmock + resetModules and dynamically import —
 * the same approach used in tests/server/db/quest-model.test.ts and
 * tests/server/db/lore-model.test.ts.
 */
describe('AudioAsset model', () => {
  let AudioAsset: any;

  beforeAll(async () => {
    vi.unmock('mongoose');
    vi.resetModules();
    const mod = await import('~/server/db/models/AudioAsset');
    AudioAsset = mod.AudioAsset;
  });

  afterAll(() => {
    // Restore the global mongoose mock so other tests in this worker are unaffected.
    vi.doMock('mongoose', () => {
      class MockSchema {
        constructor(_def?: unknown) {}
        static Types = { ObjectId: String };
        pre(_hook: string, _fn: unknown) {}
        index(_def?: unknown) {}
      }
      const mockModel = vi.fn(() => ({
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
        findById: vi.fn(),
        find: vi.fn(),
        create: vi.fn(),
        deleteOne: vi.fn(),
        deleteMany: vi.fn(),
      }));
      return {
        default: {
          connect: vi.fn(),
          connection: { readyState: 0 },
          Schema: MockSchema,
          model: mockModel,
          models: {},
        },
        Schema: MockSchema,
        model: mockModel,
        models: {},
        connection: { readyState: 0 },
      };
    });
    vi.resetModules();
  });

  it('defaults status to uploading and peaks to an empty array', () => {
    const doc = new AudioAsset({
      ownerId: '507f1f77bcf86cd799439011',
      title: 'Storm',
      kind: 'ambience',
      sourceKey: 'uploads/audio/x.wav',
    });
    expect(doc.status).toBe('uploading');
    expect(doc.peaks).toEqual([]);
    expect(doc.attempts).toBe(0);
  });

  // The brief's version of this test asserted `doc.kind` after `.validate()` —
  // which never checks tags, and mongoose pre('save') hooks do not run on
  // .validate(). It verified nothing about tag normalization. Fixed per the
  // human partner's ruling to genuinely exercise the pre-save hook: pull it
  // off the schema's registered pre('save') callbacks (kareem stores them at
  // schema.s.hooks._pres) and invoke it directly against the doc, since there
  // is no database to call a real .save() against.
  it('normalizes tags on save', () => {
    const doc = new AudioAsset({
      ownerId: '507f1f77bcf86cd799439011',
      title: 'Storm',
      kind: 'ambience',
      sourceKey: 'uploads/audio/x.wav',
      tags: ['Storm', 'storm', ' Rain '],
    });

    // Mongoose registers its own internal pre-save hooks (saveSubdocsPreSave,
    // shardingPluginPreSave, trackTransactionPreSave, ...) alongside ours when
    // the model is compiled, so the array holds several entries and our own
    // is not reliably at index 0. Ours is the one registered as an anonymous
    // function in the model file — pick it out by that.
    const preSaveHooks = AudioAsset.schema.s.hooks._pres.get('save') as Array<{
      fn: (this: unknown) => void;
    }>;
    const ourHook = preSaveHooks.find((h) => h.fn.name === '');
    expect(ourHook).toBeTruthy();
    ourHook!.fn.call(doc);

    expect(doc.tags).toEqual(['storm', 'rain']);
  });

  // The audio worker's retry backoff (`requeueForRetry` -> `claimNext` in
  // audio-worker/src/) writes and reads `nextAttemptAt`, and `retryAudioAsset`
  // clears it through this model. Mongoose is strict by default: an undeclared
  // path is silently stripped from both documents and `$set` updates, so
  // forgetting to declare it here breaks the cross-service contract without any
  // error — the retry button would leave a stale future timestamp behind and
  // the requeued asset would sit unclaimable until it expired.
  it('declares nextAttemptAt so the worker backoff field is not stripped', () => {
    const path = AudioAsset.schema.path('nextAttemptAt');
    expect(path).toBeDefined();
    expect(path.instance).toBe('Date');

    const doc = new AudioAsset({
      ownerId: '507f1f77bcf86cd799439011',
      title: 'Storm',
      kind: 'ambience',
      sourceKey: 'uploads/audio/x.wav',
    });
    expect(doc.nextAttemptAt).toBeNull();

    const when = new Date('2026-07-29T00:00:00.000Z');
    doc.nextAttemptAt = when;
    expect(doc.toObject().nextAttemptAt).toEqual(when);
  });

  // `retryAudioAsset` gates on `confirmedAt` to keep an object that never
  // passed confirm's HeadObject out of the transcode queue. Mongoose is strict
  // by default: an undeclared path is silently stripped from both documents and
  // `$set` updates — so if this were missing, confirm's write would vanish, the
  // guard would reject every asset, and Retry would break for everyone. The
  // failure mode is silent in both directions, which is why it is pinned here.
  it('declares confirmedAt, defaulting to null until confirm sets it', () => {
    const path = AudioAsset.schema.path('confirmedAt');
    expect(path).toBeDefined();
    expect(path.instance).toBe('Date');

    const doc = new AudioAsset({
      ownerId: '507f1f77bcf86cd799439011',
      title: 'Storm',
      kind: 'ambience',
      sourceKey: 'uploads/audio/x.wav',
    });
    // A freshly created row has not been confirmed — that is the whole premise
    // the retry guard rests on.
    expect(doc.confirmedAt).toBeNull();
    // And nothing has measured its size yet either.
    expect(doc.sourceBytes).toBeNull();

    const when = new Date('2026-07-29T00:00:00.000Z');
    doc.confirmedAt = when;
    expect(doc.toObject().confirmedAt).toEqual(when);
  });

  /**
   * Both of these are written by the WORKER, through the raw driver, and read
   * by the app — so mongoose's strict-by-default stripping is again the failure
   * mode: an undeclared path vanishes from `$set` updates issued through this
   * model with no error at all.
   *
   * `durationSamples` is what phase 2's gapless looping reads. `durationMs`
   * rounds to whole milliseconds, which at 48 kHz is up to ±24 samples of slop
   * on every asset before any format-specific error on top (+312 samples for an
   * Ogg/Opus upload, +1440 for ADTS AAC, both measured) — an audible tick on
   * every repeat of an ambience loop.
   *
   * `permanentFailure` is what stops `retryAudioAsset` handing a source the
   * worker has already judged unusable straight back to the worker.
   */
  it('declares durationSamples and permanentFailure, the fields the worker writes', () => {
    expect(AudioAsset.schema.path('durationSamples').instance).toBe('Number');
    expect(AudioAsset.schema.path('permanentFailure').instance).toBe('Boolean');

    const doc = new AudioAsset({
      ownerId: '507f1f77bcf86cd799439011',
      title: 'Storm',
      kind: 'ambience',
      sourceKey: 'uploads/audio/x.wav',
    });
    // Unknown until the worker decodes the file; not zero, which would read as
    // "measured, and empty".
    expect(doc.durationSamples).toBeNull();
    // Nothing has judged this source unusable, so Retry stays available.
    expect(doc.permanentFailure).toBe(false);

    doc.durationSamples = 96_313;
    doc.permanentFailure = true;
    const obj = doc.toObject();
    expect(obj.durationSamples).toBe(96_313);
    expect(obj.permanentFailure).toBe(true);
  });

  it('rejects an unknown kind', async () => {
    const doc = new AudioAsset({
      ownerId: '507f1f77bcf86cd799439011',
      title: 'X',
      kind: 'podcast',
      sourceKey: 'uploads/audio/x.wav',
    });
    await expect(doc.validate()).rejects.toBeTruthy();
  });

  /**
   * A `{ title: 'text' }` index used to be declared here and was never queried.
   * `listAudioAssets` searches titles with
   * `{ $regex: escapeRegExp(search), $options: 'i' }`, and a text index cannot
   * serve a `$regex` query — `$text` appears nowhere in this codebase. So it
   * only ever cost: Atlas tokenizes every title and writes an index entry per
   * word on every insert and every title edit, to answer a query nobody issues.
   *
   * Asserted through `schema.indexes()` (the real registered set) rather than
   * by reading the source, and the other four are pinned alongside it so this
   * doubles as the record of which index serves which query.
   */
  it('declares no text index, and keeps the four that are actually queried', () => {
    const keys = (AudioAsset.schema.indexes() as Array<[Record<string, unknown>, unknown]>).map(
      ([spec]) => spec
    );

    expect(keys.some((k) => Object.values(k).includes('text'))).toBe(false);
    expect(keys).toContainEqual({ ownerId: 1, kind: 1 });
    expect(keys).toContainEqual({ ownerId: 1, tags: 1 });
    expect(keys).toContainEqual({ ownerId: 1, createdAt: -1 });
    // The worker's atomic claim (`claimNext`) and its reaper.
    expect(keys).toContainEqual({ status: 1, createdAt: 1 });
    expect(keys).toHaveLength(4);
  });
});
