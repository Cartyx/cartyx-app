import { z } from 'zod';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { Monster } from '../db/models/Monster';
import { normalizeTags } from '../utils/helpers';
import { serverCaptureException, serverCaptureEvent } from '../utils/posthog';
import { ensureTags as ensureTagsFn } from './tags';
import type { MonsterData, MonsterListItem } from '~/types/monster';
import type { MonsterSize, FeatureSection } from '~/types/schemas/monsters';
import {
  listMonstersSchema,
  getMonsterSchema,
  createMonsterSchema,
  updateMonsterSchema,
  deleteMonsterSchema,
} from '~/types/schemas/monsters';

// ---------------------------------------------------------------------------
// Auth: every monster fn requires GM, even reads. Players never touch this
// collection. requireCampaignGM() throws Forbidden for non-GMs.
// ---------------------------------------------------------------------------

async function requireCampaignGM(
  campaignId: string
): Promise<{ userId: string; sessionUserId: string }> {
  const user = await getSession();
  if (!user) throw new Error('Not authenticated');

  await connectDB();
  if (!isDBConnected()) throw new Error('Database not available');

  const dbUser = await User.findOne({ providerId: user.id });
  if (!dbUser) throw new Error('User not found');

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const userId = String(dbUser._id);
  const members = campaign.members ?? [];
  const isGM =
    String(campaign.gameMasterId) === userId ||
    members.some(
      (m: { userId: unknown; role?: string }) => String(m.userId) === userId && m.role === 'gm'
    );
  if (!isGM) throw new Error('Forbidden');
  return { userId, sessionUserId: user.id };
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

type MonsterDoc = Record<string, unknown> & {
  _id: unknown;
  campaignId: unknown;
  createdBy: unknown;
};

function serializeMonsterListItem(r: MonsterDoc): MonsterListItem {
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    createdBy: String(r.createdBy),
    name: (r.name as string) ?? '',
    size: (r.size as MonsterSize) ?? 'medium',
    type: (r.type as string) ?? '',
    subtype: (r.subtype as string) ?? '',
    alignment: (r.alignment as string) ?? '',
    cr: {
      value: ((r.cr as { value?: number } | undefined)?.value as number | undefined) ?? 0,
      xp: ((r.cr as { xp?: number } | undefined)?.xp as number | undefined) ?? 0,
      proficiencyBonus:
        ((r.cr as { proficiencyBonus?: number } | undefined)?.proficiencyBonus as
          | number
          | undefined) ?? 2,
    },
    picture: (r.picture as string) ?? '',
    tags: (r.tags as string[]) ?? [],
    sessionId: r.sessionId ? String(r.sessionId) : null,
    color: (r.color as string) ?? '#9ca3af',
    source: ((r.source as 'srd' | 'custom') ?? 'custom') as 'srd' | 'custom',
    isHomebrew: Boolean(r.isHomebrew),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : '',
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : '',
  };
}

function serializeMonster(r: MonsterDoc): MonsterData {
  const list = serializeMonsterListItem(r);
  return {
    ...list,
    armorClass: (r.armorClass as number) ?? 10,
    armorClassNote: (r.armorClassNote as string) ?? '',
    hitPoints: {
      average:
        ((r.hitPoints as { average?: number } | undefined)?.average as number | undefined) ?? 1,
      formula:
        ((r.hitPoints as { formula?: string } | undefined)?.formula as string | undefined) ?? '',
    },
    initiativeMod: (r.initiativeMod as number) ?? 0,
    initiativePassive: (r.initiativePassive as number) ?? 10,
    speeds: ((r.speeds as MonsterData['speeds']) ?? []).map((s) => ({
      kind: s.kind,
      feet: s.feet,
      notes: s.notes,
    })),
    abilities: ((r.abilities as MonsterData['abilities']) ?? {
      str: { score: 10, mod: 0, save: 0 },
      dex: { score: 10, mod: 0, save: 0 },
      con: { score: 10, mod: 0, save: 0 },
      int: { score: 10, mod: 0, save: 0 },
      wis: { score: 10, mod: 0, save: 0 },
      cha: { score: 10, mod: 0, save: 0 },
    }) as MonsterData['abilities'],
    skills: ((r.skills as MonsterData['skills']) ?? []).map((s) => ({
      name: s.name,
      modifier: s.modifier,
    })),
    resistances: (r.resistances as string[]) ?? [],
    immunities: (r.immunities as string[]) ?? [],
    vulnerabilities: (r.vulnerabilities as string[]) ?? [],
    conditionImmunities: (r.conditionImmunities as string[]) ?? [],
    senses: ((r.senses as MonsterData['senses']) ?? []).map((s) => ({
      name: s.name,
      range: s.range ?? null,
    })),
    passivePerception: (r.passivePerception as number) ?? 10,
    languages: (r.languages as string[]) ?? [],
    features: ((r.features as MonsterData['features']) ?? []).map((f) => ({
      section: f.section as FeatureSection,
      name: f.name,
      description: f.description,
    })),
    pictureCrop: (r.pictureCrop as MonsterData['pictureCrop']) ?? null,
    links: ((r.links as MonsterData['links']) ?? []).map((l) => ({
      name: l.name,
      url: l.url,
    })),
    gmNotes: (r.gmNotes as string) ?? '',
  };
}

