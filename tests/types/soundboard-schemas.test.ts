import { describe, it, expect } from 'vitest';

describe('soundboard schemas', () => {
  it('rejects more than MAX_PACKAGE_ITEMS items', async () => {
    const { updatePackageSchema } = await import('~/types/schemas/soundboard');
    const { MAX_PACKAGE_ITEMS } = await import('~/types/soundboard');
    const item = () => ({
      id: 'i1',
      assetId: '507f1f77bcf86cd799439011',
      volume: 0.8,
      fadeSeconds: 1,
      loop: true,
    });
    const r = updatePackageSchema.safeParse({
      id: '507f1f77bcf86cd799439011',
      items: Array.from({ length: MAX_PACKAGE_ITEMS + 1 }, item),
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-ObjectId assetId before it can reach Mongo', async () => {
    const { packageItemSchema } = await import('~/types/schemas/soundboard');
    // Otherwise-complete and valid: the ONLY invalid field is `assetId`, so a
    // rejection can only be attributed to the ObjectId check. Without the
    // rest of the required fields present, this would fail regardless of
    // whether `assetId` were validated at all.
    const item = (assetId: string) => ({
      id: 'i1',
      assetId,
      volume: 0.8,
      fadeSeconds: 1,
      loop: true,
    });
    expect(packageItemSchema.safeParse(item('nope')).success).toBe(false);
    // Positive control: the identical payload with a real ObjectId must
    // parse, proving the rejection above is attributable to `assetId` and
    // not to some other mistake in the fixture.
    expect(packageItemSchema.safeParse(item('507f1f77bcf86cd799439011')).success).toBe(true);
  });

  it('mood overrides are optional but bounded when present', async () => {
    const { moodSchema } = await import('~/types/schemas/soundboard');
    const ok = moodSchema.safeParse({
      id: 'm1',
      name: 'Overhead',
      states: [{ itemId: 'i1', playing: true }],
    });
    expect(ok.success).toBe(true);

    const bad = moodSchema.safeParse({
      id: 'm1',
      name: 'Overhead',
      states: [{ itemId: 'i1', playing: true, volume: 5 }],
    });
    expect(bad.success).toBe(false);
  });

  /**
   * A campaign can legitimately have a board with nothing loaded — Task 3's
   * `SoundboardState` model makes `packageId`/`moodId` nullable for exactly
   * this reason. `saveBoardStateSchema` originally typed `packageId` as a
   * required `objectId` (and `moodId` as nullable but still required), which
   * rejected this exact payload — the plan's own Task 6 fixture. Pinning it
   * so the schema can never regress back to requiring a package before one
   * has ever been chosen.
   */
  it('parses a save of a board with nothing loaded (no packageId, no moodId)', async () => {
    const { saveBoardStateSchema } = await import('~/types/schemas/soundboard');
    const r = saveBoardStateSchema.safeParse({
      campaignId: '507f1f77bcf86cd799439011',
      masterVolume: 0.8,
    });
    expect(r.success).toBe(true);
  });

  it('also parses when packageId/moodId are explicitly null (as opposed to merely omitted)', async () => {
    const { saveBoardStateSchema } = await import('~/types/schemas/soundboard');
    const r = saveBoardStateSchema.safeParse({
      campaignId: '507f1f77bcf86cd799439011',
      packageId: null,
      moodId: null,
      masterVolume: 0.8,
    });
    expect(r.success).toBe(true);
  });

  it('loadBoardStateSchema parses campaignId alone, with no packageId/moodId defect to trigger', async () => {
    const { loadBoardStateSchema } = await import('~/types/schemas/soundboard');
    const r = loadBoardStateSchema.safeParse({ campaignId: '507f1f77bcf86cd799439011' });
    expect(r.success).toBe(true);
  });
});
