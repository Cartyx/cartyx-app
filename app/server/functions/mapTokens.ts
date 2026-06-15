import { createServerFn } from '@tanstack/react-start';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { Map as MapModel } from '../db/models/Map';
import { MapToken } from '../db/models/MapToken';
import { Player } from '../db/models/Player';
import { Character } from '../db/models/Character';
import { Monster } from '../db/models/Monster';
import { serverCaptureException, serverCaptureEvent } from '../utils/posthog';
import type { MapTokenData } from '~/types/mapToken';
import type { TokenSource } from '~/types/schemas/mapTokens';
import {
  listMapTokensSchema,
  createMapTokenSchema,
  createMapTokensBatchSchema,
  moveMapTokenSchema,
  updateMapTokenSchema,
  deleteMapTokenSchema,
} from '~/types/schemas/mapTokens';

// ---------------------------------------------------------------------------
// Serialiser
// ---------------------------------------------------------------------------

type TokenDoc = {
  _id: unknown;
  mapId: unknown;
  campaignId: unknown;
  sourceCollection?: string;
  sourceDocumentId?: unknown;
  ownerUserId?: unknown;
  x?: number;
  y?: number;
  sizeSquares?: number;
  instanceNumber?: number | null;
  color?: string;
  label?: string;
  imageUrl?: string;
  labelVisible?: boolean;
  hiddenFromPlayers?: boolean;
  zIndex?: number;
  createdAt?: Date;
  updatedAt?: Date;
};

function serializeToken(t: TokenDoc): MapTokenData {
  return {
    id: String(t._id),
    mapId: String(t.mapId),
    campaignId: String(t.campaignId),
    sourceCollection: (t.sourceCollection as TokenSource) ?? 'character',
    sourceDocumentId: String(t.sourceDocumentId ?? ''),
    ownerUserId: t.ownerUserId ? String(t.ownerUserId) : null,
    x: t.x ?? 0,
    y: t.y ?? 0,
    sizeSquares: t.sizeSquares ?? 1,
    instanceNumber: typeof t.instanceNumber === 'number' ? t.instanceNumber : null,
    color: t.color ?? '#3498db',
    label: t.label ?? '',
    imageUrl: t.imageUrl ?? '',
    labelVisible: t.labelVisible ?? true,
    hiddenFromPlayers: t.hiddenFromPlayers ?? false,
    zIndex: t.zIndex ?? 0,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : '',
    updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : '',
  };
}

// ---------------------------------------------------------------------------
// Auth helper (mirrors maps.ts)
// ---------------------------------------------------------------------------

async function requireCampaignMember(
  campaignId: string
): Promise<{ userId: string; sessionUserId: string; isGM: boolean }> {
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
  const member = members.find(
    (m: { userId: unknown; role?: string }) => String(m.userId) === userId
  );
  const isGM = String(campaign.gameMasterId) === userId || member?.role === 'gm';
  const isMember = !!member || isGM;
  if (!isMember) throw new Error('Forbidden');

  return { userId, sessionUserId: user.id, isGM };
}

// ---------------------------------------------------------------------------
// Token hydration — fills label/image/color/owner from the source entity.
// ---------------------------------------------------------------------------

/** Large creatures occupy more than one grid square. */
const MONSTER_SIZE_SQUARES: Record<string, number> = {
  tiny: 1,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
};

interface HydratedSource {
  label: string;
  imageUrl: string;
  color: string;
  ownerUserId: string | null;
  /** Token footprint in grid squares (driven by monster size; 1 otherwise). */
  sizeSquares: number;
  /** Default layer: monsters are GM-private; players/characters are public. */
  hiddenFromPlayers: boolean;
}

