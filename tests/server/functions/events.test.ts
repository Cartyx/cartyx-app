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
import { removeDocumentRefsFromScreens } from '~/server/functions/gmscreens-helpers';
import {
  listEvents,
  createEvent,
  getEvent,
  updateEvent,
  deleteEvent,
} from '~/server/functions/events';

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
const _get = getEvent as unknown as (a: {
  data: Record<string, unknown>;
}) => Promise<Record<string, unknown> | null>;
const _update = updateEvent as unknown as (a: {
  data: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const _delete = deleteEvent as unknown as (a: {
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
  it('rejects an end date before the start date', async () => {
    await expect(
      _create({
        data: {
          campaignId: 'camp-1',
          title: 'T',
          start: { year: 1, monthIndex: 0, day: 5 },
          end: { year: 1, monthIndex: 0, day: 2 },
        },
      })
    ).rejects.toThrow(/on or after the start date/);
    expect(Event.create).not.toHaveBeenCalled();
  });
  it('returns seroval-safe plain objects even from a live mongoose document', async () => {
    // Event.create returns a hydrated document whose subdocuments (start/end)
    // and arrays (tags) are class instances, not plain objects. The server-fn
    // response is serialized by seroval, which throws
    // SerovalUnsupportedTypeError on non-plain prototypes — the exact failure
    // that made the calendar e2e's "create event" modal report
    // "Failed to create event" while the insert itself succeeded.
    class SubDoc {
      constructor(
        public year: number,
        public monthIndex: number,
        public day: number
      ) {}
    }
    class FakeMongooseArray extends Array<string> {}
    const tags = new FakeMongooseArray();
    tags.push('festival');
    vi.mocked(Event.create).mockImplementation(
      async (doc: Record<string, unknown>) =>
        ({
          _id: 'e1',
          ...doc,
          start: new SubDoc(1, 0, 2),
          end: new SubDoc(1, 0, 3),
          tags,
        }) as never
    );
    const result = await _create({
      data: {
        campaignId: 'camp-1',
        title: 'T',
        start: { year: 1, monthIndex: 0, day: 2 },
        end: { year: 1, monthIndex: 0, day: 3 },
        tags: ['festival'],
      },
    });
    const event = result.event as Record<string, unknown>;
    expect(event.start).toEqual({ year: 1, monthIndex: 0, day: 2 });
    expect(Object.getPrototypeOf(event.start)).toBe(Object.prototype);
    expect(event.end).toEqual({ year: 1, monthIndex: 0, day: 3 });
    expect(Object.getPrototypeOf(event.end)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(event.tags)).toBe(Array.prototype);
    expect(event.tags).toEqual(['festival']);
  });
});

// ---------------------------------------------------------------------------
// getEvent
// ---------------------------------------------------------------------------

const publicEventDoc = {
  _id: 'e1',
  campaignId: 'camp-1',
  calendarId: 'cal-1',
  createdBy: 'user-1',
  title: 'T',
  content: 'pub',
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
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('getEvent', () => {
  it('strips gmContent for a non-GM member', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Event.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue(publicEventDoc),
    } as never);
    const res = await _get({ data: { id: 'e1', campaignId: 'camp-1' } });
    expect(res).not.toBeNull();
    expect(res!.gmContent).toBe('');
    expect(res!.content).toBe('pub');
  });

  it('returns gmContent for a GM member', async () => {
    // gmCampaign is already the default from beforeEach
    vi.mocked(Event.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue(publicEventDoc),
    } as never);
    const res = await _get({ data: { id: 'e1', campaignId: 'camp-1' } });
    expect(res).not.toBeNull();
    expect(res!.gmContent).toBe('secret');
  });

  it('hides a non-public event from a non-GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Event.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ ...publicEventDoc, isPublic: false }),
    } as never);
    const res = await _get({ data: { id: 'e1', campaignId: 'camp-1' } });
    expect(res).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateEvent
// ---------------------------------------------------------------------------

describe('updateEvent', () => {
  it('recomputes startOrdinal and endOrdinal from the calendar', async () => {
    // gmCampaign + calDoc are set up in beforeEach
    vi.mocked(Event.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: 'e1', campaignId: 'camp-1' }),
    } as never);
    vi.mocked(Event.findOneAndUpdate).mockResolvedValue({
      _id: 'e1',
      campaignId: 'camp-1',
      calendarId: 'cal-1',
      createdBy: 'user-1',
      start: { year: 1, monthIndex: 0, day: 3 },
      end: null,
      startOrdinal: 2,
      endOrdinal: 2,
      links: [],
      images: [],
      tags: [],
    } as never);

    await _update({
      data: {
        id: 'e1',
        campaignId: 'camp-1',
        title: 'T',
        start: { year: 1, monthIndex: 0, day: 3 },
        end: null,
      },
    });

    const updateArg = vi.mocked(Event.findOneAndUpdate).mock.calls[0][1] as Record<
      string,
      Record<string, unknown>
    >;
    expect(updateArg.$set.startOrdinal).toBe(2);
    expect(updateArg.$set.endOrdinal).toBe(2);
  });

  it('rejects an end date before the start date', async () => {
    vi.mocked(Event.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: 'e1', campaignId: 'camp-1' }),
    } as never);
    await expect(
      _update({
        data: {
          id: 'e1',
          campaignId: 'camp-1',
          title: 'T',
          start: { year: 1, monthIndex: 0, day: 5 },
          end: { year: 1, monthIndex: 0, day: 2 },
        },
      })
    ).rejects.toThrow(/on or after the start date/);
    expect(Event.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a non-GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    await expect(
      _update({
        data: {
          id: 'e1',
          campaignId: 'camp-1',
          title: 'T',
          start: { year: 1, monthIndex: 0, day: 1 },
        },
      })
    ).rejects.toThrow('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// deleteEvent
// ---------------------------------------------------------------------------

describe('deleteEvent', () => {
  it('rejects a non-GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    await expect(_delete({ data: { id: 'e1', campaignId: 'camp-1' } })).rejects.toThrow(
      'Forbidden'
    );
  });

  it('GM deletes an event and removeDocumentRefsFromScreens is called', async () => {
    vi.mocked(Event.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: 'e1', campaignId: 'camp-1' }),
    } as never);
    vi.mocked(Event.deleteOne).mockResolvedValue({ deletedCount: 1 } as never);

    const result = await _delete({ data: { id: 'e1', campaignId: 'camp-1' } });

    expect(vi.mocked(removeDocumentRefsFromScreens)).toHaveBeenCalledOnce();
    expect(vi.mocked(removeDocumentRefsFromScreens)).toHaveBeenCalledWith('camp-1', 'events', 'e1');
    expect(result.success).toBe(true);
  });
});
