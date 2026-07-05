import { z } from 'zod';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { removeDocumentRefsFromScreens } from './gmscreens-helpers';
import { serverCaptureException } from '../utils/posthog';
import { Event } from '../db/models/Event';
import { Calendar } from '../db/models/Calendar';
import { Character } from '../db/models/Character';
import { Player } from '../db/models/Player';
import { Location } from '../db/models/Location';
import { Race } from '../db/models/Race';
import { Lore } from '../db/models/Lore';
import {
  listEventsSchema,
  getEventSchema,
  createEventSchema,
  updateEventSchema,
  deleteEventSchema,
} from '~/types/schemas/events';
import type { EventData, EventLink, EventListItem } from '~/types/event';
import { toOrdinal, validateDate } from '~/utils/calendarEngine';
import type { CalendarConfig, CalDate } from '~/utils/calendarEngine';

type AnyDoc = Record<string, unknown> & { _id: unknown };

async function loadCalendar(campaignId: string): Promise<{ cfg: CalendarConfig; id: unknown }> {
  const cal = (await Calendar.findOne({ campaignId }).lean()) as AnyDoc | null;
  if (!cal) throw new Error('No calendar exists for this campaign. Create one first.');
  const cfg: CalendarConfig = {
    months: cal.months as CalendarConfig['months'],
    weekdays: cal.weekdays as string[],
    weekdayMode: cal.weekdayMode as CalendarConfig['weekdayMode'],
    epoch: cal.epoch as CalendarConfig['epoch'],
    yearSuffix: cal.yearSuffix as string,
    leapDays: cal.leapDays as CalendarConfig['leapDays'],
    moons: cal.moons as CalendarConfig['moons'],
    seasons: cal.seasons as CalendarConfig['seasons'],
    holidays: cal.holidays as CalendarConfig['holidays'],
  };
  return { cfg, id: cal._id };
}

function baseSerialize(doc: AnyDoc) {
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    calendarId: String(doc.calendarId),
    createdBy: String(doc.createdBy),
    title: (doc.title as string) ?? '',
    content: (doc.content as string) ?? '',
    isPublic: Boolean(doc.isPublic),
    isEpic: Boolean(doc.isEpic),
    start: doc.start as CalDate,
    end: (doc.end as CalDate | null) ?? null,
    startOrdinal: Number(doc.startOrdinal ?? 0),
    endOrdinal: Number(doc.endOrdinal ?? 0),
    links: ((doc.links as unknown[]) ?? []).map((l) => {
      const lk = l as Record<string, unknown>;
      return { kind: lk.kind as EventLink['kind'], id: String(lk.id) };
    }) as EventLink[],
    sessionId: doc.sessionId ? String(doc.sessionId) : null,
    images: ((doc.images as unknown[]) ?? []).map((i) => {
      const img = i as Record<string, unknown>;
      return {
        url: String(img.url),
        caption: (img.caption as string) ?? '',
        crop: (img.crop as EventData['images'][number]['crop']) ?? null,
      };
    }),
    tags: (doc.tags as string[]) ?? [],
    color: (doc.color as string | null) ?? null,
    createdAt: (doc.createdAt as Date)?.toISOString?.() ?? '',
    updatedAt: (doc.updatedAt as Date)?.toISOString?.() ?? '',
  };
}

async function resolveLinkLabels(links: EventLink[]): Promise<EventLink[]> {
  return Promise.all(
    links.map(async (link) => {
      let label = '';
      try {
        if (link.kind === 'character') {
          const c = (await Character.findById(
            link.id,
            'firstName lastName'
          ).lean()) as AnyDoc | null;
          if (c) label = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
        } else if (link.kind === 'player') {
          const p = (await Player.findById(link.id, 'firstName lastName').lean()) as AnyDoc | null;
          if (p) label = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
        } else if (link.kind === 'location') {
          const loc = (await Location.findById(link.id, 'name').lean()) as AnyDoc | null;
          if (loc) label = String(loc.name ?? '');
        } else if (link.kind === 'race') {
          const r = (await Race.findById(link.id, 'title').lean()) as AnyDoc | null;
          if (r) label = String(r.title ?? '');
        } else if (link.kind === 'lore') {
          const l = (await Lore.findById(link.id, 'title').lean()) as AnyDoc | null;
          if (l) label = String(l.title ?? '');
        }
      } catch {
        label = '';
      }
      return { ...link, label };
    })
  );
}

// ---------------------------------------------------------------------------
// listEvents
// ---------------------------------------------------------------------------