// ---------------------------------------------------------------------------
// listMonsters (GM only)
// ---------------------------------------------------------------------------

export const listMonsters = async ({ data }: { data: z.infer<typeof listMonstersSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const ctx = await requireCampaignGM(data.campaignId);
    sessionUserId = ctx.sessionUserId;

    const filter: Record<string, unknown> = { campaignId: data.campaignId };
    if (data.sessionId && data.sessionId.trim()) filter.sessionId = data.sessionId.trim();
    if (data.tags && data.tags.length > 0) {
      filter.tags = { $all: normalizeTags(data.tags) };
    }
    if (data.search && data.search.trim()) {
      filter.$text = { $search: data.search.trim() };
    }
    if (data.minCr !== undefined || data.maxCr !== undefined) {
      const crFilter: Record<string, number> = {};
      if (data.minCr !== undefined) crFilter.$gte = data.minCr;
      if (data.maxCr !== undefined) crFilter.$lte = data.maxCr;
      filter['cr.value'] = crFilter;
    }

    const docs = await Monster.find(filter).sort({ updatedAt: -1 }).lean();
    return { monsters: docs.map((d) => serializeMonsterListItem(d as MonsterDoc)) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'listMonsters',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// getMonster (GM only)
// ---------------------------------------------------------------------------

export const getMonster = async ({ data }: { data: z.infer<typeof getMonsterSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const ctx = await requireCampaignGM(data.campaignId);
    sessionUserId = ctx.sessionUserId;
    const doc = await Monster.findOne({
      _id: data.id,
      campaignId: data.campaignId,
    }).lean();
    if (!doc) throw new Error('Monster not found');
    return { monster: serializeMonster(doc as MonsterDoc) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'getMonster',
      campaignId: data.campaignId,
      monsterId: data.id,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// createMonster (GM only)
// ---------------------------------------------------------------------------

export const createMonster = async ({ data }: { data: z.infer<typeof createMonsterSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const ctx = await requireCampaignGM(data.campaignId);
    sessionUserId = ctx.sessionUserId;

    const now = new Date();
    const finalTags = normalizeTags(data.tags ?? []);
    const doc = await Monster.create({
      ...data,
      tags: finalTags,
      source: 'custom',
      isHomebrew: true,
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
    });

    await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });

    serverCaptureEvent(sessionUserId, 'monster_created', {
      campaign_id: data.campaignId,
      monster_id: String(doc._id),
    });

    return { monster: serializeMonster(doc.toObject() as MonsterDoc) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'createMonster',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// updateMonster (GM only)
// ---------------------------------------------------------------------------

export const updateMonster = async ({ data }: { data: z.infer<typeof updateMonsterSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const ctx = await requireCampaignGM(data.campaignId);
    sessionUserId = ctx.sessionUserId;

    const { id, campaignId, tags, ...rest } = data;
    const update: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    let finalTags: string[] | undefined;
    if (tags !== undefined) {
      finalTags = normalizeTags(tags);
      update.tags = finalTags;
    }

    const doc = await Monster.findOneAndUpdate(
      { _id: id, campaignId },
      { $set: update },
      { new: true }
    ).lean();
    if (!doc) throw new Error('Monster not found');

    if (finalTags) {
      await ensureTagsFn({ data: { campaignId, tags: finalTags } });
    }

    return { monster: serializeMonster(doc as MonsterDoc) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'updateMonster',
      campaignId: data.campaignId,
      monsterId: data.id,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// deleteMonster (GM only)
// ---------------------------------------------------------------------------

export const deleteMonster = async ({ data }: { data: z.infer<typeof deleteMonsterSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const ctx = await requireCampaignGM(data.campaignId);
    sessionUserId = ctx.sessionUserId;

    const result = await Monster.deleteOne({
      _id: data.id,
      campaignId: data.campaignId,
    });
    if (result.deletedCount === 0) throw new Error('Monster not found');

    serverCaptureEvent(sessionUserId, 'monster_deleted', {
      campaign_id: data.campaignId,
      monster_id: data.id,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'deleteMonster',
      campaignId: data.campaignId,
      monsterId: data.id,
    });
    throw e;
  }
};
