import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));

// The global `tests/setup.ts` mock replaces `mongoose` wholesale and does not
// carry `Types` (only `Schema.Types.ObjectId = String`), so `new
// mongoose.Types.ObjectId(...)` would throw under it. `tabletop.test.ts`
// hits the exact same issue for its own `new mongoose.Types.ObjectId(...)`
// cast and fixes it the same way: keep the real `Types` so the cast the
// implementation performs is exercised for real, not stubbed away.
vi.mock('mongoose', async () => {
  const actual = await vi.importActual<typeof import('mongoose')>('mongoose');
  return { default: { Types: actual.Types } };
});

const { aggregate } = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('~/server/db/models/AudioAsset', () => ({ AudioAsset: { aggregate } }));

import { getUserStorageUsage } from '~/server/functions/audio-quota';

const OWNER = '507f1f77bcf86cd799439011';
const OTHER_OWNER = '507f1f77bcf86cd799439022';

/**
 * Reads a Mongo aggregation `$ifNull` operand (`{ $ifNull: [fieldRef,
 * fallback] }`) against a plain-object fixture the way the real MongoDB
 * aggregation engine would: dotted field ref resolved against the doc, with
 * `null`/missing collapsing to `fallback`.
 *
 * This is what lets the tests below assert against the pipeline object
 * `aggregate` was actually called with, rather than a hand-typed re-guess of
 * "the five fields" — if `getUserStorageUsage` used a wrong field name, a
 * missing `$ifNull` guard, or summed the wrong count of terms, this
 * interpreter would compute the wrong number from the SAME pipeline object
 * the implementation built, and the assertion on the total would fail. A
 * test that instead hard-coded "sum these five named fields" would pass even
 * if the implementation's pipeline asked Mongo for different fields, because
 * nothing would ever cross-check the pipeline against the fixture.
 */