export const listEvents = async ({ data }: { data: z.infer<typeof listEventsSchema> }) => {
  try {
    const member = await requireCampaignMember(data.campaignId);
    const filter: Record<string, unknown> = { campaignId: data.campaignId };

    // Events are GM-owned (no player-authored events), so non-GMs see only public events — no "see your own" branch like lore.
    if (!member.isGM) {
      filter.isPublic = true;
    } else if (data.visibility === 'public') {
      filter.isPublic = true;
    } else if (data.visibility === 'private') {
      filter.isPublic = false;
    }

    if (data.epicOnly) filter.isEpic = true;
    if (data.tags?.length) filter.tags = { $all: data.tags };
    if (data.search) filter.$text = { $search: data.search };
    if (data.linkedKind && data.linkedId) {
      filter.links = { $elemMatch: { kind: data.linkedKind, id: data.linkedId } };
    }

    const docs = (await Event.find(filter).sort({ startOrdinal: 1 }).lean()) as AnyDoc[];
    const items: EventListItem[] = docs.map((doc) => ({
      ...baseSerialize(doc),
      canEdit: member.isGM,
    }));
    return items;
  } catch (e) {
    serverCaptureException(e, undefined, { action: 'listEvents', campaignId: data.campaignId });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// getEvent
// ---------------------------------------------------------------------------

export const getEvent = async ({ data }: { data: z.infer<typeof getEventSchema> }) => {
  try {
    const member = await requireCampaignMember(data.campaignId);
    const doc = (await Event.findById(data.id).lean()) as AnyDoc | null;
    if (!doc || String(doc.campaignId) !== data.campaignId) return null;
    if (!member.isGM && !doc.isPublic) return null;

    const links = await resolveLinkLabels(
      ((doc.links as unknown[]) ?? []).map((l) => {
        const lk = l as Record<string, unknown>;
        return { kind: lk.kind as EventLink['kind'], id: String(lk.id) };
      })
    );

    const result: EventData = {
      ...baseSerialize(doc),
      gmContent: member.isGM ? ((doc.gmContent as string) ?? '') : '',
      links,
      canEdit: member.isGM,
    };
    return result;
  } catch (e) {
    serverCaptureException(e, undefined, { action: 'getEvent', eventId: data.id });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// createEvent
// ---------------------------------------------------------------------------

export const createEvent = async ({ data }: { data: z.infer<typeof createEventSchema> }) => {
  try {
    const member = await requireCampaignMember(data.campaignId);
    if (!member.isGM) throw new Error('Forbidden');

    const { cfg, id: calendarId } = await loadCalendar(data.campaignId);
    const safeGmContent = member.isGM ? (data.gmContent ?? '') : '';

    const sv = validateDate(cfg, data.start);
    if (!sv.ok) throw new Error(sv.error);
    const startOrdinal = toOrdinal(cfg, data.start);
    let endOrdinal = startOrdinal;
    if (data.end) {
      const ev = validateDate(cfg, data.end);
      if (!ev.ok) throw new Error(ev.error);
      endOrdinal = toOrdinal(cfg, data.end);
      if (endOrdinal < startOrdinal)
        throw new Error('Event end date must be on or after the start date.');
    }

    const doc = (await Event.create({
      title: data.title,
      content: data.content,
      gmContent: safeGmContent,
      isPublic: data.isPublic,
      isEpic: data.isEpic,
      start: data.start,
      end: data.end,
      startOrdinal,
      endOrdinal,
      links: data.links,
      sessionId: data.sessionId,
      images: data.images,
      tags: data.tags,
      color: data.color,
      campaignId: data.campaignId,
      calendarId: calendarId,
      createdBy: member.userId,
    })) as AnyDoc;

    return {
      success: true,
      event: {
        ...baseSerialize(doc),
        gmContent: safeGmContent,
        canEdit: true,
      },
    };
  } catch (e) {
    serverCaptureException(e, undefined, { action: 'createEvent', campaignId: data.campaignId });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// updateEvent
// ---------------------------------------------------------------------------

export const updateEvent = async ({ data }: { data: z.infer<typeof updateEventSchema> }) => {
  try {
    const member = await requireCampaignMember(data.campaignId);
    if (!member.isGM) throw new Error('Forbidden');

    const existing = (await Event.findById(data.id).lean()) as AnyDoc | null;
    if (!existing || String(existing.campaignId) !== data.campaignId) throw new Error('Not found');

    const { cfg } = await loadCalendar(data.campaignId);
    const safeGmContent = member.isGM ? (data.gmContent ?? '') : '';

    const sv = validateDate(cfg, data.start);
    if (!sv.ok) throw new Error(sv.error);
    const startOrdinal = toOrdinal(cfg, data.start);
    let endOrdinal = startOrdinal;
    if (data.end) {
      const ev = validateDate(cfg, data.end);
      if (!ev.ok) throw new Error(ev.error);
      endOrdinal = toOrdinal(cfg, data.end);
      if (endOrdinal < startOrdinal)
        throw new Error('Event end date must be on or after the start date.');
    }

    const updated = (await Event.findOneAndUpdate(
      { _id: data.id, campaignId: data.campaignId },
      {
        $set: {
          title: data.title,
          content: data.content,
          gmContent: safeGmContent,
          isPublic: data.isPublic,
          isEpic: data.isEpic,
          start: data.start,
          end: data.end,
          startOrdinal,
          endOrdinal,
          links: data.links,
          sessionId: data.sessionId,
          images: data.images,
          tags: data.tags,
          color: data.color,
          updatedAt: new Date(),
        },
      },
      { new: true, lean: true }
    )) as AnyDoc;

    return {
      success: true,
      event: {
        ...baseSerialize(updated),
        gmContent: safeGmContent,
        canEdit: true,
      },
    };
  } catch (e) {
    serverCaptureException(e, undefined, { action: 'updateEvent', eventId: data.id });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// deleteEvent
// ---------------------------------------------------------------------------

export const deleteEvent = async ({ data }: { data: z.infer<typeof deleteEventSchema> }) => {
  try {
    const member = await requireCampaignMember(data.campaignId);
    if (!member.isGM) throw new Error('Forbidden');

    const existing = (await Event.findById(data.id).lean()) as AnyDoc | null;
    if (!existing || String(existing.campaignId) !== data.campaignId) throw new Error('Not found');

    await Event.deleteOne({ _id: data.id, campaignId: data.campaignId });
    // Signature: removeDocumentRefsFromScreens(campaignId, collection, documentId)
    await removeDocumentRefsFromScreens(data.campaignId, 'events', data.id);
    return { success: true };
  } catch (e) {
    serverCaptureException(e, undefined, { action: 'deleteEvent', eventId: data.id });
    throw e;
  }
};
