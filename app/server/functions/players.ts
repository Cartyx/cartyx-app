import { z } from 'zod';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { Player } from '../db/models/Player';
import { Character } from '../db/models/Character';
import { Lore } from '../db/models/Lore';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { removeDocumentRefsFromScreens } from './gmscreens-helpers';
import { pruneLoreLinks } from '../utils/pruneLoreLinks';
import { pruneEventLinks } from '../utils/pruneEventLinks';
import { pruneMembershipsForMember } from './organizations';
import type { PlayerData, PlayerListItem } from '~/types/player';
import type { PictureCrop } from '~/types/character';
import {
  listPlayersSchema,
  getPlayerSchema,
  updatePlayerSchema,
  deletePlayerSchema,
  updatePlayerStatusSchema,
  playerRelationshipSchema,
  removePlayerRelationshipSchema,
  validateInviteCodeSchema,
  completeJoinWizardSchema,
} from '~/types/schemas/players';

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function serializePlayer(c: {
  _id: unknown;
  campaignId: unknown;
  createdBy: unknown;
  firstName?: string;
  lastName?: string;
  race?: string;
  characterClass?: string;
  age?: number;
  gender?: string;
  location?: string;
  link?: string;
  picture?: string;
  pictureCrop?: PictureCrop | null;
  description?: string;
  backstory?: string;
  gmNotes?: string;
  color?: string;
  eyeColor?: string;
  hairColor?: string;
  weight?: number | null;
  height?: string;
  size?: string;
  appearance?: string;
  status?: { value?: string; changedAt?: Date | null; changedBy?: unknown };
  relationships?: Array<{ characterId: unknown; descriptor?: string; isPublic?: boolean }>;
  createdAt?: Date;
  updatedAt?: Date;
}): Omit<PlayerData, 'canEdit'> {
  return {
    id: String(c._id),
    campaignId: String(c.campaignId),
    createdBy: String(c.createdBy),
    firstName: c.firstName ?? '',
    lastName: c.lastName ?? '',
    race: c.race ?? '',
    characterClass: c.characterClass ?? '',
    age: c.age ?? 0,
    gender: c.gender ?? '',
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
    description: c.description ?? '',
    backstory: c.backstory ?? '',
    gmNotes: c.gmNotes ?? '',
    color: c.color ?? '#3498db',
    eyeColor: c.eyeColor ?? '',
    hairColor: c.hairColor ?? '',
    weight: c.weight ?? null,
    height: c.height ?? '',
    size: c.size ?? '',
    appearance: c.appearance ?? '',
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
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : '',
    updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : '',
  };
}

