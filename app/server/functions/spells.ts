import { z } from 'zod';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { Spell } from '../db/models/Spell';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { normalizeTags } from '../utils/helpers';
import { ensureTags as ensureTagsFn } from './tags';
import type { SpellData, SpellListItem, SpellSource } from '~/types/spell';
import {
  createSpellSchema,
  updateSpellSchema,
  deleteSpellSchema,
  duplicateSpellSchema,
  listSpellsSchema,
  getSpellSchema,
} from '~/types/schemas/spells';

// Fields copied verbatim from a stored doc into a serialized payload.
const STRUCTURED_FIELDS = [
  'name',
  'description',
  'imageUrl',
  'level',
  'school',
  'version',
  'castingTime',
  'components',
  'range',
  'duration',
  'ritual',
  'higherLevelScaling',
  'classes',
  'attackSave',
  'modifiers',
  'conditions',
  'higherLevels',
  'areaOfEffect',
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mongoose lean/doc
function serializeSpell(s: any): Omit<SpellData, 'canEdit'> {
  const out: Record<string, unknown> = {
    id: String(s._id),
    campaignId: String(s.campaignId),
    createdBy: String(s.createdBy),
    source: (s.source ?? 'homebrew') as SpellSource,
    tags: s.tags ?? [],
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : '',
    updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : '',
  };
  for (const f of STRUCTURED_FIELDS) {
    out[f] = s[f];
  }
  return out as unknown as Omit<SpellData, 'canEdit'>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mongoose lean/doc
function serializeSpellListItem(s: any): Omit<SpellListItem, 'canEdit'> {
  return {
    id: String(s._id),
    campaignId: String(s.campaignId),
    createdBy: String(s.createdBy),
    source: (s.source ?? 'homebrew') as SpellSource,
    name: s.name ?? '',
    level: s.level ?? 0,
    school: s.school,
    tags: s.tags ?? [],
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : '',
    updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : '',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- data body
function structuredBody(data: any) {
  const body: Record<string, unknown> = {};
  for (const f of STRUCTURED_FIELDS) {
    if (data[f] !== undefined) body[f] = data[f];
  }
  return body;
}

export { createSpellSchema };
export const createSpell = async ({ data }: { data: z.infer<typeof createSpellSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    if (!member.isGM) throw new Error('Forbidden');

    const finalTags = normalizeTags(data.tags ?? []);
    const spell = await Spell.create({
      ...structuredBody(data),
      campaignId: data.campaignId,
      createdBy: member.userId,
      source: 'homebrew',
      tags: finalTags,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (finalTags.length > 0) {
      await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });
    }

    serverCaptureEvent(sessionUserId!, 'spell_created', {
      campaign_id: data.campaignId,
      spell_id: String(spell._id),
    });

    return { ...serializeSpell(spell), canEdit: true } as SpellData;
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'createSpell' });
    throw e;
  }
};

export { updateSpellSchema };
export const updateSpell = async ({ data }: { data: z.infer<typeof updateSpellSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    if (!member.isGM) throw new Error('Forbidden');

    const existing = await Spell.findOne({ _id: data.id, campaignId: data.campaignId });
    if (!existing) throw new Error('Spell not found');
    if (existing.source === 'srd') throw new Error('SRD spells are read-only');

    const finalTags = normalizeTags(data.tags ?? []);
    const spell = await Spell.findOneAndUpdate(
      { _id: data.id, campaignId: data.campaignId },
      { $set: { ...structuredBody(data), tags: finalTags, updatedAt: new Date() } },
      { new: true }
    );
    if (!spell) throw new Error('Spell not found');

    if (finalTags.length > 0) {
      await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });
    }

    serverCaptureEvent(sessionUserId!, 'spell_updated', {
      campaign_id: data.campaignId,
      spell_id: data.id,
    });

    return { ...serializeSpell(spell), canEdit: true } as SpellData;
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'updateSpell' });
    throw e;
  }
};

export { deleteSpellSchema };
export const deleteSpell = async ({ data }: { data: z.infer<typeof deleteSpellSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    if (!member.isGM) throw new Error('Forbidden');

    const spell = await Spell.findOne({ _id: data.id, campaignId: data.campaignId });
    if (!spell) throw new Error('Spell not found');
    if (spell.source === 'srd') throw new Error('SRD spells are read-only');

    await spell.deleteOne();

    serverCaptureEvent(sessionUserId!, 'spell_deleted', {
      campaign_id: data.campaignId,
      spell_id: data.id,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'deleteSpell' });
    throw e;
  }
};

export { duplicateSpellSchema };
export const duplicateSpell = async ({ data }: { data: z.infer<typeof duplicateSpellSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    if (!member.isGM) throw new Error('Forbidden');

    const source = await Spell.findOne({ _id: data.id, campaignId: data.campaignId }).lean();
    if (!source) throw new Error('Spell not found');

    const body = structuredBody(source);
    const copy = await Spell.create({
      ...body,
      name: `${source.name} (Copy)`,
      campaignId: data.campaignId,
      createdBy: member.userId,
      source: 'homebrew',
      tags: source.tags ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    serverCaptureEvent(sessionUserId!, 'spell_duplicated', {
      campaign_id: data.campaignId,
      source_spell_id: data.id,
      spell_id: String(copy._id),
    });

    return { ...serializeSpell(copy), canEdit: true } as SpellData;
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'duplicateSpell' });
    throw e;
  }
};

export { listSpellsSchema };
export const listSpells = async ({ data }: { data: z.infer<typeof listSpellsSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const filter: Record<string, unknown> = { campaignId: data.campaignId };
    if (data.search) filter.$text = { $search: data.search };
    if (typeof data.level === 'number') filter.level = data.level;
    if (data.school) filter.school = data.school;
    if (data.tags && data.tags.length > 0) {
      const normalizedTags = [...new Set(normalizeTags(data.tags))];
      if (normalizedTags.length > 0) filter.tags = { $all: normalizedTags };
    }

    const spells = await Spell.find(filter)
      .select('name level school source tags campaignId createdBy createdAt updatedAt')
      .sort({ level: 1, name: 1 })
      .lean();

    return spells.map((s) => ({
      ...serializeSpellListItem(s),
      canEdit: member.isGM && (s.source ?? 'homebrew') === 'homebrew',
    })) as SpellListItem[];
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'listSpells' });
    throw e;
  }
};

export { getSpellSchema };
export const getSpell = async ({ data }: { data: z.infer<typeof getSpellSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const spell = await Spell.findOne({ _id: data.id, campaignId: data.campaignId }).lean();
    if (!spell) return null;

    return {
      ...serializeSpell(spell),
      canEdit: member.isGM && (spell.source ?? 'homebrew') === 'homebrew',
    } as SpellData;
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'getSpell' });
    throw e;
  }
};
