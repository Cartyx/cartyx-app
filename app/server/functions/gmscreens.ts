import { z } from 'zod';
import mongoose from 'mongoose';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { GMScreen, GMSCREEN_LIMITS } from '../db/models/GMScreen';
import { Note } from '../db/models/Note';
import { Character } from '../db/models/Character';
import { Race } from '../db/models/Race';
import { Rule } from '../db/models/Rule';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import type {
  GMScreenData,
  WindowData,
  StackItemData,
  StackData,
  HydratedDocument,
  GMScreenDetailData,
  WindowState,
} from '~/types/gmscreen';
import { WINDOW_STATES } from '~/types/gmscreen';
import {
  listGMScreensSchema,
  createGMScreenSchema,
  renameGMScreenSchema,
  deleteGMScreenSchema,
  reorderGMScreensSchema,
  getGMScreenSchema,
  openWindowSchema,
  updateWindowSchema,
  closeWindowSchema,
  createStackSchema,
  renameStackSchema,
  moveStackSchema,
  deleteStackSchema,
  addStackItemSchema,
  removeStackItemSchema,
} from '~/types/schemas/gmscreens';

function serializeGMScreen(doc: {
  _id: unknown;
  campaignId: unknown;
  name?: string;
  tabOrder?: number;
  createdBy: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}): GMScreenData {
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    name: doc.name ?? '',
    tabOrder: doc.tabOrder ?? 0,
    createdBy: String(doc.createdBy),
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : '',
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : '',
  };
}

function serializeWindow(w: {
  _id: unknown;
  collection?: string;
  documentId: unknown;
  state?: string;
  x?: number | null;
  y?: number | null;
  width?: number | null;
  height?: number | null;
  zIndex?: number;
}): WindowData {
  return {
    id: String(w._id),
    collection: w.collection ?? '',
    documentId: String(w.documentId),
    state: WINDOW_STATES.includes(w.state as WindowState) ? (w.state as WindowState) : 'open',
    x: w.x ?? null,
    y: w.y ?? null,
    width: w.width ?? null,
    height: w.height ?? null,
    zIndex: w.zIndex ?? 0,
  };
}

function serializeStackItem(item: {
  _id: unknown;
  collection?: string;
  documentId: unknown;
  label?: string;
}): StackItemData {
  return {
    id: String(item._id),
    collection: item.collection ?? '',
    documentId: String(item.documentId),
    label: item.label ?? '',
  };
}

function serializeStack(s: {
  _id: unknown;
  name?: string;
  x?: number | null;
  y?: number | null;
  items?: Array<{ _id: unknown; collection?: string; documentId: unknown; label?: string }>;
}): StackData {
  return {
    id: String(s._id),
    name: s.name ?? '',
    x: s.x ?? null,
    y: s.y ?? null,
    items: (s.items ?? []).map(serializeStackItem),
  };
}

// ---------------------------------------------------------------------------
// Collection registry — maps collection names to fetch logic
// ---------------------------------------------------------------------------

interface CollectionFetcher {
  fetch(
    ids: string[],
    campaignId: string
  ): Promise<
    Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean; link?: string }>
  >;
}