async function hydrateFromSource(
  sourceCollection: TokenSource,
  sourceDocumentId: string,
  campaignId: string
): Promise<HydratedSource> {
  if (sourceCollection === 'player') {
    const p = await Player.findOne({ _id: sourceDocumentId, campaignId }).lean();
    if (!p) throw new Error('Player not found in this campaign');
    const doc = p as {
      firstName?: string;
      lastName?: string;
      picture?: string;
      color?: string;
      createdBy?: unknown;
    };
    return {
      label: `${doc.firstName ?? ''} ${doc.lastName ?? ''}`.trim(),
      imageUrl: doc.picture ?? '',
      color: doc.color ?? '#3498db',
      ownerUserId: doc.createdBy ? String(doc.createdBy) : null,
      sizeSquares: 1,
      hiddenFromPlayers: false, // Public layer.
    };
  }

  if (sourceCollection === 'monster') {
    const m = await Monster.findOne({ _id: sourceDocumentId, campaignId }).lean();
    if (!m) throw new Error('Monster not found in this campaign');
    const doc = m as { name?: string; picture?: string; color?: string; size?: string };
    return {
      label: doc.name ?? '',
      imageUrl: doc.picture ?? '',
      color: doc.color ?? '#9ca3af',
      ownerUserId: null,
      sizeSquares: MONSTER_SIZE_SQUARES[doc.size ?? 'medium'] ?? 1,
      hiddenFromPlayers: true, // GM-private layer by default.
    };
  }

  const c = await Character.findOne({ _id: sourceDocumentId, campaignId }).lean();
  if (!c) throw new Error('Character not found in this campaign');
  const doc = c as {
    firstName?: string;
    lastName?: string;
    picture?: string;
    color?: string;
  };
  return {
    label: `${doc.firstName ?? ''} ${doc.lastName ?? ''}`.trim(),
    imageUrl: doc.picture ?? '',
    color: doc.color ?? '#9ca3af',
    // GM-owned characters: no ownerUserId (only GMs can move them).
    ownerUserId: null,
    sizeSquares: 1,
    hiddenFromPlayers: false, // Public layer.
  };
}

// ---------------------------------------------------------------------------
// Monster instance numbering — "Goblin A", "Goblin B", … per (map, monster).
// ---------------------------------------------------------------------------