function readIfNull(expr: unknown, doc: Record<string, unknown>): number {
  const e = expr as { $ifNull: [string, number] };
  const path = e.$ifNull[0].replace(/^\$/, '').split('.');
  let value: unknown = doc;
  for (const key of path) {
    if (value == null) {
      value = undefined;
      break;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value == null ? e.$ifNull[1] : (value as number);
}

/**
 * Runs the pipeline `getUserStorageUsage` actually built against a set of
 * fixture rows, simulating `$match` (equality only, sufficient for the one
 * `ownerId` clause this pipeline emits) and the `$group`'s `$sum`/`$add`
 * shape. Returns what a real MongoDB would return for `aggregate.mock.calls`
 * pipeline against these docs.
 */
function simulate(
  pipeline: Array<Record<string, unknown>>,
  docs: Array<Record<string, unknown>>
): { assetCount: number; bytes: number } {
  const matchStage = pipeline.find((s) => '$match' in s) as {
    $match: { ownerId: mongoose.Types.ObjectId };
  };
  const groupStage = pipeline.find((s) => '$group' in s) as {
    $group: { bytes: { $sum: { $add: unknown[] } } };
  };
  const ownerId = matchStage.$match.ownerId;
  const matched = docs.filter((d) => String(d.ownerId) === String(ownerId));

  let bytes = 0;
  for (const doc of matched) {
    for (const addend of groupStage.$group.bytes.$sum.$add) {
      bytes += readIfNull(addend, doc);
    }
  }
  return { assetCount: matched.length, bytes };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getUserStorageUsage — scoping', () => {
  it('matches on ownerId cast to a real ObjectId, not the raw string', async () => {
    aggregate.mockResolvedValue([{ assetCount: 1, bytes: 100 }]);

    await getUserStorageUsage(OWNER);

    const pipeline = aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const matchStage = pipeline.find((s) => '$match' in s) as {
      $match: { ownerId: unknown };
    };
    // `.aggregate()` is NOT cast by Mongoose the way `.find()` is — a bare
    // string here would silently match nothing in a real cluster despite
    // passing any test that only checked `ownerId === OWNER`.
    expect(matchStage.$match.ownerId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(String(matchStage.$match.ownerId)).toBe(OWNER);
  });

  it('does not filter by status — every status must be counted', async () => {
    aggregate.mockResolvedValue([{ assetCount: 1, bytes: 100 }]);

    await getUserStorageUsage(OWNER);

    const pipeline = aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const matchStage = pipeline.find((s) => '$match' in s) as { $match: Record<string, unknown> };
    // A shape that would pass for the wrong reason: `{ ownerId, status:
    // 'ready' }` still has an `ownerId` key equal to the right ObjectId, so
    // an assertion on ownerId alone wouldn't catch a status filter smuggled
    // into the same $match. This checks the $match's only key.
    expect(Object.keys(matchStage.$match)).toEqual(['ownerId']);
  });
});

describe('getUserStorageUsage — pipeline arithmetic (interpreted, not hard-coded)', () => {
  it('sums a pending asset (source only) and a ready asset (all rendition slots) across both, for both users mixed in the collection', async () => {
    aggregate.mockResolvedValue([{ assetCount: 2, bytes: 999 }]); // mocked return is deliberately wrong-looking; the assertions below never read it.

    await getUserStorageUsage(OWNER);
    const pipeline = aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;

    const pendingSourceOnly = {
      ownerId: OWNER,
      status: 'pending',
      sourceBytes: 5_000_000,
      // Never touched by the worker yet — these sub-documents don't exist at
      // all (schema `default: undefined`), not merely holding zeros. A
      // fixture that set them to `{ bytes: 0 }` would pass even if the
      // implementation forgot the `$ifNull` guard, because 0 + 0 looks the
      // same as 0 + (null collapsed to 0). Omitting the keys entirely is
      // what actually exercises the guard.
    };
    const readyAllFields = {
      ownerId: OWNER,
      status: 'ready',
      sourceBytes: 4_000_000,
      renditions: { opus: { bytes: 900_000 }, aac: { bytes: 1_100_000 } },
      onceRenditions: { opus: { bytes: 300_000 }, aac: { bytes: 400_000 } },
    };
    // A row belonging to someone else, deliberately shaped to inflate the
    // total if the $match scoping were ever dropped or widened.
    const otherUsersAsset = {
      ownerId: OTHER_OWNER,
      status: 'ready',
      sourceBytes: 999_999_999,
    };

    const result = simulate(pipeline, [pendingSourceOnly, readyAllFields, otherUsersAsset]);

    expect(result.assetCount).toBe(2); // both statuses counted; the other owner's row excluded
    expect(result.bytes).toBe(5_000_000 + 4_000_000 + 900_000 + 1_100_000 + 300_000 + 400_000);
  });

  it('sums exactly the five byte-bearing fields the brief names, in the schema shape audio-cleanup.ts also reads', async () => {
    aggregate.mockResolvedValue([{ assetCount: 1, bytes: 0 }]);

    await getUserStorageUsage(OWNER);
    const pipeline = aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const groupStage = pipeline.find((s) => '$group' in s) as {
      $group: { bytes: { $sum: { $add: Array<{ $ifNull: [string, number] }> } } };
    };
    const fieldRefs = groupStage.$group.bytes.$sum.$add.map((op) => op.$ifNull[0]);

    expect(fieldRefs).toEqual([
      '$sourceBytes',
      '$renditions.opus.bytes',
      '$renditions.aac.bytes',
      '$onceRenditions.opus.bytes',
      '$onceRenditions.aac.bytes',
    ]);
    // Every addend falls back to 0, not left to propagate Mongo's $add-of-null
    // -> null (which would surface as NaN once coerced to a JS number).
    for (const op of groupStage.$group.bytes.$sum.$add) {
      expect(op.$ifNull[1]).toBe(0);
    }
  });

  it('an asset with null bytes (never confirmed) contributes 0, not NaN', async () => {
    aggregate.mockResolvedValue([{ assetCount: 1, bytes: 0 }]);

    await getUserStorageUsage(OWNER);
    const pipeline = aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;

    const neverConfirmed = {
      ownerId: OWNER,
      status: 'uploading',
      sourceBytes: null, // set by confirmAudioUpload's HeadObject; null until then
      // renditions/onceRenditions absent entirely at this stage too
    };

    const result = simulate(pipeline, [neverConfirmed]);

    expect(result.assetCount).toBe(1);
    expect(result.bytes).toBe(0);
    expect(Number.isNaN(result.bytes)).toBe(false);
  });

  it('counts assets, not renditions: an asset counts once even with two rendition slots present', async () => {
    aggregate.mockResolvedValue([{ assetCount: 1, bytes: 0 }]);

    await getUserStorageUsage(OWNER);
    const pipeline = aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const groupStage = pipeline.find((s) => '$group' in s) as {
      $group: { assetCount: { $sum: number } };
    };

    // The $group's assetCount accumulator is `{ $sum: 1 }` per document,
    // never keyed off how many rendition sub-documents that row happens to
    // carry.
    expect(groupStage.$group.assetCount).toEqual({ $sum: 1 });
  });
});

describe('getUserStorageUsage — empty result', () => {
  it('returns { bytes: 0, assetCount: 0 } when the user owns no assets at all', async () => {
    // A real MongoDB aggregate() returns an EMPTY ARRAY when no document
    // matched $match, not a group row of zeros — there is nothing to group.
    aggregate.mockResolvedValue([]);

    const result = await getUserStorageUsage(OWNER);

    expect(result).toEqual({ bytes: 0, assetCount: 0 });
  });
});
