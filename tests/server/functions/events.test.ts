import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({ handler: (fn: unknown) => fn }),
    handler: (fn: unknown) => fn,
  }),
}));
vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/db/models/User', () => ({ User: { findOne: vi.fn() } }));
vi.mock('~/server/db/models/Campaign', () => ({ Campaign: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Calendar', () => ({ Calendar: { findOne: vi.fn() } }));
vi.mock('~/server/db/models/Event', () => ({
  Event: {
    find: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteOne: vi.fn(),
  },
}));
vi.mock('~/server/functions/gmscreens-helpers', () => ({ removeDocumentRefsFromScreens: vi.fn() }));
vi.mock('~/server/utils/posthog', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('~/server/db/models/Character', () => ({ Character: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Player', () => ({ Player: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Location', () => ({ Location: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Race', () => ({ Race: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Lore', () => ({ Lore: { findById: vi.fn() } }));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Calendar } from '~/server/db/models/Calendar';
import { Event } from '~/server/db/models/Event';
import { listEvents, createEvent } from '~/server/functions/events';

const gmCampaign = {
  _id: 'camp-1',
  gameMasterId: 'user-1',
  members: [{ userId: 'user-1', role: 'gm' }],
};
const playerCampaign = {
  _id: 'camp-1',
  gameMasterId: 'gm-x',
  members: [{ userId: 'user-1', role: 'player' }],
};
const calDoc = {
  months: [{ name: 'A', days: 30 }],
  weekdays: ['d1'],
  weekdayMode: 'continuous',
  epoch: { year: 1, weekdayIndex: 0 },
  yearSuffix: 'DR',
  leapDays: [],
  moons: [],
  seasons: [],
  holidays: [],
  _id: 'cal-1',
};

const _list = listEvents as unknown as (a: { data: Record<string, unknown> }) => Promise<unknown[]>;
const _create = createEvent as unknown as (a: {
  data: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

function mockEventFind(docs: unknown[]) {
  vi.mocked(Event.find).mockReturnValue({
    sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(docs) }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 'sess-1' } as never);
  vi.mocked(User.findOne).mockResolvedValue({ _id: 'user-1' } as never);
  vi.mocked(Campaign.findById).mockResolvedValue(gmCampaign as never);
  vi.mocked(Calendar.findOne).mockReturnValue({ lean: vi.fn().mockResolvedValue(calDoc) } as never);
});

describe('listEvents', () => {
  it('restricts non-GM to public events', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    mockEventFind([]);
    await _list({ data: { campaignId: 'camp-1' } });
    const filter = vi.mocked(Event.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(filter.isPublic).toBe(true);
  });
  it('adds epicOnly filter', async () => {
    mockEventFind([]);
    await _list({ data: { campaignId: 'camp-1', epicOnly: true } });
    const filter = vi.mocked(Event.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(filter.isEpic).toBe(true);
  });
  it('never returns gmContent', async () => {
    mockEventFind([
      {
        _id: 'e1',
        title: 'T',
        content: 'c',
        gmContent: 'secret',
        isPublic: true,
        isEpic: false,
        start: { year: 1, monthIndex: 0, day: 1 },
        end: null,
        startOrdinal: 0,
        endOrdinal: 0,
        links: [],
        images: [],
        tags: [],
        campaignId: 'camp-1',
        calendarId: 'cal-1',
        createdBy: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const res = (await _list({ data: { campaignId: 'camp-1' } })) as Record<string, unknown>[];
    expect(res[0]).not.toHaveProperty('gmContent');
  });
});

describe('createEvent', () => {
  it('forbids a non-GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    await expect(
      _create({
        data: { campaignId: 'camp-1', title: 'T', start: { year: 1, monthIndex: 0, day: 1 } },
      })
    ).rejects.toThrow('Forbidden');
  });
  it('computes startOrdinal/endOrdinal from the calendar', async () => {
    vi.mocked(Event.create).mockImplementation(
      async (doc: Record<string, unknown>) => ({ _id: 'e1', ...doc }) as never
    );
    await _create({
      data: {
        campaignId: 'camp-1',
        title: 'T',
        start: { year: 1, monthIndex: 0, day: 2 },
        end: null,
      },
    });
    const arg = vi.mocked(Event.create).mock.calls[0][0] as Record<string, unknown>;
    expect(arg.startOrdinal).toBe(1);
    expect(arg.endOrdinal).toBe(1);
  });
  it('rejects an out-of-range date', async () => {
    await expect(
      _create({
        data: { campaignId: 'camp-1', title: 'T', start: { year: 1, monthIndex: 0, day: 99 } },
      })
    ).rejects.toThrow(/Day/);
  });
});
