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
vi.mock('~/server/db/models/Calendar', () => ({
  Calendar: { findOne: vi.fn(), findOneAndUpdate: vi.fn(), deleteOne: vi.fn() },
}));
vi.mock('~/server/db/models/Event', () => ({ Event: { find: vi.fn(), bulkWrite: vi.fn() } }));
vi.mock('~/server/utils/posthog', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Calendar } from '~/server/db/models/Calendar';
import { Event } from '~/server/db/models/Event';
import {
  upsertCalendar,
  getCalendar,
  setCurrentDate,
  deleteCalendar,
} from '~/server/functions/calendars';

const session = { id: 'sess-1' } as never;
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

const _upsert = upsertCalendar as unknown as (a: {
  data: Record<string, unknown>;
}) => Promise<unknown>;
const _get = getCalendar as unknown as (a: { data: Record<string, unknown> }) => Promise<unknown>;
const _setDate = setCurrentDate as unknown as (a: {
  data: Record<string, unknown>;
}) => Promise<unknown>;
const _delete = deleteCalendar as unknown as (a: {
  data: Record<string, unknown>;
}) => Promise<unknown>;

const baseInput = {
  campaignId: 'camp-1',
  name: 'Harptos',
  description: '',
  months: [{ name: 'Hammer', days: 30 }],
  weekdays: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'],
  weekdayMode: 'continuous',
  epoch: { year: 1, weekdayIndex: 0 },
  yearSuffix: 'DR',
  namedYears: [],
  leapDays: [],
  moons: [],
  seasons: [],
  holidays: [],
  currentDate: { year: 1, monthIndex: 0, day: 1 },
};

const calDoc = {
  _id: 'cal-1',
  createdBy: 'user-1',
  ...baseInput,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(session);
  vi.mocked(User.findOne).mockResolvedValue({ _id: 'user-1' } as never);
  vi.mocked(Campaign.findById).mockResolvedValue(gmCampaign as never);
});

describe('upsertCalendar', () => {
  it('forbids a non-GM from saving', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    await expect(_upsert({ data: baseInput })).rejects.toThrow('Forbidden');
  });

  it('upserts for a GM and returns success with empty event list', async () => {
    vi.mocked(Calendar.findOneAndUpdate).mockResolvedValue(calDoc as never);
    vi.mocked(Event.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([]),
    } as never);
    const res = (await _upsert({ data: baseInput })) as Record<string, unknown>;
    expect(res.success).toBe(true);
    expect(res.invalidEventIds).toEqual([]);
  });
});

describe('getCalendar', () => {
  it('returns null when no calendar exists', async () => {
    vi.mocked(Calendar.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);
    const res = await _get({ data: { campaignId: 'camp-1' } });
    expect(res).toBeNull();
  });

  it('returns serialized calendar for a member', async () => {
    vi.mocked(Calendar.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(calDoc),
    } as never);
    const res = (await _get({ data: { campaignId: 'camp-1' } })) as Record<string, unknown>;
    expect(res).not.toBeNull();
    expect(res.name).toBe('Harptos');
    expect(res.canEdit).toBe(true); // GM
  });

  it('canEdit is false for a non-GM member', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Calendar.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(calDoc),
    } as never);
    const res = (await _get({ data: { campaignId: 'camp-1' } })) as Record<string, unknown>;
    expect(res.canEdit).toBe(false);
  });
});

describe('setCurrentDate', () => {
  it('forbids a non-GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    await expect(
      _setDate({ data: { campaignId: 'camp-1', currentDate: { year: 1, monthIndex: 0, day: 2 } } })
    ).rejects.toThrow('Forbidden');
  });

  it('updates currentDate for a GM', async () => {
    vi.mocked(Calendar.findOneAndUpdate).mockResolvedValue({
      ...calDoc,
      currentDate: { year: 1, monthIndex: 0, day: 2 },
    } as never);
    const res = (await _setDate({
      data: { campaignId: 'camp-1', currentDate: { year: 1, monthIndex: 0, day: 2 } },
    })) as Record<string, Record<string, unknown>>;
    expect(res.success).toBe(true);
    expect(res.calendar.currentDate).toEqual({ year: 1, monthIndex: 0, day: 2 });
  });
});

describe('deleteCalendar', () => {
  it('forbids a non-GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    await expect(_delete({ data: { campaignId: 'camp-1' } })).rejects.toThrow('Forbidden');
  });

  it('deletes for a GM', async () => {
    vi.mocked(Calendar.deleteOne).mockResolvedValue({ deletedCount: 1 } as never);
    const res = await _delete({ data: { campaignId: 'camp-1' } });
    expect(res).toEqual({ success: true });
    expect(Calendar.deleteOne).toHaveBeenCalledWith({ campaignId: 'camp-1' });
  });
});
