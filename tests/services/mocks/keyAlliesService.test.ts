import { describe, expect, it } from 'vitest';
import { getKeyAllies, mockKeyAlliesService } from '~/services/mocks/keyAlliesService';

describe('mockKeyAlliesService', () => {
  it('returns key NPC allies with home towns', async () => {
    const allies = await getKeyAllies();

    expect(allies).toHaveLength(15);
    expect(allies[0]).toMatchObject({
      name: 'Elder Morvain',
      town: 'Thornhollow',
    });
  });

  it('returns defensive copies', async () => {
    const first = await getKeyAllies();
    const second = await getKeyAllies();

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);

    first[0]!.town = 'Mutated';
    expect((await getKeyAllies())[0]!.town).toBe('Thornhollow');
  });

  it('uses the consistent service interface', async () => {
    await expect(mockKeyAlliesService.getKeyAllies()).resolves.toEqual(await getKeyAllies());
  });
});
