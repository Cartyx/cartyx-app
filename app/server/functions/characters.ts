import { z } from 'zod';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { Character } from '../db/models/Character';
import { serverCaptureException, serverCaptureEvent } from '../utils/posthog';
import { normalizeTags } from '../utils/helpers';
import { removeDocumentRefsFromScreens } from './gmscreens-helpers';
import { pruneLoreLinks } from '../utils/pruneLoreLinks';
import { pruneEventLinks } from '../utils/pruneEventLinks';
import { ensureTags as ensureTagsFn } from './tags';
import type { CharacterData, CharacterListItem, PictureCrop } from '~/types/character';
import {
  createCharacterSchema,
  updateCharacterSchema,
  deleteCharacterSchema,
  listCharactersSchema,
  getCharacterSchema,
  updateCharacterStatusSchema,
  addCharacterRelationshipSchema,
  updateCharacterRelationshipSchema,
  removeCharacterRelationshipSchema,
} from '~/types/schemas/characters';

function serializeCharacter(c: {
  _id: unknown;
  campaignId: unknown;
  createdBy: unknown;
  firstName?: string;
  lastName?: string;
  race?: string;
  characterClass?: string;
  age?: number | null;
  location?: string;
  link?: string;
  picture?: string;
  pictureCrop?: PictureCrop | null;
  notes?: string;
  gmNotes?: string;
  tags?: string[];
  isPublic?: boolean;
  sessionId?: unknown;
  sessions?: unknown[];
  createdAt?: Date;
  updatedAt?: Date;
  status?: { value?: string; changedAt?: Date | null; changedBy?: unknown };
  relationships?: Array<{ characterId: unknown; descriptor?: string; isPublic?: boolean }>;
}): Omit<CharacterData, 'canEdit'> {
  return {
    id: String(c._id),
    campaignId: String(c.campaignId),
    createdBy: String(c.createdBy),
    firstName: c.firstName ?? '',
    lastName: c.lastName ?? '',
    race: c.race ?? '',
    characterClass: c.characterClass ?? '',
    age: c.age ?? null,
    location: c.location ?? '',
    link: c.link ?? '',
    picture: c.picture ?? '',
    pictureCrop: c.pictureCrop
      ? {
          x: Number(c.pictureCrop.x),
          y: Number(c.pictureCrop.y),
          width: Number(c.pictureCrop.width),
          height: Number(c.pictureCrop.height),
        }
      : null,
    notes: c.notes ?? '',
    gmNotes: c.gmNotes ?? '',
    tags: c.tags ?? [],
    isPublic: c.isPublic ?? false,
    sessionId: c.sessionId ? String(c.sessionId) : undefined,
    sessions: (c.sessions ?? []).map((s) => String(s)),
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : '',
    updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : '',
    status: {
      value: (c.status?.value as 'alive' | 'deceased') ?? 'alive',
      changedAt: c.status?.changedAt ? new Date(c.status.changedAt as Date).toISOString() : null,
      changedBy: c.status?.changedBy ? String(c.status.changedBy) : null,
    },
    relationships: (c.relationships ?? []).map(
      (r: { characterId: unknown; descriptor?: string; isPublic?: boolean }) => ({
        characterId: String(r.characterId),
        descriptor: r.descriptor ?? '',
        isPublic: r.isPublic ?? false,
      })
    ),
  };
}

