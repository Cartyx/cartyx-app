import type { KeyAlly } from '~/services/mocks/types';
import { resolveMockData } from '~/services/mocks/utils';

export const mockKeyAllies: ReadonlyArray<Readonly<KeyAlly>> = Object.freeze([
  Object.freeze({ id: 'ally-1', name: 'Elder Morvain', town: 'Thornhollow' }),
  Object.freeze({ id: 'ally-2', name: 'Captain Elira Voss', town: 'Ravenwatch' }),
  Object.freeze({ id: 'ally-3', name: 'Brother Halwen', town: 'Ashenford' }),
  Object.freeze({ id: 'ally-4', name: 'Mira Quickstep', town: 'Goldmeadow' }),
  Object.freeze({ id: 'ally-5', name: 'Runesmith Baern', town: 'Stonewake' }),
  Object.freeze({ id: 'ally-6', name: 'Lady Seraphine Dawnmere', town: 'Highcrest' }),
  Object.freeze({ id: 'ally-7', name: 'Garrick Stormvale', town: 'Ravenwatch' }),
  Object.freeze({ id: 'ally-8', name: 'Sister Ondine', town: 'Ashenford' }),
  Object.freeze({ id: 'ally-9', name: 'Tobias Underhill', town: 'Goldmeadow' }),
  Object.freeze({ id: 'ally-10', name: 'Vesper Nightingale', town: 'Duskhaven' }),
  Object.freeze({ id: 'ally-11', name: 'Old Bramblewood', town: 'Thornhollow' }),
  Object.freeze({ id: 'ally-12', name: 'Kael Ironwright', town: 'Stonewake' }),
  Object.freeze({ id: 'ally-13', name: 'Wren Fletcher', town: 'Greenrest' }),
  Object.freeze({ id: 'ally-14', name: 'Magister Aldous Pyke', town: 'Highcrest' }),
  Object.freeze({ id: 'ally-15', name: 'Selene Frostwind', town: 'Duskhaven' }),
]);

export interface KeyAlliesService {
  getKeyAllies: () => Promise<KeyAlly[]>;
}

export const mockKeyAlliesService: KeyAlliesService = {
  async getKeyAllies() {
    return resolveMockData(mockKeyAllies.map((ally) => ({ ...ally })));
  },
};

export async function getKeyAllies(): Promise<KeyAlly[]> {
  return mockKeyAlliesService.getKeyAllies();
}

export type { KeyAlly };
