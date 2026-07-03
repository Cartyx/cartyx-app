import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('~/server/db/models/Lore', () => ({ Lore: { updateMany: vi.fn() } }));
import { Lore } from '~/server/db/models/Lore';
import { pruneLoreLinks } from '~/server/utils/pruneLoreLinks';

beforeEach(() => vi.clearAllMocks());

describe('pruneLoreLinks', () => {
  it('pulls matching links from all lore in the campaign', async () => {
    vi.mocked(Lore.updateMany).mockResolvedValue({ modifiedCount: 2 } as never);
    await pruneLoreLinks('character', 'c-1', 'camp-1');
    expect(Lore.updateMany).toHaveBeenCalledWith(
      { campaignId: 'camp-1', 'links.id': 'c-1' },
      { $pull: { links: { kind: 'character', id: 'c-1' } } }
    );
  });
});