function serializeCharacterListItem(c: {
  _id: unknown;
  campaignId: unknown;
  createdBy: unknown;
  firstName?: string;
  lastName?: string;
  race?: string;
  characterClass?: string;
  age?: number | null;
  location?: string;
  link?: string;
  picture?: string;
  pictureCrop?: PictureCrop | null;
  tags?: string[];
  isPublic?: boolean;
  sessionId?: unknown;
  sessions?: unknown[];
  createdAt?: Date;
  updatedAt?: Date;
  status?: { value?: string; changedAt?: Date | null; changedBy?: unknown };
}): Omit<CharacterListItem, 'canEdit'> {
  return {
    id: String(c._id),
    campaignId: String(c.campaignId),
    createdBy: String(c.createdBy),
    firstName: c.firstName ?? '',
    lastName: c.lastName ?? '',
    race: c.race ?? '',
    characterClass: c.characterClass ?? '',
    age: c.age ?? null,
    location: c.location ?? '',
    link: c.link ?? '',
    picture: c.picture ?? '',
    pictureCrop: c.pictureCrop
      ? {
          x: Number(c.pictureCrop.x),
          y: Number(c.pictureCrop.y),
          width: Number(c.pictureCrop.width),
          height: Number(c.pictureCrop.height),
        }
      : null,
    tags: c.tags ?? [],
    isPublic: c.isPublic ?? false,
    sessionId: c.sessionId ? String(c.sessionId) : undefined,
    sessions: (c.sessions ?? []).map((s) => String(s)),
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : '',
    updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : '',
    status: {
      value: (c.status?.value as 'alive' | 'deceased') ?? 'alive',
      changedAt: c.status?.changedAt ? new Date(c.status.changedAt as Date).toISOString() : null,
      changedBy: c.status?.changedBy ? String(c.status.changedBy) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// createCharacter
// ---------------------------------------------------------------------------

export { createCharacterSchema };

export const createCharacter = async ({
  data,
}: {
  data: z.infer<typeof createCharacterSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const now = new Date();
    const finalTags = normalizeTags(data.tags ?? []);
    const charData: Record<string, unknown> = {
      campaignId: data.campaignId,
      createdBy: userId,
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      race: (data.race ?? '').trim(),
      characterClass: (data.characterClass ?? '').trim(),
      age: data.age ?? null,
      location: (data.location ?? '').trim(),
      link: (data.link ?? '').trim(),
      picture: data.picture ?? '',
      pictureCrop: data.pictureCrop ?? null,
      notes: (data.notes ?? '').trim(),
      gmNotes: (data.gmNotes ?? '').trim(),
      tags: finalTags,
      isPublic: data.isPublic ?? false,
      sessions: data.sessions ?? [],
      createdAt: now,
      updatedAt: now,
    };
    if (data.sessionId && data.sessionId !== '__none__') {
      charData.sessionId = data.sessionId;
    }
    const doc = await Character.create(charData);

    // Register any new tags in the campaign tag registry
    await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });

    serverCaptureEvent(sessionUserId, 'character_created', {
      campaign_id: data.campaignId,
      character_id: String(doc._id),
    });

    return { success: true, character: { ...serializeCharacter(doc), canEdit: true } };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'createCharacter',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// updateCharacter
// ---------------------------------------------------------------------------

export { updateCharacterSchema };

export const updateCharacter = async ({
  data,
}: {
  data: z.infer<typeof updateCharacterSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const existing = await Character.findById(data.id);
    if (!existing) throw new Error('Character not found');
    if (String(existing.campaignId) !== data.campaignId) throw new Error('Forbidden');
    if (String(existing.createdBy) !== userId && !member.isGM) throw new Error('Forbidden');

    const finalTags = normalizeTags(data.tags ?? []);
    existing.sessionId =
      data.sessionId && data.sessionId !== '__none__' ? data.sessionId : undefined;
    existing.firstName = data.firstName.trim();
    existing.lastName = data.lastName.trim();
    existing.race = (data.race ?? '').trim();
    existing.characterClass = (data.characterClass ?? '').trim();
    existing.age = data.age ?? null;
    existing.location = (data.location ?? '').trim();
    existing.link = (data.link ?? '').trim();
    existing.picture = data.picture ?? '';
    existing.pictureCrop = data.pictureCrop ?? null;
    existing.notes = (data.notes ?? '').trim();
    existing.gmNotes = (data.gmNotes ?? '').trim();
    existing.tags = finalTags;
    existing.sessions = data.sessions ?? [];
    if (data.isPublic !== undefined) {
      existing.isPublic = data.isPublic;
    }
    existing.updatedAt = new Date();
    await existing.save();

    // Register any new tags in the campaign tag registry
    await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });

    serverCaptureEvent(sessionUserId, 'character_updated', {
      campaign_id: data.campaignId,
      character_id: data.id,
      updated_by: userId,
    });

    return { success: true, character: { ...serializeCharacter(existing), canEdit: true } };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'updateCharacter', characterId: data.id });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// deleteCharacter
// ---------------------------------------------------------------------------

export { deleteCharacterSchema };

export const deleteCharacter = async ({
  data,
}: {
  data: z.infer<typeof deleteCharacterSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const existing = await Character.findById(data.id);
    if (!existing) throw new Error('Character not found');
    if (String(existing.campaignId) !== data.campaignId) throw new Error('Forbidden');
    if (String(existing.createdBy) !== userId && !member.isGM) throw new Error('Forbidden');

    await existing.deleteOne();

    // Clean up GM Screen references to this character.
    // Best-effort: the character is already deleted, so cleanup failure must not
    // surface as a user-facing error — report it and move on.
    try {
      await removeDocumentRefsFromScreens(data.campaignId, 'character', data.id);
    } catch (cleanupError) {
      serverCaptureException(cleanupError, sessionUserId, {
        action: 'deleteCharacter.cleanup',
        campaignId: data.campaignId,
        characterId: data.id,
      });
    }

    // Clean up character-to-character relationships referencing this character
    await Character.updateMany(
      { campaignId: data.campaignId, 'relationships.characterId': data.id },
      { $pull: { relationships: { characterId: data.id } } }
    );

    // Clean up player-to-character relationships referencing this character
    const { Player } = await import('../db/models/Player');
    await Player.updateMany(
      { campaignId: data.campaignId, 'relationships.characterId': data.id },
      { $pull: { relationships: { characterId: data.id } } }
    );

    await pruneLoreLinks('character', data.id, data.campaignId);
    await pruneEventLinks('character', data.id, data.campaignId);

    serverCaptureEvent(sessionUserId, 'character_deleted', {
      campaign_id: data.campaignId,
      character_id: data.id,
      deleted_by: userId,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'deleteCharacter', characterId: data.id });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// listCharacters
// ---------------------------------------------------------------------------

export { listCharactersSchema };

export const listCharacters = async ({ data }: { data: z.infer<typeof listCharactersSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    // Build query filter
    const filter: Record<string, unknown> = { campaignId: data.campaignId };

    // Session filter
    let sessionCondition: Record<string, unknown> | undefined;

    if (data.sessionId === '__none__') {
      // "No session" means introduced in no session AND appeared in no sessions
      sessionCondition = {
        $and: [{ sessionId: { $exists: false } }, { sessions: { $size: 0 } }],
      };
    } else if (data.sessionId) {
      // Union: introduced in OR appeared in this session
      sessionCondition = {
        $or: [{ sessionId: data.sessionId }, { sessions: data.sessionId }],
      };
    }

    // Visibility filter — GMs can see all characters in their campaign
    let visibilityCondition: Record<string, unknown> | undefined;
    if (member.isGM) {
      // GMs see everything; only narrow when explicitly filtering
      if (data.visibility === 'public') {
        filter.isPublic = true;
      } else if (data.visibility === 'private') {
        filter.isPublic = false;
      }
    } else if (data.visibility === 'public') {
      filter.isPublic = true;
    } else if (data.visibility === 'private') {
      filter.isPublic = false;
      filter.createdBy = userId;
    } else {
      // visibility='all' (default): only characters the user is allowed to see
      visibilityCondition = { $or: [{ isPublic: true }, { createdBy: userId }] };
    }

    // Merge session and visibility conditions using $and when both need top-level operators
    if (sessionCondition && visibilityCondition) {
      filter.$and = [sessionCondition, visibilityCondition];
    } else if (sessionCondition) {
      Object.assign(filter, sessionCondition);
    } else if (visibilityCondition) {
      filter.$or = visibilityCondition.$or as Record<string, unknown>[];
    }

    if (data.search && data.search.trim()) {
      filter.$text = { $search: data.search.trim() };
    }

    if (data.tags && data.tags.length > 0) {
      const normalizedTags = [...new Set(normalizeTags(data.tags))];
      if (normalizedTags.length > 0) {
        filter.tags = { $all: normalizedTags };
      }
    }

    const docs = await Character.find(filter)
      .select('-notes -gmNotes')
      .sort({ updatedAt: -1 })
      .lean();

    return (
      docs as Array<{
        _id: unknown;
        campaignId: unknown;
        createdBy: unknown;
        firstName?: string;
        lastName?: string;
        race?: string;
        characterClass?: string;
        age?: number | null;
        location?: string;
        link?: string;
        picture?: string;
        pictureCrop?: PictureCrop | null;
        tags?: string[];
        isPublic?: boolean;
        sessionId?: unknown;
        sessions?: unknown[];
        createdAt?: Date;
        updatedAt?: Date;
        status?: { value?: string; changedAt?: Date | null; changedBy?: unknown };
      }>
    ).map((doc) => ({
      ...serializeCharacterListItem(doc),
      canEdit: String(doc.createdBy) === userId || member.isGM,
    }));
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'listCharacters',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// getCharacter
// ---------------------------------------------------------------------------

export { getCharacterSchema };

export const getCharacter = async ({ data }: { data: z.infer<typeof getCharacterSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const doc = await Character.findById(data.id);
    if (!doc) return null;
    if (String(doc.campaignId) !== data.campaignId) return null;

    // Private characters are only visible to the creator and GMs
    if (!doc.isPublic && String(doc.createdBy) !== userId && !member.isGM) {
      return null;
    }

    const serialized = serializeCharacter(doc);

    // Strip gmNotes for non-GMs
    if (!member.isGM) {
      serialized.gmNotes = '';
    }

    // Strip private relationships for non-creator/non-GM
    const isCreator = String(doc.createdBy) === userId;
    if (!isCreator && !member.isGM) {
      serialized.relationships = serialized.relationships.filter((r) => r.isPublic);
    }

    const canEdit = isCreator || member.isGM;
    return { ...serialized, canEdit };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'getCharacter', characterId: data.id });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// updateCharacterStatus
// ---------------------------------------------------------------------------

export { updateCharacterStatusSchema };

export const updateCharacterStatus = async ({
  data,
}: {
  data: z.infer<typeof updateCharacterStatusSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const character = await Character.findById(data.id);
    if (!character) throw new Error('Character not found');
    if (String(character.campaignId) !== data.campaignId) throw new Error('Forbidden');
    if (String(character.createdBy) !== userId && !member.isGM) throw new Error('Forbidden');

    character.status = { value: data.value, changedAt: new Date(), changedBy: userId };
    character.updatedAt = new Date();
    await character.save();

    serverCaptureEvent(sessionUserId, 'character_status_updated', {
      campaign_id: data.campaignId,
      character_id: data.id,
      status: data.value,
    });

    return { success: true, character: { ...serializeCharacter(character), canEdit: true } };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'updateCharacterStatus',
      characterId: data.id,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// addCharacterRelationship
// ---------------------------------------------------------------------------

export { addCharacterRelationshipSchema };

export const addCharacterRelationship = async ({
  data,
}: {
  data: z.infer<typeof addCharacterRelationshipSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const source = await Character.findById(data.characterId);
    if (!source) throw new Error('Character not found');
    if (String(source.campaignId) !== data.campaignId) throw new Error('Forbidden');
    if (String(source.createdBy) !== userId && !member.isGM) throw new Error('Forbidden');

    if (data.characterId === data.targetCharacterId)
      throw new Error('Cannot create relationship with self');

    const target = await Character.findById(data.targetCharacterId);
    if (!target) throw new Error('Target character not found');
    if (String(target.campaignId) !== data.campaignId)
      throw new Error('Target character not in same campaign');

    const existing = source.relationships?.find(
      (r: { characterId: unknown }) => String(r.characterId) === data.targetCharacterId
    );
    if (existing) throw new Error('Relationship already exists');

    await Character.updateOne(
      { _id: data.characterId },
      {
        $push: {
          relationships: {
            characterId: data.targetCharacterId,
            descriptor: data.descriptor,
            isPublic: data.isPublic,
          },
        },
      }
    );

    await Character.updateOne(
      { _id: data.targetCharacterId },
      {
        $push: {
          relationships: {
            characterId: data.characterId,
            descriptor: data.reciprocalDescriptor,
            isPublic: data.isPublic,
          },
        },
      }
    );

    serverCaptureEvent(sessionUserId, 'character_relationship_added', {
      campaign_id: data.campaignId,
      source_character_id: data.characterId,
      target_character_id: data.targetCharacterId,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'addCharacterRelationship',
      characterId: data.characterId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// updateCharacterRelationship
// ---------------------------------------------------------------------------

export { updateCharacterRelationshipSchema };

export const updateCharacterRelationship = async ({
  data,
}: {
  data: z.infer<typeof updateCharacterRelationshipSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const source = await Character.findById(data.characterId);
    if (!source) throw new Error('Character not found');
    if (String(source.campaignId) !== data.campaignId) throw new Error('Forbidden');
    if (String(source.createdBy) !== userId && !member.isGM) throw new Error('Forbidden');

    // Build source-side update
    const sourceSet: Record<string, unknown> = {};
    if (data.descriptor !== undefined) sourceSet['relationships.$.descriptor'] = data.descriptor;
    if (data.isPublic !== undefined) sourceSet['relationships.$.isPublic'] = data.isPublic;

    if (Object.keys(sourceSet).length > 0) {
      await Character.updateOne(
        { _id: data.characterId, 'relationships.characterId': data.targetCharacterId },
        { $set: sourceSet }
      );
    }

    // Build reciprocal-side update
    const reciprocalSet: Record<string, unknown> = {};
    if (data.reciprocalDescriptor !== undefined)
      reciprocalSet['relationships.$.descriptor'] = data.reciprocalDescriptor;
    if (data.isPublic !== undefined) reciprocalSet['relationships.$.isPublic'] = data.isPublic;

    if (Object.keys(reciprocalSet).length > 0) {
      await Character.updateOne(
        { _id: data.targetCharacterId, 'relationships.characterId': data.characterId },
        { $set: reciprocalSet }
      );
    }

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'updateCharacterRelationship',
      characterId: data.characterId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// removeCharacterRelationship
// ---------------------------------------------------------------------------

export { removeCharacterRelationshipSchema };

export const removeCharacterRelationship = async ({
  data,
}: {
  data: z.infer<typeof removeCharacterRelationshipSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const source = await Character.findById(data.characterId);
    if (!source) throw new Error('Character not found');
    if (String(source.campaignId) !== data.campaignId) throw new Error('Forbidden');
    if (String(source.createdBy) !== userId && !member.isGM) throw new Error('Forbidden');

    await Character.updateOne(
      { _id: data.characterId },
      { $pull: { relationships: { characterId: data.targetCharacterId } } }
    );

    await Character.updateOne(
      { _id: data.targetCharacterId },
      { $pull: { relationships: { characterId: data.characterId } } }
    );

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'removeCharacterRelationship',
      characterId: data.characterId,
    });
    throw e;
  }
};
