import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/db/connection', () => ({
  connectDB: vi.fn(),
  isDBConnected: vi.fn(() => true),
}));
vi.mock('~/server/db/models/User', () => ({ User: { findOne: vi.fn() } }));
vi.mock('~/server/db/models/Campaign', () => ({ Campaign: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Spell', () => ({
  Spell: {
    create: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    find: vi.fn(),
  },
}));
vi.mock('~/server/functions/tags', () => ({ ensureTags: vi.fn().mockResolvedValue(undefined) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Spell } from '~/server/db/models/Spell';
import {
  createSpell,
  updateSpell,
  deleteSpell,
  duplicateSpell,
  listSpells,
  getSpell,
} from '~/server/functions/spells';

const mockSession = {
  id: 'session-user-1',
  provider: 'google',
  name: 'T',
  email: 't@e.com',
  avatar: null,
  role: 'gm',
  accessToken: null,
  refreshToken: null,
  tokenIssuedAt: 0,
};
const mockDbUser = { _id: 'dbuser-1' };
const mockGMCampaign = {
  _id: 'camp-1',
  gameMasterId: 'dbuser-1',
  members: [{ userId: 'dbuser-1', role: 'gm' }],
};
const mockPlayerCampaign = {
  _id: 'camp-1',
  gameMasterId: 'someone-else',
  members: [
    { userId: 'someone-else', role: 'gm' },
    { userId: 'dbuser-1', role: 'player' },
  ],
};

function makeSpell(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'spell-1',
    campaignId: 'camp-1',
    createdBy: 'dbuser-1',
    source: 'homebrew',
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
    modifiers: [],
    conditions: [],
    higherLevels: [],
    areaOfEffect: { shape: 'none' },
    tags: ['fire'],
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    deleteOne: vi.fn(),
    ...overrides,
  };
}

const validInput = {
  campaignId: 'camp-1',
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
  modifiers: [],
  conditions: [],
  higherLevels: [],
  areaOfEffect: { shape: 'none' },
  tags: ['fire'],
};

// A chainable stub for Spell.find(...).select(...).sort(...).lean()
function findChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.sort = () => chain;
  chain.lean = () => Promise.resolve(rows);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession as never);
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser as never);
  vi.mocked(Campaign.findById).mockResolvedValue(mockGMCampaign as never);
});

describe('createSpell', () => {
  it('creates a homebrew spell for a GM and returns canEdit true', async () => {
    vi.mocked(Spell.create).mockResolvedValue(makeSpell() as never);
    const result = await createSpell({ data: validInput as never });
    expect(result.source).toBe('homebrew');
    expect(result.canEdit).toBe(true);
    expect(vi.mocked(Spell.create).mock.calls[0][0]).toMatchObject({
      source: 'homebrew',
      createdBy: 'dbuser-1',
    });
  });

  it('forbids a non-GM from creating', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign as never);
    await expect(createSpell({ data: validInput as never })).rejects.toThrow('Forbidden');
  });
});

describe('updateSpell / deleteSpell SRD protection', () => {
  it('rejects updating an SRD spell', async () => {
    vi.mocked(Spell.findOne).mockResolvedValue(makeSpell({ source: 'srd' }) as never);
    await expect(
      updateSpell({ data: { ...validInput, id: 'spell-1', name: 'Hacked' } as never })
    ).rejects.toThrow('read-only');
  });

  it('rejects deleting an SRD spell', async () => {
    vi.mocked(Spell.findOne).mockResolvedValue(makeSpell({ source: 'srd' }) as never);
    await expect(deleteSpell({ data: { id: 'spell-1', campaignId: 'camp-1' } })).rejects.toThrow(
      'read-only'
    );
  });

  it('updates a homebrew spell', async () => {
    vi.mocked(Spell.findOne).mockResolvedValue(makeSpell({ source: 'homebrew' }) as never);
    vi.mocked(Spell.findOneAndUpdate).mockResolvedValue(makeSpell({ name: 'New Name' }) as never);
    const result = await updateSpell({
      data: { ...validInput, id: 'spell-1', name: 'New Name' } as never,
    });
    expect(result.name).toBe('New Name');
  });

  it('deletes a homebrew spell', async () => {
    const doc = makeSpell({ source: 'homebrew' });
    vi.mocked(Spell.findOne).mockResolvedValue(doc as never);
    const result = await deleteSpell({ data: { id: 'spell-1', campaignId: 'camp-1' } });
    expect(result).toEqual({ success: true });
    expect(doc.deleteOne).toHaveBeenCalled();
  });
});

describe('duplicateSpell', () => {
  it('copies an SRD spell into an editable homebrew copy', async () => {
    vi.mocked(Spell.findOne).mockReturnValue({
      lean: () => Promise.resolve(makeSpell({ source: 'srd', name: 'Fireball' })),
    } as never);
    vi.mocked(Spell.create).mockResolvedValue(
      makeSpell({ _id: 'spell-2', source: 'homebrew', name: 'Fireball (Copy)' }) as never
    );
    const copy = await duplicateSpell({ data: { id: 'spell-1', campaignId: 'camp-1' } });
    expect(copy.source).toBe('homebrew');
    expect(copy.canEdit).toBe(true);
    expect(copy.name).toContain('Copy');
  });

  it('forbids a non-GM from duplicating', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign as never);
    await expect(duplicateSpell({ data: { id: 'spell-1', campaignId: 'camp-1' } })).rejects.toThrow(
      'Forbidden'
    );
  });
});

describe('listSpells', () => {
  it('passes level/school filters to the query and sets canEdit per source for a GM', async () => {
    vi.mocked(Spell.find).mockReturnValue(
      findChain([
        makeSpell({ _id: 's-srd', source: 'srd', level: 0 }),
        makeSpell({ _id: 's-hb', source: 'homebrew', level: 3 }),
      ]) as never
    );
    const result = await listSpells({
      data: { campaignId: 'camp-1', level: 3, school: 'evocation' },
    });
    expect(vi.mocked(Spell.find).mock.calls[0][0]).toMatchObject({
      campaignId: 'camp-1',
      level: 3,
      school: 'evocation',
    });
    expect(result.find((s) => s.source === 'srd')!.canEdit).toBe(false);
    expect(result.find((s) => s.source === 'homebrew')!.canEdit).toBe(true);
  });

  it('gives players canEdit false everywhere', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign as never);
    vi.mocked(Spell.find).mockReturnValue(findChain([makeSpell({ source: 'homebrew' })]) as never);
    const result = await listSpells({ data: { campaignId: 'camp-1' } });
    expect(result[0].canEdit).toBe(false);
  });
});

describe('getSpell', () => {
  it('returns the full spell with canEdit for a GM homebrew spell', async () => {
    vi.mocked(Spell.findOne).mockReturnValue({
      lean: () => Promise.resolve(makeSpell({ source: 'homebrew' })),
    } as never);
    const result = await getSpell({ data: { id: 'spell-1', campaignId: 'camp-1' } });
    expect(result?.description).toBe('A mote of fire.');
    expect(result?.canEdit).toBe(true);
  });

  it('returns canEdit false for an SRD spell even for a GM', async () => {
    vi.mocked(Spell.findOne).mockReturnValue({
      lean: () => Promise.resolve(makeSpell({ source: 'srd' })),
    } as never);
    const result = await getSpell({ data: { id: 'spell-1', campaignId: 'camp-1' } });
    expect(result?.canEdit).toBe(false);
  });
});
