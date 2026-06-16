import { createServerFn } from '@tanstack/react-start';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { removeDocumentRefsFromScreens } from './gmscreens-helpers';
import { serverCaptureException } from '../utils/posthog';
import { Lore } from '../db/models/Lore';
import { Character } from '../db/models/Character';
import { Player } from '../db/models/Player';
import { Location } from '../db/models/Location';
import { Race } from '../db/models/Race';
import {
  listLoreSchema,
  getLoreSchema,
  createLoreSchema,
  updateLoreSchema,
  deleteLoreSchema,
} from '~/types/schemas/lore';
import type { LoreData, LoreLink, LoreListItem } from '~/types/lore';
import type { PictureCrop } from '~/types/character';

type AnyDoc = Record<string, unknown> & { _id: unknown };

function baseSerialize(doc: AnyDoc) {
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    createdBy: String(doc.createdBy),
    title: (doc.title as string) ?? '',
    content: (doc.content as string) ?? '',
    isPublic: Boolean(doc.isPublic),
    images: ((doc.images as unknown[]) ?? []).map((i) => {
      const img = i as Record<string, unknown>;
      return {
        url: String(img.url),
        caption: (img.caption as string) ?? '',
        crop: (img.crop as unknown as PictureCrop) ?? null,
      };
    }),
    links: ((doc.links as unknown[]) ?? []).map((l) => {
      const lk = l as Record<string, unknown>;
      return { kind: lk.kind as LoreLink['kind'], id: String(lk.id) };
    }) as LoreLink[],
    tags: (doc.tags as string[]) ?? [],
    createdAt: (doc.createdAt as Date)?.toISOString?.() ?? '',
    updatedAt: (doc.updatedAt as Date)?.toISOString?.() ?? '',
  };
}

// Resolve {kind,id} -> display label across the four entity collections.
async function resolveLinkLabels(links: LoreLink[]): Promise<LoreLink[]> {
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
        }
      } catch {
        label = '';
      }
      return { ...link, label };
    })
  );
}

// ---------------------------------------------------------------------------
// listLore
// ---------------------------------------------------------------------------

export const listLore = createServerFn({ method: 'GET' })
  .inputValidator(listLoreSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      const filter: Record<string, unknown> = { campaignId: data.campaignId };

      if (!member.isGM) {
        filter.$or = [{ isPublic: true }, { createdBy: member.userId }];
      } else if (data.visibility === 'public') {
        filter.isPublic = true;
      } else if (data.visibility === 'private') {
        filter.isPublic = false;
      }

      if (data.tags?.length) filter.tags = { $all: data.tags };
      if (data.search) filter.$text = { $search: data.search };
      if (data.linkedKind && data.linkedId) {
        filter.links = { $elemMatch: { kind: data.linkedKind, id: data.linkedId } };
      }

      const docs = (await Lore.find(filter).sort({ updatedAt: -1 }).lean()) as AnyDoc[];
      const items: LoreListItem[] = docs.map((doc) => ({
        ...baseSerialize(doc),
        canEdit: String(doc.createdBy) === member.userId || member.isGM,
      }));
      return items;
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'listLore', campaignId: data.campaignId });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// getLore
// ---------------------------------------------------------------------------

export const getLore = createServerFn({ method: 'GET' })
  .inputValidator(getLoreSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      const doc = (await Lore.findById(data.id).lean()) as AnyDoc | null;
      if (!doc || String(doc.campaignId) !== data.campaignId) return null;

      const isCreator = String(doc.createdBy) === member.userId;
      if (!member.isGM && !isCreator && !doc.isPublic) return null;

      const links = await resolveLinkLabels(
        ((doc.links as unknown[]) ?? []).map((l) => {
          const lk = l as Record<string, unknown>;
          return { kind: lk.kind as LoreLink['kind'], id: String(lk.id) };
        })
      );

      const result: LoreData = {
        ...baseSerialize(doc),
        gmContent: member.isGM ? ((doc.gmContent as string) ?? '') : '',
        links,
        canEdit: isCreator || member.isGM,
      };
      return result;
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'getLore', loreId: data.id });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// createLore
// ---------------------------------------------------------------------------

export const createLore = createServerFn({ method: 'POST' })
  .inputValidator(createLoreSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      const doc = (await Lore.create({
        title: data.title,
        content: data.content,
        gmContent: data.gmContent,
        isPublic: data.isPublic,
        images: data.images,
        links: data.links,
        tags: data.tags,
        campaignId: data.campaignId,
        createdBy: member.userId,
      })) as AnyDoc;
      return {
        success: true,
        lore: {
          ...baseSerialize(doc),
          gmContent: member.isGM ? (data.gmContent ?? '') : '',
          canEdit: true,
        },
      };
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'createLore', campaignId: data.campaignId });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// updateLore
// ---------------------------------------------------------------------------

export const updateLore = createServerFn({ method: 'POST' })
  .inputValidator(updateLoreSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      const existing = (await Lore.findById(data.id).lean()) as AnyDoc | null;
      if (!existing || String(existing.campaignId) !== data.campaignId)
        throw new Error('Not found');
      if (String(existing.createdBy) !== member.userId && !member.isGM)
        throw new Error('Forbidden');

      const updated = (await Lore.findOneAndUpdate(
        { _id: data.id, campaignId: data.campaignId },
        {
          $set: {
            title: data.title,
            content: data.content,
            gmContent: data.gmContent,
            isPublic: data.isPublic,
            images: data.images,
            links: data.links,
            tags: data.tags,
            updatedAt: new Date(),
          },
        },
        { new: true, lean: true }
      )) as AnyDoc;
      return {
        success: true,
        lore: {
          ...baseSerialize(updated),
          gmContent: member.isGM ? (data.gmContent ?? '') : '',
          canEdit: true,
        },
      };
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'updateLore', loreId: data.id });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// deleteLore
// ---------------------------------------------------------------------------

export const deleteLore = createServerFn({ method: 'POST' })
  .inputValidator(deleteLoreSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      const existing = (await Lore.findById(data.id).lean()) as AnyDoc | null;
      if (!existing || String(existing.campaignId) !== data.campaignId)
        throw new Error('Not found');
      if (String(existing.createdBy) !== member.userId && !member.isGM)
        throw new Error('Forbidden');
      await Lore.deleteOne({ _id: data.id, campaignId: data.campaignId });
      // Signature: removeDocumentRefsFromScreens(campaignId, collection, documentId)
      await removeDocumentRefsFromScreens(data.campaignId, 'lore', data.id);
      return { success: true };
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'deleteLore', loreId: data.id });
      throw e;
    }
  });