const COLLECTION_REGISTRY: Record<string, CollectionFetcher> = {
  note: {
    async fetch(ids: string[], campaignId: string) {
      return Note.find({ _id: { $in: ids }, campaignId }, '_id title note')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { title?: string }).title,
            content: (d as { note?: string }).note,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string }>>;
    },
  },
  character: {
    async fetch(ids: string[], campaignId: string) {
      return Character.find(
        { _id: { $in: ids }, campaignId },
        '_id firstName lastName notes isPublic link'
      )
        .lean()
        .then((docs) =>
          docs.map((d) => {
            const ch = d as {
              _id: unknown;
              firstName?: string;
              lastName?: string;
              notes?: string;
              isPublic?: boolean;
              link?: string;
            };
            return {
              _id: ch._id,
              title: `${ch.firstName ?? ''} ${ch.lastName ?? ''}`.trim(),
              content: ch.notes,
              isPublic: ch.isPublic,
              link: ch.link,
            };
          })
        ) as Promise<
        Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean; link?: string }>
      >;
    },
  },
  race: {
    async fetch(ids: string[], campaignId: string) {
      return Race.find({ _id: { $in: ids }, campaignId }, '_id title content')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { title?: string }).title,
            content: (d as { content?: string }).content,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string }>>;
    },
  },
  rule: {
    async fetch(ids: string[], campaignId: string) {
      return Rule.find({ _id: { $in: ids }, campaignId }, '_id title content isPublic')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { title?: string }).title,
            content: (d as { content?: string }).content,
            isPublic: (d as { isPublic?: boolean }).isPublic,
          }))
        ) as Promise<
        Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean; link?: string }>
      >;
    },
  },
  lore: {
    async fetch(ids: string[], campaignId: string) {
      const { Lore } = await import('../db/models/Lore');
      return Lore.find({ _id: { $in: ids }, campaignId }, '_id title content isPublic')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { title?: string }).title,
            content: (d as { content?: string }).content,
            isPublic: (d as { isPublic?: boolean }).isPublic,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean }>>;
    },
  },
  events: {
    async fetch(ids: string[], campaignId: string) {
      const { Event } = await import('../db/models/Event');
      return Event.find({ _id: { $in: ids }, campaignId }, '_id title content isPublic')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { title?: string }).title,
            content: (d as { content?: string }).content,
            isPublic: (d as { isPublic?: boolean }).isPublic,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean }>>;
    },
  },
  location: {
    async fetch(ids: string[], campaignId: string) {
      const { Location } = await import('../db/models/Location');
      return Location.find({ _id: { $in: ids }, campaignId }, '_id name description isPublic')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { name?: string }).name,
            content: (d as { description?: string }).description,
            isPublic: (d as { isPublic?: boolean }).isPublic,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean }>>;
    },
  },
  player: {
    async fetch(ids: string[], campaignId: string) {
      const { Player } = await import('../db/models/Player');
      return Player.find(
        { _id: { $in: ids }, campaignId },
        '_id firstName lastName description color'
      )
        .lean()
        .then(
          (
            docs: Array<{
              _id: unknown;
              firstName?: string;
              lastName?: string;
              description?: string;
              color?: string;
            }>
          ) =>
            docs.map((d) => ({
              _id: d._id,
              title: `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim(),
              content: d.description ?? '',
              isPublic: true,
              color: d.color ?? '#3498db',
            }))
        );
    },
  },
  monster: {
    async fetch(ids: string[], campaignId: string) {
      // Monsters are GM-only; the GM-screens tab is itself GM-only, so the
      // window title bar can surface the name (the window renders the full
      // stat block via MonsterWindowWrapper, which fetches its own data).
      const { Monster } = await import('../db/models/Monster');
      return Monster.find({ _id: { $in: ids }, campaignId }, '_id name gmNotes')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { name?: string }).name,
            content: (d as { gmNotes?: string }).gmNotes ?? '',
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string }>>;
    },
  },
  organization: {
    async fetch(ids: string[], campaignId: string) {
      const { Organization } = await import('../db/models/Organization');
      return Organization.find({ _id: { $in: ids }, campaignId }, '_id name publicInfo isPublic')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { name?: string }).name,
            content: (d as { publicInfo?: string }).publicInfo,
            isPublic: (d as { isPublic?: boolean }).isPublic,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean }>>;
    },
  },
  quest: {
    async fetch(ids: string[], campaignId: string) {
      const { Quest } = await import('../db/models/Quest');
      return Quest.find({ _id: { $in: ids }, campaignId }, '_id name publicInfo isPublic status')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { name?: string }).name,
            content: (d as { publicInfo?: string }).publicInfo,
            isPublic: (d as { isPublic?: boolean }).isPublic,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean }>>;
    },
  },
  spell: {
    async fetch(ids: string[], campaignId: string) {
      const { Spell } = await import('../db/models/Spell');
      return Spell.find({ _id: { $in: ids }, campaignId }, '_id name description')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { name?: string }).name,
            content: (d as { description?: string }).description,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string }>>;
    },
  },
};

/**
 * Batch-hydrate a set of `{ collection, documentId }` refs.
 * Groups by collection, fetches each batch, and returns a lookup map
 * keyed by `"collection:documentId"`.
 */
async function hydrateRefs(
  refs: Array<{ collection: string; documentId: string }>,
  campaignId: string
): Promise<Record<string, HydratedDocument>> {
  const grouped = new Map<string, Set<string>>();
  for (const ref of refs) {
    if (!ref.collection || !ref.documentId) continue;
    let set = grouped.get(ref.collection);
    if (!set) {
      set = new Set();
      grouped.set(ref.collection, set);
    }
    set.add(ref.documentId);
  }

  const hydrated: Record<string, HydratedDocument> = {};

  await Promise.all(
    Array.from(grouped.entries()).map(async ([collectionName, idSet]) => {
      const fetcher = COLLECTION_REGISTRY[collectionName];
      if (!fetcher) return;

      const docs = await fetcher.fetch(Array.from(idSet), campaignId);
      for (const doc of docs) {
        const id = String(doc._id);
        hydrated[`${collectionName}:${id}`] = {
          id,
          collection: collectionName,
          title: doc.title ?? '',
          content: doc.content ?? '',
          ...(doc.isPublic !== undefined && { isPublic: doc.isPublic }),
          ...(doc.link && { link: doc.link }),
        };
      }
    })
  );

  return hydrated;
}

/** Marks errors that were already reported to the error tracker. */
class AlreadyReportedError extends Error {
  readonly alreadyReported = true as const;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = 'AlreadyReportedError';
  }
}

function isDuplicateKeyError(e: unknown, field: string): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { code?: number; keyPattern?: Record<string, unknown>; message?: string };
  if (err.code !== 11000) return false;
  if (err.keyPattern) return field in err.keyPattern;
  return typeof err.message === 'string' && err.message.includes(field);
}

// ---------------------------------------------------------------------------
// Auth helper — requires the caller to be a GM for the campaign
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

  // GM access: user is the gameMasterId OR has role 'gm' in members
  const isGM =
    String(campaign.gameMasterId) === userId ||
    members.some((m) => String(m.userId) === userId && m.role === 'gm');
  if (!isGM) throw new Error('Forbidden');

  return { userId, sessionUserId: user.id };
}

// ---------------------------------------------------------------------------
// listGMScreens
// ---------------------------------------------------------------------------

export { listGMScreensSchema };

export const listGMScreens = async ({ data }: { data: z.infer<typeof listGMScreensSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    const docs = await GMScreen.find(
      { campaignId: data.campaignId },
      '_id campaignId name tabOrder createdBy createdAt updatedAt'
    )
      .sort({ tabOrder: 1 })
      .lean();

    return (
      docs as Array<{
        _id: unknown;
        campaignId: unknown;
        name?: string;
        tabOrder?: number;
        createdBy: unknown;
        createdAt?: Date;
        updatedAt?: Date;
      }>
    ).map(serializeGMScreen);
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'listGMScreens',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// createGMScreen
// ---------------------------------------------------------------------------

export { createGMScreenSchema };

const MAX_TAB_ORDER_RETRIES = 3;

export const createGMScreen = async ({ data }: { data: z.infer<typeof createGMScreenSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    let doc: {
      _id: unknown;
      campaignId: unknown;
      name?: string;
      tabOrder?: number;
      createdBy: unknown;
      createdAt?: Date;
      updatedAt?: Date;
    };

    for (let attempt = 0; attempt < MAX_TAB_ORDER_RETRIES; attempt++) {
      const mongoSession = await mongoose.startSession();
      try {
        doc = (await mongoSession.withTransaction(async () => {
          const last = (await GMScreen.findOne({ campaignId: data.campaignId })
            .sort({ tabOrder: -1 })
            .select('tabOrder')
            .session(mongoSession)
            .lean()) as { tabOrder?: number } | null;

          const nextOrder = (last?.tabOrder ?? -1) + 1;

          const now = new Date();
          const createdDocs = (await GMScreen.create(
            [
              {
                campaignId: data.campaignId,
                name: data.name.trim(),
                tabOrder: nextOrder,
                createdBy: gm.userId,
                createdAt: now,
                updatedAt: now,
              },
            ],
            { session: mongoSession }
          )) as unknown as unknown[];
          const created = createdDocs[0];

          return created;
        })) as typeof doc;
      } catch (e) {
        if (isDuplicateKeyError(e, 'tabOrder')) {
          continue;
        }
        throw e;
      } finally {
        await mongoSession.endSession();
      }

      serverCaptureEvent(sessionUserId, 'gmscreen_created', {
        campaign_id: data.campaignId,
        screen_id: String(doc._id),
      });

      return { success: true, screen: serializeGMScreen(doc) };
    }

    const exhaustionError = new Error('Failed to allocate tabOrder after retries');
    serverCaptureException(exhaustionError, sessionUserId, {
      action: 'createGMScreen',
      campaignId: data.campaignId,
      retries: MAX_TAB_ORDER_RETRIES,
    });
    throw new AlreadyReportedError(
      'Could not create the screen due to a conflict. Please try again.'
    );
  } catch (e) {
    if (isDuplicateKeyError(e, 'name')) {
      throw new Error('A screen with that name already exists in this campaign');
    }
    // Avoid double-reporting: the retry exhaustion path already captured
    // the internal error above — only capture genuinely unexpected failures.
    if (!(e instanceof AlreadyReportedError)) {
      serverCaptureException(e, sessionUserId, {
        action: 'createGMScreen',
        campaignId: data.campaignId,
      });
    }
    throw e;
  }
};

// ---------------------------------------------------------------------------
// renameGMScreen
// ---------------------------------------------------------------------------

export { renameGMScreenSchema };

export const renameGMScreen = async ({ data }: { data: z.infer<typeof renameGMScreenSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    const screen = await GMScreen.findById(data.id);
    if (!screen) throw new Error('Screen not found');
    if (String(screen.campaignId) !== data.campaignId) throw new Error('Forbidden');

    screen.name = data.name.trim();
    screen.updatedAt = new Date();
    await screen.save();

    serverCaptureEvent(sessionUserId, 'gmscreen_renamed', {
      campaign_id: data.campaignId,
      screen_id: data.id,
    });

    return { success: true, screen: serializeGMScreen(screen) };
  } catch (e) {
    if ((e as { code?: number })?.code === 11000) {
      throw new Error('A screen with that name already exists in this campaign');
    }
    serverCaptureException(e, sessionUserId, { action: 'renameGMScreen', screenId: data.id });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// deleteGMScreen
// ---------------------------------------------------------------------------

export { deleteGMScreenSchema };

export const deleteGMScreen = async ({ data }: { data: z.infer<typeof deleteGMScreenSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    // Use a transaction so the count-check + delete is atomic
    const mongoSession = await mongoose.startSession();
    let deletedTabOrder: number;
    try {
      deletedTabOrder = await mongoSession.withTransaction(async () => {
        const screen = await GMScreen.findOne({
          _id: data.id,
          campaignId: data.campaignId,
        }).session(mongoSession);
        if (!screen) throw new Error('Screen not found');

        const count = await GMScreen.countDocuments({
          campaignId: data.campaignId,
        }).session(mongoSession);
        if (count <= 1) throw new Error('Cannot delete the last screen');

        const tabOrder = typeof screen.tabOrder === 'number' ? screen.tabOrder : 0;
        await GMScreen.deleteOne({ _id: data.id, campaignId: data.campaignId }).session(
          mongoSession
        );

        return tabOrder;
      });
    } finally {
      await mongoSession.endSession();
    }

    // Return the remaining screens so the client can resolve the next active screen
    const remaining = await GMScreen.find(
      { campaignId: data.campaignId },
      '_id campaignId name tabOrder createdBy createdAt updatedAt'
    )
      .sort({ tabOrder: 1 })
      .lean();

    serverCaptureEvent(sessionUserId, 'gmscreen_deleted', {
      campaign_id: data.campaignId,
      screen_id: data.id,
    });

    return {
      success: true,
      deletedTabOrder,
      remaining: (
        remaining as Array<{
          _id: unknown;
          campaignId: unknown;
          name?: string;
          tabOrder?: number;
          createdBy: unknown;
          createdAt?: Date;
          updatedAt?: Date;
        }>
      ).map(serializeGMScreen),
    };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'deleteGMScreen', screenId: data.id });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// reorderGMScreens
// ---------------------------------------------------------------------------

export { reorderGMScreensSchema };

export const reorderGMScreens = async ({
  data,
}: {
  data: z.infer<typeof reorderGMScreensSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    // Use a transaction for atomic read + bulkWrite
    const mongoSession = await mongoose.startSession();
    try {
      await mongoSession.withTransaction(async () => {
        const screens = (await GMScreen.find({ campaignId: data.campaignId }, '_id')
          .session(mongoSession)
          .lean()) as Array<{ _id: unknown }>;

        const existingIds = new Set(screens.map((s) => String(s._id)));

        // Validate input is a full permutation: no duplicates, no missing screens
        const inputIds = new Set(data.screenIds);
        if (inputIds.size !== data.screenIds.length) {
          throw new Error('Duplicate screen IDs in reorder request');
        }
        for (const id of data.screenIds) {
          if (!existingIds.has(id)) {
            throw new Error(`Screen ${id} not found in this campaign`);
          }
        }
        for (const id of existingIds) {
          if (!inputIds.has(id)) {
            throw new Error(`Missing screen ${id} in reorder request`);
          }
        }

        // Two-phase reorder to avoid transient unique-index collisions:
        // Phase 1 — move all screens to negative tabOrder values
        const now = new Date();
        await GMScreen.bulkWrite(
          data.screenIds.map((id, index) => ({
            updateOne: {
              filter: { _id: id, campaignId: data.campaignId },
              update: { $set: { tabOrder: -(index + 1), updatedAt: now } },
            },
          })),
          { session: mongoSession }
        );

        // Phase 2 — assign final tabOrder values (all non-negative, no collisions)
        await GMScreen.bulkWrite(
          data.screenIds.map((id, index) => ({
            updateOne: {
              filter: { _id: id, campaignId: data.campaignId },
              update: { $set: { tabOrder: index } },
            },
          })),
          { session: mongoSession }
        );
      });
    } finally {
      await mongoSession.endSession();
    }

    serverCaptureEvent(sessionUserId, 'gmscreens_reordered', {
      campaign_id: data.campaignId,
      screen_count: data.screenIds.length,
    });

    // Return the freshly ordered screens
    const ordered = await GMScreen.find(
      { campaignId: data.campaignId },
      '_id campaignId name tabOrder createdBy createdAt updatedAt'
    )
      .sort({ tabOrder: 1 })
      .lean();

    return {
      success: true,
      screens: (
        ordered as Array<{
          _id: unknown;
          campaignId: unknown;
          name?: string;
          tabOrder?: number;
          createdBy: unknown;
          createdAt?: Date;
          updatedAt?: Date;
        }>
      ).map(serializeGMScreen),
    };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'reorderGMScreens',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// getGMScreen — fetch a single screen with hydrated referenced content
// ---------------------------------------------------------------------------

export { getGMScreenSchema };

export const getGMScreen = async ({
  data,
}: {
  data: z.infer<typeof getGMScreenSchema>;
}): Promise<GMScreenDetailData> => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    const doc = (await GMScreen.findOne({
      _id: data.id,
      campaignId: data.campaignId,
    }).lean()) as {
      _id: unknown;
      campaignId: unknown;
      name?: string;
      tabOrder?: number;
      createdBy: unknown;
      createdAt?: Date;
      updatedAt?: Date;
      windows?: Array<{
        _id: unknown;
        collection?: string;
        documentId: unknown;
        state?: string;
        x?: number | null;
        y?: number | null;
        width?: number | null;
        height?: number | null;
        zIndex?: number;
      }>;
      stacks?: Array<{
        _id: unknown;
        name?: string;
        x?: number | null;
        y?: number | null;
        items?: Array<{ _id: unknown; collection?: string; documentId: unknown; label?: string }>;
      }>;
    } | null;

    if (!doc) throw new Error('Screen not found');

    const windows = (doc.windows ?? []).map(serializeWindow);
    const stacks = (doc.stacks ?? []).map(serializeStack);

    // Collect all refs from windows and stack items
    const refs: Array<{ collection: string; documentId: string }> = [];
    for (const w of windows) {
      refs.push({ collection: w.collection, documentId: w.documentId });
    }
    for (const s of stacks) {
      for (const item of s.items) {
        refs.push({ collection: item.collection, documentId: item.documentId });
      }
    }

    const hydrated = await hydrateRefs(refs, data.campaignId);

    return {
      ...serializeGMScreen(doc),
      windows,
      stacks,
      hydrated,
    };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'getGMScreen', screenId: data.id });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// openWindow — open a wiki ref as a window (or focus existing duplicate)
// ---------------------------------------------------------------------------

/**
 * **Duplicate rule:** If a window with the same `collection + documentId` already
 * exists on this screen, the existing window is focused (state → 'open', zIndex
 * bumped to max + 1) and returned with `existed: true`.  No second window is
 * created for the same ref — enforced atomically via a conditional
 * `updateOne` filter (`$nor: [{ windows: { $elemMatch: {...} } }]`) so that
 * two concurrent calls for the same ref cannot both create a window.
 */

export { openWindowSchema };

/**
 * Focuses an already-open (or just-raced-open) window sub-doc: bumps its
 * zIndex above the current max and sets state back to 'open', then persists
 * via `.save()`. Shared by the "already existed on read" path and the
 * "lost the atomic create race" fallback path in `openWindow`.
 */
async function focusWindowAndSave(
  screen: { updatedAt: Date; save: () => Promise<unknown> },
  windows: Array<{ zIndex?: number }>,
  existing: { _id: unknown; state?: string; zIndex?: number }
) {
  const maxZ = windows.reduce(
    (max: number, w: { zIndex?: number }) => Math.max(max, w.zIndex ?? 0),
    0
  );
  existing.state = 'open';
  existing.zIndex = maxZ + 1;
  screen.updatedAt = new Date();
  await screen.save();
  return existing;
}

export const openWindow = async ({ data }: { data: z.infer<typeof openWindowSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    const screen = await GMScreen.findOne({
      _id: data.screenId,
      campaignId: data.campaignId,
    });
    if (!screen) throw new Error('Screen not found');

    if (!screen.windows) {
      // Legacy screens may lack the field; `[]` alone infers as never[].
      screen.windows = [] as unknown as typeof screen.windows;
    }
    const windows = screen.windows;

    // Check for existing window with same ref
    const existing = windows.find(
      (w: { collection?: string; documentId?: unknown }) =>
        w.collection === data.collection && String(w.documentId) === data.documentId
    );

    if (existing) {
      await focusWindowAndSave(screen, windows, existing);

      serverCaptureEvent(sessionUserId, 'gmscreen_window_focused', {
        campaign_id: data.campaignId,
        screen_id: data.screenId,
        window_id: String(existing._id),
      });

      return { success: true, window: serializeWindow(existing), existed: true };
    }

    // Enforce cap — fast-path only. Like the `existing` check above, this
    // reads a possibly-stale snapshot; the authoritative cap enforcement is
    // the $expr size condition in the atomic filter below.
    if (windows.length >= GMSCREEN_LIMITS.MAX_WINDOWS) {
      throw new Error(`A screen cannot have more than ${GMSCREEN_LIMITS.MAX_WINDOWS} windows`);
    }

    // Create new window
    const maxZ = windows.reduce(
      (max: number, w: { zIndex?: number }) => Math.max(max, w.zIndex ?? 0),
      0
    );
    const newWindow = {
      collection: data.collection,
      documentId: data.documentId,
      state: 'open' as const,
      x: data.x ?? null,
      y: data.y ?? null,
      width: null,
      height: null,
      zIndex: maxZ + 1,
    };

    // Atomic conditional push — this is the fix for the create/create race:
    // two concurrent calls can both pass the `existing` and cap checks above
    // (both read the array before either write lands), but this filter is
    // re-evaluated by Mongo against the *current* document at write time.
    // The $nor clause rejects the push when a window for this ref already
    // exists (dedupe); the $expr size clause rejects it when the array is
    // already at the cap — needed because schema validators don't run on
    // updateOne pushes, so without it two concurrent opens of *different*
    // refs at length cap-1 would land cap+1 windows.
    const pushResult = await GMScreen.updateOne(
      {
        _id: data.screenId,
        campaignId: data.campaignId,
        $nor: [
          {
            windows: {
              $elemMatch: { collection: data.collection, documentId: data.documentId },
            },
          },
        ],
        // $ifNull guards legacy documents that predate the windows field —
        // $size on a missing field errors inside $expr instead of not matching.
        $expr: {
          $lt: [{ $size: { $ifNull: ['$windows', []] } }, GMSCREEN_LIMITS.MAX_WINDOWS],
        },
      },
      {
        $push: { windows: newWindow },
        $set: { updatedAt: new Date() },
      }
    );

    if (pushResult.modifiedCount > 0) {
      // Re-fetch just the pushed sub-doc so we can return its Mongoose-assigned _id.
      const refetched = (await GMScreen.findOne(
        { _id: data.screenId, campaignId: data.campaignId },
        { windows: { $elemMatch: { collection: data.collection, documentId: data.documentId } } }
      ).lean()) as {
        windows?: Array<{
          _id: unknown;
          collection?: string;
          documentId: unknown;
          state?: string;
          x?: number | null;
          y?: number | null;
          width?: number | null;
          height?: number | null;
          zIndex?: number;
        }>;
      } | null;
      const created = refetched?.windows?.[0];
      if (!created) throw new Error('Window not found after creation');

      serverCaptureEvent(sessionUserId, 'gmscreen_window_opened', {
        campaign_id: data.campaignId,
        screen_id: data.screenId,
        window_id: String(created._id),
      });

      return { success: true, window: serializeWindow(created), existed: false };
    }

    // The filter didn't match: either another concurrent call created a
    // window for this ref first (dedupe loss), or a concurrent open of a
    // *different* ref filled the last cap slot ($expr loss), or the screen
    // was deleted. Re-fetch canonical state to tell these apart: ref present
    // → focus the winner; ref absent at cap → cap error; otherwise not found.
    const refreshed = await GMScreen.findOne({
      _id: data.screenId,
      campaignId: data.campaignId,
    });
    if (!refreshed) throw new Error('Screen not found');
    if (!refreshed.windows) refreshed.windows = [] as unknown as typeof refreshed.windows;
    const race = refreshed.windows.find(
      (w: { collection?: string; documentId?: unknown }) =>
        w.collection === data.collection && String(w.documentId) === data.documentId
    );
    if (!race) {
      if (refreshed.windows.length >= GMSCREEN_LIMITS.MAX_WINDOWS) {
        throw new Error(`A screen cannot have more than ${GMSCREEN_LIMITS.MAX_WINDOWS} windows`);
      }
      throw new Error('Screen not found');
    }

    await focusWindowAndSave(refreshed, refreshed.windows, race);

    serverCaptureEvent(sessionUserId, 'gmscreen_window_focused', {
      campaign_id: data.campaignId,
      screen_id: data.screenId,
      window_id: String(race._id),
    });

    return { success: true, window: serializeWindow(race), existed: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'openWindow',
      screenId: data.screenId,
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// updateWindow — batch-update layout/state fields on a single window
// ---------------------------------------------------------------------------

/**
 * Accepts any subset of `{ x, y, width, height, zIndex, state }`.
 * Only provided fields are persisted — the rest stay untouched.
 * This lets the client debounce drag/resize and send one update.
 */

export { updateWindowSchema };

export const updateWindow = async ({ data }: { data: z.infer<typeof updateWindowSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    // Build $set for only the fields that were provided
    const setFields: Record<string, unknown> = { updatedAt: new Date() };
    if (data.x !== undefined) setFields['windows.$.x'] = data.x;
    if (data.y !== undefined) setFields['windows.$.y'] = data.y;
    if (data.width !== undefined) setFields['windows.$.width'] = data.width;
    if (data.height !== undefined) setFields['windows.$.height'] = data.height;
    if (data.zIndex !== undefined) setFields['windows.$.zIndex'] = data.zIndex;
    if (data.state !== undefined) setFields['windows.$.state'] = data.state;

    const result = await GMScreen.updateOne(
      {
        _id: data.screenId,
        campaignId: data.campaignId,
        'windows._id': data.windowId,
      },
      { $set: setFields }
    );

    if (result.matchedCount === 0) {
      // Distinguish screen-not-found from window-not-found
      const screenExists = await GMScreen.countDocuments({
        _id: data.screenId,
        campaignId: data.campaignId,
      });
      if (screenExists === 0) {
        throw new Error('Screen not found');
      }
      throw new Error('Window not found');
    }

    // Fetch the updated window to return
    const screen = (await GMScreen.findOne(
      { _id: data.screenId, campaignId: data.campaignId },
      { windows: { $elemMatch: { _id: data.windowId } } }
    ).lean()) as {
      windows?: Array<{
        _id: unknown;
        collection?: string;
        documentId: unknown;
        state?: string;
        x?: number | null;
        y?: number | null;
        width?: number | null;
        height?: number | null;
        zIndex?: number;
      }>;
    } | null;

    const updated = screen?.windows?.[0];
    if (!updated) throw new Error('Window not found after update');

    return { success: true, window: serializeWindow(updated) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'updateWindow',
      campaignId: data.campaignId,
      screenId: data.screenId,
      windowId: data.windowId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// closeWindow — remove a window from a screen
// ---------------------------------------------------------------------------

export { closeWindowSchema };

export const closeWindow = async ({ data }: { data: z.infer<typeof closeWindowSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    // Include window ID in the filter so the update is a true no-op
    // (no updatedAt churn, no analytics) when the window isn't present.
    const result = await GMScreen.updateOne(
      {
        _id: data.screenId,
        campaignId: data.campaignId,
        'windows._id': data.windowId,
      },
      {
        $pull: { windows: { _id: data.windowId } },
        $set: { updatedAt: new Date() },
      }
    );

    if (result.matchedCount === 0) {
      // Distinguish screen-not-found from window-not-found
      const screenExists = await GMScreen.countDocuments({
        _id: data.screenId,
        campaignId: data.campaignId,
      });
      if (screenExists === 0) {
        throw new Error('Screen not found');
      }
      // Window wasn't present — true no-op
      return { success: true };
    }

    serverCaptureEvent(sessionUserId, 'gmscreen_window_closed', {
      campaign_id: data.campaignId,
      screen_id: data.screenId,
      window_id: data.windowId,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'closeWindow',
      campaignId: data.campaignId,
      screenId: data.screenId,
      windowId: data.windowId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// createStack — add a named stack to a screen
// ---------------------------------------------------------------------------

export { createStackSchema };

export const createStack = async ({ data }: { data: z.infer<typeof createStackSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    const screen = await GMScreen.findOne({
      _id: data.screenId,
      campaignId: data.campaignId,
    });
    if (!screen) throw new Error('Screen not found');

    if (!screen.stacks) {
      // Legacy screens may lack the field; `[]` alone infers as never[].
      screen.stacks = [] as unknown as typeof screen.stacks;
    }

    if (screen.stacks.length >= GMSCREEN_LIMITS.MAX_STACKS) {
      throw new Error(`A screen cannot have more than ${GMSCREEN_LIMITS.MAX_STACKS} stacks`);
    }

    screen.stacks.push({
      name: data.name.trim(),
      x: null,
      y: null,
      items: [],
    });
    screen.updatedAt = new Date();
    await screen.save();

    const created = screen.stacks[screen.stacks.length - 1];

    serverCaptureEvent(sessionUserId, 'gmscreen_stack_created', {
      campaign_id: data.campaignId,
      screen_id: data.screenId,
      stack_id: String(created._id),
    });

    return { success: true, stack: serializeStack(created) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'createStack',
      screenId: data.screenId,
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// renameStack — rename a stack on a screen
// ---------------------------------------------------------------------------

export { renameStackSchema };

export const renameStack = async ({ data }: { data: z.infer<typeof renameStackSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    const result = await GMScreen.updateOne(
      {
        _id: data.screenId,
        campaignId: data.campaignId,
        'stacks._id': data.stackId,
      },
      {
        $set: {
          'stacks.$.name': data.name.trim(),
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      const screenExists = await GMScreen.countDocuments({
        _id: data.screenId,
        campaignId: data.campaignId,
      });
      if (screenExists === 0) {
        throw new Error('Screen not found');
      }
      throw new Error('Stack not found');
    }

    serverCaptureEvent(sessionUserId, 'gmscreen_stack_renamed', {
      campaign_id: data.campaignId,
      screen_id: data.screenId,
      stack_id: data.stackId,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'renameStack',
      screenId: data.screenId,
      campaignId: data.campaignId,
      stackId: data.stackId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// moveStack — update a stack's x/y position
// ---------------------------------------------------------------------------

export { moveStackSchema };

export const moveStack = async ({ data }: { data: z.infer<typeof moveStackSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    const result = await GMScreen.updateOne(
      {
        _id: data.screenId,
        campaignId: data.campaignId,
        'stacks._id': data.stackId,
      },
      {
        $set: {
          'stacks.$.x': data.x,
          'stacks.$.y': data.y,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      const screenExists = await GMScreen.countDocuments({
        _id: data.screenId,
        campaignId: data.campaignId,
      });
      if (screenExists === 0) {
        throw new Error('Screen not found');
      }
      throw new Error('Stack not found');
    }

    serverCaptureEvent(sessionUserId, 'gmscreen_stack_moved', {
      campaign_id: data.campaignId,
      screen_id: data.screenId,
      stack_id: data.stackId,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'moveStack',
      screenId: data.screenId,
      campaignId: data.campaignId,
      stackId: data.stackId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// deleteStack — remove a stack from a screen
// ---------------------------------------------------------------------------

export { deleteStackSchema };

export const deleteStack = async ({ data }: { data: z.infer<typeof deleteStackSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    const result = await GMScreen.updateOne(
      {
        _id: data.screenId,
        campaignId: data.campaignId,
        'stacks._id': data.stackId,
      },
      {
        $pull: { stacks: { _id: data.stackId } },
        $set: { updatedAt: new Date() },
      }
    );

    if (result.matchedCount === 0) {
      const screenExists = await GMScreen.countDocuments({
        _id: data.screenId,
        campaignId: data.campaignId,
      });
      if (screenExists === 0) {
        throw new Error('Screen not found');
      }
      // Stack wasn't present — true no-op
      return { success: true };
    }

    serverCaptureEvent(sessionUserId, 'gmscreen_stack_deleted', {
      campaign_id: data.campaignId,
      screen_id: data.screenId,
      stack_id: data.stackId,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'deleteStack',
      screenId: data.screenId,
      campaignId: data.campaignId,
      stackId: data.stackId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// addStackItem — add a wiki ref to a stack
// ---------------------------------------------------------------------------

/**
 * **Duplicate rule:** A stack cannot contain two items with the same
 * `collection + documentId`.  If a duplicate is detected the call returns
 * `{ success: true, existed: true }` without modifying the stack. Enforced
 * atomically via a conditional `updateOne` filter — the same pattern
 * `openWindow`/`openTabletopWindow` use — so that two concurrent calls for
 * the same ref cannot both push an item, and two concurrent adds of
 * *different* refs cannot both land past the per-stack item cap.
 */

export { addStackItemSchema };

export const addStackItem = async ({ data }: { data: z.infer<typeof addStackItemSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    const screen = await GMScreen.findOne({
      _id: data.screenId,
      campaignId: data.campaignId,
    });
    if (!screen) throw new Error('Screen not found');

    if (!screen.stacks) {
      // Legacy screens may lack the field; `[]` alone infers as never[].
      screen.stacks = [] as unknown as typeof screen.stacks;
    }

    const stack = screen.stacks.find((s: { _id: unknown }) => String(s._id) === data.stackId);
    if (!stack) throw new Error('Stack not found');

    // Ensure items is a real Mongoose subdocument array (legacy stacks may lack it)
    if (!stack.items) {
      // Legacy stacks may lack the field; `[]` alone infers as never[].
      stack.items = [] as unknown as typeof stack.items;
    }

    // Duplicate check — fast-path only. Like openWindow's `existing` check,
    // this reads a possibly-stale snapshot; the authoritative dedupe/cap
    // enforcement is the conditional filter in the atomic update below.
    const duplicate = stack.items.find(
      (item: { collection?: string; documentId?: unknown }) =>
        item.collection === data.collection && String(item.documentId) === data.documentId
    );
    if (duplicate) {
      return { success: true, item: serializeStackItem(duplicate), existed: true };
    }

    if (stack.items.length >= GMSCREEN_LIMITS.MAX_STACK_ITEMS) {
      throw new Error(`A stack cannot contain more than ${GMSCREEN_LIMITS.MAX_STACK_ITEMS} items`);
    }

    const newItem = {
      collection: data.collection,
      documentId: data.documentId,
      label: data.label,
    };

    // Atomic conditional push — this is the fix for the check-then-write
    // race: two concurrent calls can both pass the `duplicate`/cap checks
    // above (both read the array before either write lands), but this
    // filter is re-evaluated by Mongo against the *current* document at
    // write time. The `stacks.$elemMatch` clause requires the target stack
    // to exist AND have no item for this ref yet (dedupe); the `$expr`
    // clause requires that specific stack's item count to be under the cap
    // — needed because schema validators don't run on updateOne pushes, so
    // without it two concurrent adds of *different* refs at length cap-1
    // would land cap+1 items in the same stack.
    const pushResult = await GMScreen.updateOne(
      {
        _id: data.screenId,
        campaignId: data.campaignId,
        stacks: {
          $elemMatch: {
            _id: data.stackId,
            items: {
              $not: {
                $elemMatch: { collection: data.collection, documentId: data.documentId },
              },
            },
          },
        },
        $expr: {
          $lt: [
            {
              $size: {
                $reduce: {
                  input: { $ifNull: ['$stacks', []] },
                  initialValue: [],
                  in: {
                    $cond: [
                      { $eq: [{ $toString: '$$this._id' }, data.stackId] },
                      { $ifNull: ['$$this.items', []] },
                      '$$value',
                    ],
                  },
                },
              },
            },
            GMSCREEN_LIMITS.MAX_STACK_ITEMS,
          ],
        },
      },
      {
        $push: { 'stacks.$[stack].items': newItem },
        $set: { updatedAt: new Date() },
      },
      {
        arrayFilters: [{ 'stack._id': data.stackId }],
      }
    );

    if (pushResult.modifiedCount > 0) {
      // Re-fetch the matched stack subdoc so we can find the pushed item's
      // Mongoose-assigned _id.
      const refetched = (await GMScreen.findOne(
        { _id: data.screenId, campaignId: data.campaignId, 'stacks._id': data.stackId },
        { 'stacks.$': 1 }
      ).lean()) as {
        stacks?: Array<{
          items?: Array<{ _id: unknown; collection?: string; documentId: unknown; label?: string }>;
        }>;
      } | null;
      const created = refetched?.stacks?.[0]?.items?.find(
        (item) => item.collection === data.collection && String(item.documentId) === data.documentId
      );
      if (!created) throw new Error('Stack item not found after creation');

      serverCaptureEvent(sessionUserId, 'gmscreen_stack_item_added', {
        campaign_id: data.campaignId,
        screen_id: data.screenId,
        stack_id: data.stackId,
        item_id: String(created._id),
      });

      return { success: true, item: serializeStackItem(created), existed: false };
    }

    // The filter didn't match: either another concurrent call added an item
    // for this ref first (dedupe loss), or a concurrent add of a *different*
    // ref filled the last cap slot in this stack ($expr loss), or the
    // screen/stack was deleted. Re-fetch canonical state to tell these apart:
    // ref present → return it as existed; ref absent at cap → cap error;
    // otherwise stack/screen not found.
    const refreshed = await GMScreen.findOne({
      _id: data.screenId,
      campaignId: data.campaignId,
    });
    if (!refreshed) throw new Error('Screen not found');
    if (!refreshed.stacks) refreshed.stacks = [] as unknown as typeof refreshed.stacks;
    const refreshedStack = refreshed.stacks.find(
      (s: { _id: unknown }) => String(s._id) === data.stackId
    );
    if (!refreshedStack) throw new Error('Stack not found');
    if (!refreshedStack.items) refreshedStack.items = [] as unknown as typeof refreshedStack.items;
    const race = refreshedStack.items.find(
      (item: { collection?: string; documentId?: unknown }) =>
        item.collection === data.collection && String(item.documentId) === data.documentId
    );
    if (!race) {
      if (refreshedStack.items.length >= GMSCREEN_LIMITS.MAX_STACK_ITEMS) {
        throw new Error(
          `A stack cannot contain more than ${GMSCREEN_LIMITS.MAX_STACK_ITEMS} items`
        );
      }
      throw new Error('Stack not found');
    }

    serverCaptureEvent(sessionUserId, 'gmscreen_stack_item_added', {
      campaign_id: data.campaignId,
      screen_id: data.screenId,
      stack_id: data.stackId,
      item_id: String(race._id),
    });

    return { success: true, item: serializeStackItem(race), existed: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'addStackItem',
      screenId: data.screenId,
      campaignId: data.campaignId,
      stackId: data.stackId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// removeStackItem — remove an item from a stack
// ---------------------------------------------------------------------------

export { removeStackItemSchema };

export const removeStackItem = async ({
  data,
}: {
  data: z.infer<typeof removeStackItemSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const gm = await requireCampaignGM(data.campaignId);
    sessionUserId = gm.sessionUserId;

    const screen = await GMScreen.findOne({
      _id: data.screenId,
      campaignId: data.campaignId,
    });
    if (!screen) throw new Error('Screen not found');

    if (!screen.stacks) {
      // Legacy screens may lack the field; `[]` alone infers as never[].
      screen.stacks = [] as unknown as typeof screen.stacks;
    }

    const stack = screen.stacks.find((s: { _id: unknown }) => String(s._id) === data.stackId);
    if (!stack) throw new Error('Stack not found');

    // Ensure items is a real Mongoose subdocument array (legacy stacks may lack it)
    if (!stack.items) {
      // Legacy stacks may lack the field; `[]` alone infers as never[].
      stack.items = [] as unknown as typeof stack.items;
    }

    const index = stack.items.findIndex(
      (item: { _id: unknown }) => String(item._id) === data.itemId
    );

    if (index === -1) {
      // Item not present — true no-op
      return { success: true };
    }

    stack.items.splice(index, 1);
    screen.updatedAt = new Date();
    await screen.save();

    serverCaptureEvent(sessionUserId, 'gmscreen_stack_item_removed', {
      campaign_id: data.campaignId,
      screen_id: data.screenId,
      stack_id: data.stackId,
      item_id: data.itemId,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'removeStackItem',
      screenId: data.screenId,
      campaignId: data.campaignId,
      stackId: data.stackId,
      itemId: data.itemId,
    });
    throw e;
  }
};

// removeDocumentRefsFromScreens moved to ./gmscreens-helpers.ts to avoid
// pulling Mongoose models into the client bundle when notes.ts imports it.