function serializePlayerListItem(c: {
  _id: unknown;
  campaignId: unknown;
  createdBy: unknown;
  firstName?: string;
  lastName?: string;
  race?: string;
  characterClass?: string;
  color?: string;
  picture?: string;
  pictureCrop?: PictureCrop | null;
  status?: { value?: string; changedAt?: Date | null; changedBy?: unknown };
}): Omit<PlayerListItem, 'canEdit'> {
  return {
    id: String(c._id),
    campaignId: String(c.campaignId),
    createdBy: String(c.createdBy),
    firstName: c.firstName ?? '',
    lastName: c.lastName ?? '',
    race: c.race ?? '',
    characterClass: c.characterClass ?? '',
    color: c.color ?? '#3498db',
    picture: c.picture ?? '',
    pictureCrop: c.pictureCrop
      ? {
          x: Number(c.pictureCrop.x),
          y: Number(c.pictureCrop.y),
          width: Number(c.pictureCrop.width),
          height: Number(c.pictureCrop.height),
        }
      : null,
    status: {
      value: (c.status?.value as 'alive' | 'deceased') ?? 'alive',
      changedAt: c.status?.changedAt ? new Date(c.status.changedAt as Date).toISOString() : null,
      changedBy: c.status?.changedBy ? String(c.status.changedBy) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// listPlayers
// ---------------------------------------------------------------------------

export { listPlayersSchema };

export const listPlayers = async ({ data }: { data: z.infer<typeof listPlayersSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const filter: Record<string, unknown> = { campaignId: data.campaignId };

    if (data.search && data.search.trim()) {
      filter.$text = { $search: data.search.trim() };
    }

    const docs = await Player.find(filter)
      .select('-backstory -gmNotes -description -appearance -relationships')
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
        color?: string;
        picture?: string;
        pictureCrop?: PictureCrop | null;
        status?: { value?: string; changedAt?: Date | null; changedBy?: unknown };
      }>
    ).map((doc) => ({
      ...serializePlayerListItem(doc),
      canEdit: String(doc.createdBy) === userId || member.isGM,
    }));
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'listPlayers',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// getPlayer
// ---------------------------------------------------------------------------

export { getPlayerSchema };

export const getPlayer = async ({ data }: { data: z.infer<typeof getPlayerSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const doc = await Player.findById(data.id);
    if (!doc) return null;
    if (String(doc.campaignId) !== data.campaignId) return null;

    const serialized = serializePlayer(doc);
    const isOwner = String(doc.createdBy) === userId;

    // Strip backstory for non-owner/non-GM
    if (!isOwner && !member.isGM) {
      serialized.backstory = '';
    }

    // Strip gmNotes for non-GM
    if (!member.isGM) {
      serialized.gmNotes = '';
    }

    // Filter private relationships for non-owner/non-GM
    if (!isOwner && !member.isGM) {
      serialized.relationships = serialized.relationships.filter((r) => r.isPublic);
    }

    const canEdit = isOwner || member.isGM;
    return { ...serialized, canEdit };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'getPlayer', playerId: data.id });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// updatePlayer
// ---------------------------------------------------------------------------

export { updatePlayerSchema };

export const updatePlayer = async ({ data }: { data: z.infer<typeof updatePlayerSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const existing = await Player.findById(data.id);
    if (!existing) throw new Error('Player not found');
    if (String(existing.campaignId) !== data.campaignId) throw new Error('Forbidden');

    const isOwner = String(existing.createdBy) === userId;
    if (!isOwner && !member.isGM) throw new Error('Forbidden');

    const $set: Record<string, unknown> = {
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      race: data.race.trim(),
      characterClass: data.characterClass.trim(),
      age: data.age,
      gender: (data.gender ?? '').trim(),
      location: (data.location ?? '').trim(),
      link: (data.link ?? '').trim(),
      picture: data.picture ?? '',
      pictureCrop: data.pictureCrop ?? null,
      description: (data.description ?? '').trim(),
      backstory: (data.backstory ?? '').trim(),
      color: data.color ?? '#3498db',
      eyeColor: (data.eyeColor ?? '').trim(),
      hairColor: (data.hairColor ?? '').trim(),
      weight: data.weight ?? null,
      height: (data.height ?? '').trim(),
      size: (data.size ?? '').trim(),
      appearance: (data.appearance ?? '').trim(),
    };

    // Only GM can set gmNotes
    if (member.isGM && data.gmNotes !== undefined) {
      $set.gmNotes = data.gmNotes;
    }

    await Player.findByIdAndUpdate(data.id, { $set });

    const updated = await Player.findById(data.id);
    if (!updated) throw new Error('Player not found after update');

    serverCaptureEvent(sessionUserId, 'player_updated', {
      campaign_id: data.campaignId,
      player_id: data.id,
      updated_by: userId,
    });

    return { success: true, player: { ...serializePlayer(updated), canEdit: true } };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'updatePlayer', playerId: data.id });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// deletePlayer
// ---------------------------------------------------------------------------

export { deletePlayerSchema };

export const deletePlayer = async ({ data }: { data: z.infer<typeof deletePlayerSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    if (!member.isGM) throw new Error('Forbidden');

    const existing = await Player.findById(data.id);
    if (!existing) throw new Error('Player not found');
    if (String(existing.campaignId) !== data.campaignId) throw new Error('Forbidden');

    await existing.deleteOne();

    // Clean up GM Screen references to this player.
    try {
      await removeDocumentRefsFromScreens(data.campaignId, 'player', data.id);
    } catch (cleanupError) {
      serverCaptureException(cleanupError, sessionUserId, {
        action: 'deletePlayer.cleanup',
        campaignId: data.campaignId,
        playerId: data.id,
      });
    }

    await pruneLoreLinks('player', data.id, data.campaignId);
    await pruneEventLinks('player', data.id, data.campaignId);

    try {
      await pruneMembershipsForMember('player', data.id, data.campaignId);
    } catch (pruneError) {
      serverCaptureException(pruneError, sessionUserId, {
        action: 'deletePlayer.pruneMemberships',
        campaign_id: data.campaignId,
        player_id: data.id,
      });
    }

    serverCaptureEvent(sessionUserId, 'player_deleted', {
      campaign_id: data.campaignId,
      player_id: data.id,
      deleted_by: member.userId,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'deletePlayer', playerId: data.id });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// updatePlayerStatus
// ---------------------------------------------------------------------------

export { updatePlayerStatusSchema };

export const updatePlayerStatus = async ({
  data,
}: {
  data: z.infer<typeof updatePlayerStatusSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    if (!member.isGM) throw new Error('Forbidden');

    const player = await Player.findById(data.id);
    if (!player) throw new Error('Player not found');
    if (String(player.campaignId) !== data.campaignId) throw new Error('Forbidden');

    player.status = { value: data.value, changedAt: new Date(), changedBy: member.userId };
    player.updatedAt = new Date();
    await player.save();

    serverCaptureEvent(sessionUserId, 'player_status_updated', {
      campaign_id: data.campaignId,
      player_id: data.id,
      status: data.value,
    });

    return { success: true, player: { ...serializePlayer(player), canEdit: true } };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'updatePlayerStatus',
      playerId: data.id,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// addPlayerRelationship
// ---------------------------------------------------------------------------

export { playerRelationshipSchema };

export const addPlayerRelationship = async ({
  data,
}: {
  data: z.infer<typeof playerRelationshipSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const player = await Player.findById(data.playerId);
    if (!player) throw new Error('Player not found');
    if (String(player.campaignId) !== data.campaignId) throw new Error('Forbidden');
    if (String(player.createdBy) !== userId && !member.isGM) throw new Error('Forbidden');

    // Verify the character exists in the same campaign
    const target = await Character.findById(data.characterId);
    if (!target) throw new Error('Character not found');
    if (String(target.campaignId) !== data.campaignId)
      throw new Error('Character not in same campaign');

    const existing = player.relationships?.find(
      (r: { characterId: unknown }) => String(r.characterId) === data.characterId
    );
    if (existing) throw new Error('Relationship already exists');

    await Player.updateOne(
      { _id: data.playerId },
      {
        $push: {
          relationships: {
            characterId: data.characterId,
            descriptor: data.descriptor,
            isPublic: data.isPublic,
          },
        },
        $set: { updatedAt: new Date() },
      }
    );

    serverCaptureEvent(sessionUserId, 'player_relationship_added', {
      campaign_id: data.campaignId,
      player_id: data.playerId,
      character_id: data.characterId,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'addPlayerRelationship',
      playerId: data.playerId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// updatePlayerRelationship
// ---------------------------------------------------------------------------

export const updatePlayerRelationship = async ({
  data,
}: {
  data: z.infer<typeof playerRelationshipSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const player = await Player.findById(data.playerId);
    if (!player) throw new Error('Player not found');
    if (String(player.campaignId) !== data.campaignId) throw new Error('Forbidden');
    if (String(player.createdBy) !== userId && !member.isGM) throw new Error('Forbidden');

    const updateSet: Record<string, unknown> = {};
    if (data.descriptor !== undefined) updateSet['relationships.$.descriptor'] = data.descriptor;
    if (data.isPublic !== undefined) updateSet['relationships.$.isPublic'] = data.isPublic;

    if (Object.keys(updateSet).length > 0) {
      updateSet.updatedAt = new Date();
      await Player.updateOne(
        { _id: data.playerId, 'relationships.characterId': data.characterId },
        { $set: updateSet }
      );
    }

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'updatePlayerRelationship',
      playerId: data.playerId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// removePlayerRelationship
// ---------------------------------------------------------------------------

export { removePlayerRelationshipSchema };

export const removePlayerRelationship = async ({
  data,
}: {
  data: z.infer<typeof removePlayerRelationshipSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const player = await Player.findById(data.playerId);
    if (!player) throw new Error('Player not found');
    if (String(player.campaignId) !== data.campaignId) throw new Error('Forbidden');
    if (String(player.createdBy) !== userId && !member.isGM) throw new Error('Forbidden');

    await Player.updateOne(
      { _id: data.playerId },
      {
        $pull: { relationships: { characterId: data.characterId } },
        $set: { updatedAt: new Date() },
      }
    );

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'removePlayerRelationship',
      playerId: data.playerId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// validateInviteCode
// ---------------------------------------------------------------------------

export { validateInviteCodeSchema };

export const validateInviteCode = async ({
  data,
}: {
  data: z.infer<typeof validateInviteCodeSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const user = await getSession();
    if (!user) throw new Error('Not authenticated');
    sessionUserId = user.id;

    await connectDB();
    if (!isDBConnected()) throw new Error('Database not available');

    const dbUser = await User.findOne({ providerId: user.id });
    if (!dbUser) throw new Error('User not found');

    const normalizedInviteCode = data.inviteCode.trim().toUpperCase();
    const campaign = await Campaign.findOne({ inviteCode: normalizedInviteCode });
    if (!campaign) throw new Error('Invalid invite code');
    if (campaign.status !== 'active') throw new Error('Campaign is not active');

    // Check if user is already a member
    const userId = String(dbUser._id);
    const alreadyMember =
      (campaign.members ?? []).some((m: { userId: unknown }) => String(m.userId) === userId) ||
      String(campaign.gameMasterId) === userId;
    if (alreadyMember) throw new Error('Already a member of this campaign');

    return {
      campaignId: String(campaign._id),
      name: campaign.name as string,
      description: (campaign.description as string) ?? '',
    };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'validateInviteCode' });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// completeJoinWizard
// ---------------------------------------------------------------------------

export { completeJoinWizardSchema };

export const completeJoinWizard = async ({
  data,
}: {
  data: z.infer<typeof completeJoinWizardSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const user = await getSession();
    if (!user) throw new Error('Not authenticated');
    sessionUserId = user.id;

    await connectDB();
    if (!isDBConnected()) throw new Error('Database not available');

    const dbUser = await User.findOne({ providerId: user.id });
    if (!dbUser) throw new Error('User not found');

    const userId = String(dbUser._id);
    const now = new Date();

    // 1. Add user to campaign members (with capacity check)
    const updatedCampaign = await Campaign.findOneAndUpdate(
      {
        _id: data.campaignId,
        status: 'active',
        'members.userId': { $ne: dbUser._id },
        $expr: {
          $lt: [
            {
              $size: {
                $filter: {
                  input: { $ifNull: ['$members', []] },
                  as: 'm',
                  cond: { $eq: ['$$m.role', 'player'] },
                },
              },
            },
            { $ifNull: ['$maxPlayers', 4] },
          ],
        },
      },
      {
        $addToSet: { members: { userId: dbUser._id, role: 'player', joinedAt: now } },
      },
      {
        new: true,
      }
    );

    if (!updatedCampaign) {
      throw new Error('Campaign is full');
    }

    // 2. Update User.campaigns
    await User.updateOne(
      { _id: dbUser._id },
      {
        $addToSet: {
          campaigns: { campaignId: updatedCampaign._id, status: 'active', joinedAt: now },
        },
      }
    );

    // 3. Guard against duplicate player (race condition / double-submit)
    const existingPlayer = await Player.findOne({
      campaignId: data.campaignId,
      createdBy: userId,
      'status.value': 'alive',
    });
    if (existingPlayer) throw new Error('Player already exists for this campaign');

    // 4. Create Player document
    const playerDoc = await Player.create({
      campaignId: data.campaignId,
      createdBy: userId,
      firstName: data.player.firstName.trim(),
      lastName: data.player.lastName.trim(),
      race: data.player.race.trim(),
      characterClass: data.player.characterClass.trim(),
      age: data.player.age,
      gender: (data.player.gender ?? '').trim(),
      location: (data.player.location ?? '').trim(),
      link: (data.player.link ?? '').trim(),
      picture: data.player.picture ?? '',
      pictureCrop: data.player.pictureCrop ?? null,
      description: (data.player.description ?? '').trim(),
      backstory: (data.player.backstory ?? '').trim(),
      color: data.player.color ?? '#3498db',
      eyeColor: (data.player.eyeColor ?? '').trim(),
      hairColor: (data.player.hairColor ?? '').trim(),
      weight: data.player.weight ?? null,
      height: (data.player.height ?? '').trim(),
      size: (data.player.size ?? '').trim(),
      appearance: (data.player.appearance ?? '').trim(),
      createdAt: now,
      updatedAt: now,
    });

    // 4. Create all Character documents
    const characterDocs = [];
    for (const charInput of data.characters) {
      const charDoc = await Character.create({
        campaignId: data.campaignId,
        createdBy: userId,
        firstName: charInput.firstName.trim(),
        lastName: charInput.lastName.trim(),
        race: (charInput.race ?? '').trim(),
        characterClass: (charInput.characterClass ?? '').trim(),
        age: charInput.age ?? null,
        location: (charInput.location ?? '').trim(),
        link: (charInput.link ?? '').trim(),
        picture: charInput.picture ?? '',
        pictureCrop: charInput.pictureCrop ?? null,
        notes: (charInput.notes ?? '').trim(),
        gmNotes: (charInput.gmNotes ?? '').trim(),
        tags: charInput.tags ?? [],
        isPublic: charInput.isPublic ?? false,
        createdAt: now,
        updatedAt: now,
      });
      characterDocs.push({ doc: charDoc, relationship: charInput.relationship });
    }

    // 5. Set up player-to-character relationships
    for (const { doc: charDoc, relationship } of characterDocs) {
      await Player.updateOne(
        { _id: playerDoc._id },
        {
          $push: {
            relationships: {
              characterId: charDoc._id,
              descriptor: relationship.descriptor,
              isPublic: relationship.isPublic ?? false,
            },
          },
        }
      );
    }

    // 6. Create Lore documents linked to the new player
    for (const entry of data.lore ?? []) {
      await Lore.create({
        title: entry.title,
        content: entry.content,
        gmContent: '',
        isPublic: entry.isPublic,
        images: [],
        tags: [],
        links: [{ kind: 'player', id: playerDoc._id }],
        campaignId: data.campaignId,
        createdBy: userId,
      });
    }

    serverCaptureEvent(sessionUserId, 'join_wizard_completed', {
      campaign_id: data.campaignId,
      player_id: String(playerDoc._id),
      character_count: characterDocs.length,
    });

    return {
      success: true,
      campaignId: data.campaignId,
      playerId: String(playerDoc._id),
    };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'completeJoinWizard',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// getActivePlayer
// ---------------------------------------------------------------------------

const getActivePlayerSchema = z.object({
  campaignId: z.string().min(1),
});

export { getActivePlayerSchema };

export const getActivePlayer = async ({
  data,
}: {
  data: z.infer<typeof getActivePlayerSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const doc = await Player.findOne({
      campaignId: data.campaignId,
      createdBy: userId,
      'status.value': 'alive',
    })
      .sort({ createdAt: -1 })
      .limit(1);

    if (!doc) return null;

    const serialized = serializePlayer(doc);
    return { ...serialized, canEdit: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'getActivePlayer',
      campaignId: data.campaignId,
    });
    throw e;
  }
};
