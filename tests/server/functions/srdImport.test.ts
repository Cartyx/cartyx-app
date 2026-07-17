import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/data/srd', () => ({
  getSrdSpells: () => [
    {
      name: 'Fire Bolt',
      description: 'A mote of fire.',
      level: 0,
      school: 'evocation',
      castingTime: { value: 1, unit: 'action' },
      components: { verbal: true, somatic: true, material: false },
      range: { type: 'ranged', distance: 120 },
      duration: { type: 'instantaneous', concentration: false },
      ritual: false,
      higherLevelScaling: { enabled: false },
      classes: ['Wizard'],
      attackSave: { kind: 'attack', attackType: 'ranged' },
      modifiers: [{ id: 'm0', type: 'damage', dice: { count: 1, sides: 10 }, damageType: 'fire' }],
      conditions: [],
      higherLevels: [],
      areaOfEffect: { shape: 'none' },
      tags: ['srd', 'evocation', 'cantrip'],
    },
  ],
  getSrdRaces: () => [{ title: 'Elf', content: '# Elf', tags: ['srd'] }],
  getSrdRules: () => [{ title: 'Cover', content: '# Cover', tags: ['srd', 'combat'] }],
}));

vi.mock('~/server/db/models/Spell', () => ({ Spell: { insertMany: vi.fn() } }));
vi.mock('~/server/db/models/Race', () => ({ Race: { insertMany: vi.fn() } }));
vi.mock('~/server/db/models/Rule', () => ({ Rule: { insertMany: vi.fn() } }));

import { importSrdContent } from '~/server/functions/srdImport';
import { Spell } from '~/server/db/models/Spell';
import { Race } from '~/server/db/models/Race';
import { Rule } from '~/server/db/models/Rule';

// insertMany's typed overloads make mock.calls a strict tuple; read the first
// call's (docs[], options) loosely so assertions can inspect the inserted docs.
type InsertManyFn = { mock: { calls: unknown[][] } };
function firstCall(fn: InsertManyFn): [Array<Record<string, unknown>>, unknown] {
  return fn.mock.calls[0] as [Array<Record<string, unknown>>, unknown];
}

beforeEach(() => vi.clearAllMocks());

describe('importSrdContent', () => {
  it('inserts SRD spells (source srd), races, and rules scoped to the campaign', async () => {
    const result = await importSrdContent({ campaignId: 'camp-1', gmId: 'gm-1' });
    expect(result).toEqual({ spells: 1, races: 1, rules: 1 });

    expect(firstCall(Spell.insertMany as unknown as InsertManyFn)[0][0]).toMatchObject({
      source: 'srd',
      campaignId: 'camp-1',
      createdBy: 'gm-1',
      name: 'Fire Bolt',
    });
    expect(firstCall(Race.insertMany as unknown as InsertManyFn)[0][0]).toMatchObject({
      title: 'Elf',
      campaignId: 'camp-1',
      createdBy: 'gm-1',
    });
    expect(firstCall(Rule.insertMany as unknown as InsertManyFn)[0][0]).toMatchObject({
      title: 'Cover',
      isPublic: true,
      campaignId: 'camp-1',
    });
  });

  it('threads the Mongo session into insertMany when provided', async () => {
    const session = { id: 'sess' } as never;
    await importSrdContent({ campaignId: 'camp-1', gmId: 'gm-1', session });
    expect(firstCall(Spell.insertMany as unknown as InsertManyFn)[1]).toEqual({ session });
  });
});
