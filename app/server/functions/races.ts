import { createServerFn } from '@tanstack/react-start';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { Race } from '../db/models/Race';
import { serverCaptureException, serverCaptureEvent } from '../utils/posthog';
import { normalizeTags } from '../utils/helpers';
import { removeDocumentRefsFromScreens } from './gmscreens-helpers';
import { ensureTags as ensureTagsFn } from './tags';
import type { RaceData, RaceListItem } from '~/types/race';
import {
  createRaceSchema,
  updateRaceSchema,
  deleteRaceSchema,
  listRacesSchema,
  getRaceSchema,
} from '~/types/schemas/races';

function serializeRace(r: {
  _id: unknown;
  campaignId: unknown;
  createdBy: unknown;
  title?: string;
  content?: string;
  tags?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}): Omit<RaceData, 'canEdit'> {
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    createdBy: String(r.createdBy),
    title: r.title ?? '',
    content: r.content ?? '',
    tags: r.tags ?? [],
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : '',
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : '',
  };
}

function serializeRaceListItem(r: {
  _id: unknown;
  campaignId: unknown;
  createdBy: unknown;
  title?: string;
  tags?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}): Omit<RaceListItem, 'canEdit'> {
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    createdBy: String(r.createdBy),
    title: r.title ?? '',
    tags: r.tags ?? [],
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : '',
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : '',
  };
}

// ---------------------------------------------------------------------------
// createRace
// ---------------------------------------------------------------------------

export { createRaceSchema };

export const createRace = createServerFn({ method: 'POST' })
  .inputValidator(createRaceSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;
      if (!member.isGM) throw new Error('Forbidden');

      const finalTags = normalizeTags(data.tags ?? []);
      const race = new Race({
        campaignId: data.campaignId,
        createdBy: member.userId,
        title: data.title.trim(),
        content: data.content.trim(),
        tags: finalTags,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await race.save();

      if (finalTags.length > 0) {
        await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });
      }

      serverCaptureEvent(sessionUserId!, 'race_created', {
        campaign_id: data.campaignId,
        race_id: String(race._id),
      });

      return { ...serializeRace(race), canEdit: true } as RaceData;
    } catch (e) {
      serverCaptureException(e, sessionUserId, { action: 'createRace' });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// updateRace
// ---------------------------------------------------------------------------

export { updateRaceSchema };

export const updateRace = createServerFn({ method: 'POST' })
  .inputValidator(updateRaceSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;
      if (!member.isGM) throw new Error('Forbidden');

      const finalTags = normalizeTags(data.tags ?? []);
      const race = await Race.findOneAndUpdate(
        { _id: data.id, campaignId: data.campaignId },
        {
          $set: {
            title: data.title.trim(),
            content: data.content.trim(),
            tags: finalTags,
            updatedAt: new Date(),
          },
        },
        { new: true }
      );

      if (!race) throw new Error('Race not found');

      if (finalTags.length > 0) {
        await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });
      }

      serverCaptureEvent(sessionUserId!, 'race_updated', {
        campaign_id: data.campaignId,
        race_id: data.id,
      });

      return { ...serializeRace(race), canEdit: true } as RaceData;
    } catch (e) {
      serverCaptureException(e, sessionUserId, { action: 'updateRace' });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// deleteRace
// ---------------------------------------------------------------------------

export { deleteRaceSchema };

export const deleteRace = createServerFn({ method: 'POST' })
  .inputValidator(deleteRaceSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;
      if (!member.isGM) throw new Error('Forbidden');

      const race = await Race.findOne({ _id: data.id, campaignId: data.campaignId });
      if (!race) throw new Error('Race not found');

      await race.deleteOne();

      // Best-effort cleanup of GM screen references — the race is already deleted,
      // so cleanup failure must not surface as a user-facing error; report it and move on.
      try {
        await removeDocumentRefsFromScreens(data.campaignId, 'race', data.id);
      } catch (cleanupError) {
        serverCaptureException(cleanupError, sessionUserId, {
          action: 'deleteRace.cleanup',
          campaign_id: data.campaignId,
          race_id: data.id,
        });
      }

      serverCaptureEvent(sessionUserId!, 'race_deleted', {
        campaign_id: data.campaignId,
        race_id: data.id,
      });

      return { success: true };
    } catch (e) {
      serverCaptureException(e, sessionUserId, { action: 'deleteRace' });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// listRaces
// ---------------------------------------------------------------------------

export { listRacesSchema };

export const listRaces = createServerFn({ method: 'GET' })
  .inputValidator(listRacesSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const filter: Record<string, unknown> = { campaignId: data.campaignId };

      if (data.search) {
        filter.$text = { $search: data.search };
      }

      if (data.tags && data.tags.length > 0) {
        const normalizedTags = [...new Set(normalizeTags(data.tags))];
        if (normalizedTags.length > 0) {
          filter.tags = { $all: normalizedTags };
        }
      }

      const races = await Race.find(filter).select('-content').sort({ updatedAt: -1 }).lean();

      return races.map((r) => ({
        ...serializeRaceListItem(r),
        canEdit: member.isGM,
      })) as RaceListItem[];
    } catch (e) {
      serverCaptureException(e, sessionUserId, { action: 'listRaces' });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// getRace
// ---------------------------------------------------------------------------

export { getRaceSchema };

export const getRace = createServerFn({ method: 'GET' })
  .inputValidator(getRaceSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const race = await Race.findOne({ _id: data.id, campaignId: data.campaignId }).lean();
      if (!race) return null;

      return { ...serializeRace(race), canEdit: member.isGM } as RaceData;
    } catch (e) {
      serverCaptureException(e, sessionUserId, { action: 'getRace' });
      throw e;
    }
  });
