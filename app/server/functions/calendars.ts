import { z } from 'zod';
import type { AnyBulkWriteOperation } from 'mongoose';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { serverCaptureException } from '../utils/telemetry';
import { Calendar } from '../db/models/Calendar';
import { Event } from '../db/models/Event';
import {
  getCalendarSchema,
  upsertCalendarSchema,
  setCurrentDateSchema,
  deleteCalendarSchema,
} from '~/types/schemas/calendars';
import type { CalendarData } from '~/types/calendar';
import { toOrdinal, validateDate, type CalendarConfig, type CalDate } from '~/utils/calendarEngine';

type AnyDoc = Record<string, unknown> & { _id: unknown };

function toConfig(doc: Record<string, unknown>): CalendarConfig {
  return {
    months: doc.months as CalendarConfig['months'],
    weekdays: doc.weekdays as string[],
    weekdayMode: doc.weekdayMode as CalendarConfig['weekdayMode'],
    epoch: doc.epoch as CalendarConfig['epoch'],
    yearSuffix: doc.yearSuffix as string,
    leapDays: doc.leapDays as CalendarConfig['leapDays'],
    moons: doc.moons as CalendarConfig['moons'],
    seasons: doc.seasons as CalendarConfig['seasons'],
    holidays: doc.holidays as CalendarConfig['holidays'],
  };
}

function serialize(doc: AnyDoc, canEdit: boolean): CalendarData {
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    createdBy: String(doc.createdBy),
    name: (doc.name as string) ?? '',
    description: (doc.description as string) ?? '',
    months: (doc.months as CalendarData['months']) ?? [],
    weekdays: (doc.weekdays as string[]) ?? [],
    weekdayMode: (doc.weekdayMode as CalendarData['weekdayMode']) ?? 'continuous',
    epoch: (doc.epoch as CalendarData['epoch']) ?? { year: 1, weekdayIndex: 0 },
    yearSuffix: (doc.yearSuffix as string) ?? '',
    namedYears: (doc.namedYears as CalendarData['namedYears']) ?? [],
    leapDays: (doc.leapDays as CalendarData['leapDays']) ?? [],
    moons: (doc.moons as CalendarData['moons']) ?? [],
    seasons: (doc.seasons as CalendarData['seasons']) ?? [],
    holidays: (doc.holidays as CalendarData['holidays']) ?? [],
    currentDate: (doc.currentDate as CalDate) ?? { year: 1, monthIndex: 0, day: 1 },
    createdAt: (doc.createdAt as Date)?.toISOString?.() ?? '',
    updatedAt: (doc.updatedAt as Date)?.toISOString?.() ?? '',
    canEdit,
  };
}

// ---------------------------------------------------------------------------
// getCalendar
// ---------------------------------------------------------------------------

export const getCalendar = async ({ data }: { data: z.infer<typeof getCalendarSchema> }) => {
  try {
    const member = await requireCampaignMember(data.campaignId);
    const doc = (await Calendar.findOne({ campaignId: data.campaignId }).lean()) as AnyDoc | null;
    if (!doc) return null;
    return serialize(doc, member.isGM);
  } catch (e) {
    serverCaptureException(e, undefined, { action: 'getCalendar', campaignId: data.campaignId });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// upsertCalendar
// ---------------------------------------------------------------------------

export const upsertCalendar = async ({ data }: { data: z.infer<typeof upsertCalendarSchema> }) => {
  try {
    const member = await requireCampaignMember(data.campaignId);
    if (!member.isGM) throw new Error('Forbidden');

    const cfg = toConfig(data);
    const cd = validateDate(cfg, data.currentDate);
    if (!cd.ok) throw new Error(cd.error ?? 'Current date is invalid for this calendar');
    const doc = (await Calendar.findOneAndUpdate(
      { campaignId: data.campaignId },
      {
        $set: {
          name: data.name,
          description: data.description,
          months: data.months,
          weekdays: data.weekdays,
          weekdayMode: data.weekdayMode,
          epoch: data.epoch,
          yearSuffix: data.yearSuffix,
          namedYears: data.namedYears,
          leapDays: data.leapDays,
          moons: data.moons,
          seasons: data.seasons,
          holidays: data.holidays,
          currentDate: data.currentDate,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          campaignId: data.campaignId,
          createdBy: member.userId,
          createdAt: new Date(),
        },
      },
      { new: true, upsert: true, lean: true }
    )) as AnyDoc;

    // Re-validate every event against the new config and recompute ordinals.
    const events = (await Event.find(
      { campaignId: data.campaignId },
      { start: 1, end: 1 }
    ).lean()) as AnyDoc[];
    const invalidEventIds: string[] = [];
    const ops: AnyBulkWriteOperation[] = [];
    for (const ev of events) {
      const start = ev.start as CalDate;
      const end = (ev.end as CalDate | null) ?? null;
      const startOk = validateDate(cfg, start).ok;
      const endOk = end ? validateDate(cfg, end).ok : true;
      if (!startOk || !endOk) {
        invalidEventIds.push(String(ev._id));
        continue;
      }
      const startOrd = toOrdinal(cfg, start);
      ops.push({
        updateOne: {
          filter: { _id: ev._id },
          update: {
            $set: {
              startOrdinal: startOrd,
              endOrdinal: end ? toOrdinal(cfg, end) : startOrd,
            },
          },
        },
      });
    }
    if (ops.length) await Event.bulkWrite(ops);

    return { success: true, calendar: serialize(doc, true), invalidEventIds };
  } catch (e) {
    serverCaptureException(e, undefined, {
      action: 'upsertCalendar',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// setCurrentDate
// ---------------------------------------------------------------------------

export const setCurrentDate = async ({ data }: { data: z.infer<typeof setCurrentDateSchema> }) => {
  try {
    const member = await requireCampaignMember(data.campaignId);
    if (!member.isGM) throw new Error('Forbidden');
    const existing = (await Calendar.findOne({
      campaignId: data.campaignId,
    }).lean()) as AnyDoc | null;
    if (!existing) throw new Error('Not found');
    const cfg = toConfig(existing);
    const cd = validateDate(cfg, data.currentDate);
    if (!cd.ok) throw new Error(cd.error ?? 'Current date is invalid for this calendar');
    const doc = (await Calendar.findOneAndUpdate(
      { campaignId: data.campaignId },
      { $set: { currentDate: data.currentDate, updatedAt: new Date() } },
      { new: true, lean: true }
    )) as AnyDoc | null;
    if (!doc) throw new Error('Not found');
    return { success: true, calendar: serialize(doc, true) };
  } catch (e) {
    serverCaptureException(e, undefined, {
      action: 'setCurrentDate',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// deleteCalendar
// ---------------------------------------------------------------------------

export const deleteCalendar = async ({ data }: { data: z.infer<typeof deleteCalendarSchema> }) => {
  try {
    const member = await requireCampaignMember(data.campaignId);
    if (!member.isGM) throw new Error('Forbidden');
    await Calendar.deleteOne({ campaignId: data.campaignId });
    return { success: true };
  } catch (e) {
    serverCaptureException(e, undefined, {
      action: 'deleteCalendar',
      campaignId: data.campaignId,
    });
    throw e;
  }
};