/** Bijective base-26 label: 1→A, 26→Z, 27→AA, 28→AB, … */
function instanceLabel(n: number): string {
  let s = '';
  let v = n;
  while (v > 0) {
    const r = (v - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    v = Math.floor((v - 1) / 26);
  }
  return s || 'A';
}

/**
 * The `count` lowest positive instance numbers not already used by tokens of
 * this monster on this map. Reuses numbers freed by deletions so labels stay
 * compact and collision-free.
 */
async function nextInstanceNumbers(
  mapId: string,
  sourceDocumentId: string,
  count: number
): Promise<number[]> {
  const existing = await MapToken.find(
    { mapId, sourceCollection: 'monster', sourceDocumentId },
    'instanceNumber'
  ).lean();
  const used = new Set<number>(
    existing
      .map((t) => (t as { instanceNumber?: number | null }).instanceNumber)
      .filter((n): n is number => typeof n === 'number')
  );
  const out: number[] = [];
  let n = 1;
  while (out.length < count) {
    if (!used.has(n)) out.push(n);
    n += 1;
  }
  return out;
}

function randomPosition(width: number, height: number): { x: number; y: number } {
  // Keep a margin so tokens don't spawn flush against the edge.
  const mx = Math.min(width * 0.1, 80);
  const my = Math.min(height * 0.1, 80);
  return {
    x: mx + Math.random() * Math.max(1, width - 2 * mx),
    y: my + Math.random() * Math.max(1, height - 2 * my),
  };
}

// ---------------------------------------------------------------------------
// listMapTokens (members)
// ---------------------------------------------------------------------------

export const listMapTokens = createServerFn({ method: 'GET' })
  .inputValidator(listMapTokensSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      // Campaign membership alone does not prove the requested map belongs to
      // this campaign. Scope the map by campaignId (like the mutating siblings)
      // so a member of one campaign can't read tokens of another's maps.
      const map = await MapModel.findOne({ _id: data.mapId, campaignId: data.campaignId }).lean();
      if (!map) throw new Error('Map not found');

      const filter: Record<string, unknown> = { mapId: data.mapId };
      if (!member.isGM) filter.hiddenFromPlayers = { $ne: true };
      // Bound the result set; batch placement can add many tokens per map.
      const docs = await MapToken.find(filter).sort({ zIndex: 1, createdAt: 1 }).limit(2000).lean();
      return { tokens: docs.map((d) => serializeToken(d as TokenDoc)) };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'listMapTokens',
        campaignId: data.campaignId,
        mapId: data.mapId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// createMapToken (GM only)
// ---------------------------------------------------------------------------

export const createMapToken = createServerFn({ method: 'POST' })
  .inputValidator(createMapTokenSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;
      if (!member.isGM) throw new Error('Forbidden');

      const map = await MapModel.findOne({ _id: data.mapId, campaignId: data.campaignId }).lean();
      if (!map) throw new Error('Map not found');
      const mDoc = map as { imageWidth?: number; imageHeight?: number };

      // Clamp drop coordinates into the image.
      const w = mDoc.imageWidth ?? 0;
      const h = mDoc.imageHeight ?? 0;
      const x = Math.max(0, Math.min(w, data.x));
      const y = Math.max(0, Math.min(h, data.y));

      const hydrated = await hydrateFromSource(
        data.sourceCollection,
        data.sourceDocumentId,
        data.campaignId
      );

      // Monsters can appear many times per map, so each instance gets its own
      // number + letter suffix ("Goblin A"). Players/characters stay unique
      // (null instanceNumber) and keep their plain label.
      let instanceNumber: number | null = null;
      let label = hydrated.label;
      if (data.sourceCollection === 'monster') {
        instanceNumber = (await nextInstanceNumbers(data.mapId, data.sourceDocumentId, 1))[0];
        label = `${hydrated.label} ${instanceLabel(instanceNumber)}`;
      }

      try {
        const doc = await MapToken.create({
          mapId: data.mapId,
          campaignId: data.campaignId,
          sourceCollection: data.sourceCollection,
          sourceDocumentId: data.sourceDocumentId,
          ownerUserId: hydrated.ownerUserId,
          x,
          y,
          // Honour an explicit footprint from the caller, else the
          // size derived from the source entity (monsters scale up).
          sizeSquares: data.sizeSquares ?? hydrated.sizeSquares,
          instanceNumber,
          color: hydrated.color,
          label,
          imageUrl: hydrated.imageUrl,
          hiddenFromPlayers: hydrated.hiddenFromPlayers,
          createdBy: member.userId,
        });
        serverCaptureEvent(sessionUserId, 'map_token_placed', {
          campaign_id: data.campaignId,
          map_id: data.mapId,
          source_collection: data.sourceCollection,
        });
        return { token: serializeToken(doc.toObject() as TokenDoc), existed: false };
      } catch (createErr) {
        // Unique key conflict → return existing token (refocus, not duplicate).
        if ((createErr as { code?: number }).code === 11000) {
          const existing = await MapToken.findOne({
            mapId: data.mapId,
            sourceCollection: data.sourceCollection,
            sourceDocumentId: data.sourceDocumentId,
          }).lean();
          if (existing) {
            return { token: serializeToken(existing as TokenDoc), existed: true };
          }
        }
        throw createErr;
      }
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'createMapToken',
        campaignId: data.campaignId,
        mapId: data.mapId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// createMapTokensBatch (GM only) — place N monster instances at random spots.
// ---------------------------------------------------------------------------

export const createMapTokensBatch = createServerFn({ method: 'POST' })
  .inputValidator(createMapTokensBatchSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;
      if (!member.isGM) throw new Error('Forbidden');

      const map = await MapModel.findOne({ _id: data.mapId, campaignId: data.campaignId }).lean();
      if (!map) throw new Error('Map not found');
      const mDoc = map as { imageWidth?: number; imageHeight?: number };
      const w = mDoc.imageWidth ?? 0;
      const h = mDoc.imageHeight ?? 0;

      const hydrated = await hydrateFromSource(
        data.sourceCollection,
        data.sourceDocumentId,
        data.campaignId
      );

      const numbers = await nextInstanceNumbers(data.mapId, data.sourceDocumentId, data.count);
      const docs = numbers.map((n) => {
        const pos = randomPosition(w, h);
        return {
          mapId: data.mapId,
          campaignId: data.campaignId,
          sourceCollection: data.sourceCollection,
          sourceDocumentId: data.sourceDocumentId,
          ownerUserId: hydrated.ownerUserId,
          x: pos.x,
          y: pos.y,
          sizeSquares: hydrated.sizeSquares,
          instanceNumber: n,
          color: hydrated.color,
          label: `${hydrated.label} ${instanceLabel(n)}`,
          imageUrl: hydrated.imageUrl,
          hiddenFromPlayers: hydrated.hiddenFromPlayers,
          createdBy: member.userId,
        };
      });

      const created = await MapToken.insertMany(docs);
      serverCaptureEvent(sessionUserId, 'map_tokens_batch_placed', {
        campaign_id: data.campaignId,
        map_id: data.mapId,
        count: data.count,
      });
      return {
        tokens: created.map((d) => serializeToken((d.toObject?.() ?? d) as TokenDoc)),
      };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'createMapTokensBatch',
        campaignId: data.campaignId,
        mapId: data.mapId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// moveMapToken (GM or owner)
// ---------------------------------------------------------------------------

export const moveMapToken = createServerFn({ method: 'POST' })
  .inputValidator(moveMapTokenSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const token = await MapToken.findOne({
        _id: data.tokenId,
        mapId: data.mapId,
        campaignId: data.campaignId,
      });
      if (!token) throw new Error('Token not found');

      const canMove =
        member.isGM || (token.ownerUserId != null && String(token.ownerUserId) === member.userId);
      if (!canMove) throw new Error('Forbidden');

      const map = await MapModel.findOne(
        { _id: data.mapId, campaignId: data.campaignId },
        'imageWidth imageHeight'
      ).lean();
      const mDoc = (map ?? {}) as { imageWidth?: number; imageHeight?: number };
      const w = mDoc.imageWidth ?? Number.POSITIVE_INFINITY;
      const h = mDoc.imageHeight ?? Number.POSITIVE_INFINITY;
      token.x = Math.max(0, Math.min(w, data.x));
      token.y = Math.max(0, Math.min(h, data.y));
      token.updatedAt = new Date();
      await token.save();

      return { token: serializeToken(token.toObject() as TokenDoc) };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'moveMapToken',
        campaignId: data.campaignId,
        tokenId: data.tokenId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// updateMapToken (GM only)
// ---------------------------------------------------------------------------

export const updateMapToken = createServerFn({ method: 'POST' })
  .inputValidator(updateMapTokenSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;
      if (!member.isGM) throw new Error('Forbidden');

      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (data.labelVisible !== undefined) update.labelVisible = data.labelVisible;
      if (data.hiddenFromPlayers !== undefined) update.hiddenFromPlayers = data.hiddenFromPlayers;
      if (data.sizeSquares !== undefined) update.sizeSquares = data.sizeSquares;
      if (data.color !== undefined) update.color = data.color;
      if (data.label !== undefined) update.label = data.label;

      const doc = await MapToken.findOneAndUpdate(
        { _id: data.tokenId, mapId: data.mapId, campaignId: data.campaignId },
        { $set: update },
        { new: true }
      ).lean();
      if (!doc) throw new Error('Token not found');

      return { token: serializeToken(doc as TokenDoc) };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'updateMapToken',
        campaignId: data.campaignId,
        tokenId: data.tokenId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// deleteMapToken (GM only)
// ---------------------------------------------------------------------------

export const deleteMapToken = createServerFn({ method: 'POST' })
  .inputValidator(deleteMapTokenSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;
      if (!member.isGM) throw new Error('Forbidden');

      const result = await MapToken.deleteOne({
        _id: data.tokenId,
        mapId: data.mapId,
        campaignId: data.campaignId,
      });
      if (result.deletedCount === 0) throw new Error('Token not found');
      return { success: true };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'deleteMapToken',
        campaignId: data.campaignId,
        tokenId: data.tokenId,
      });
      throw e;
    }
  });
