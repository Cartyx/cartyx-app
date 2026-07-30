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
    expect(packageItemSchema.safeParse({ id: 'i1', assetId: 'nope' }).success).toBe(false);
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
});
