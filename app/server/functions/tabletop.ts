import { createServerFn } from '@tanstack/react-start';
import mongoose from 'mongoose';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { TabletopScreen, TABLETOP_LIMITS } from '../db/models/TabletopScreen';
import { TabletopPlayerState } from '../db/models/TabletopPlayerState';
import { serverCaptureException, serverCaptureEvent } from '../utils/posthog';
import { hydrateRefs } from './tabletop-hydration';
import type {
  TabletopScreenData,
  TabletopScreenDetailData,
  WindowData,
  TabletopPlayerStateData,
  ViewportData,
  WindowOverrideData,
  TabletopMode,
  GridStyle,
} from '~/types/tabletop';
import { TABLETOP_MODES, GRID_STYLES } from '~/types/tabletop';
import {
  listTabletopScreensSchema,
  createTabletopScreenSchema,
  getTabletopScreenSchema,
  renameTabletopScreenSchema,
  deleteTabletopScreenSchema,
  updateTabletopScreenSettingsSchema,
  openTabletopWindowSchema,
  closeTabletopWindowSchema,
  getPlayerStateSchema,
  updatePlayerStateSchema,
} from '~/types/schemas/tabletop';

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function serializeTabletopScreen(doc: {
  _id: unknown;
  campaignId: unknown;
  name?: string;
  tabOrder?: number;
  mode?: string;
  gridStyle?: string;
  gridSize?: number;
  gridVisible?: boolean;
  gridScale?: number;
  createdBy: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}): TabletopScreenData {
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    name: doc.name ?? '',
    tabOrder: doc.tabOrder ?? 0,
    mode: TABLETOP_MODES.includes(doc.mode as TabletopMode) ? (doc.mode as TabletopMode) : 'grid',
    gridStyle: GRID_STYLES.includes(doc.gridStyle as GridStyle)
      ? (doc.gridStyle as GridStyle)
      : 'dark',
    gridSize: doc.gridSize ?? 50,
    gridVisible: doc.gridVisible ?? true,
    gridScale: doc.gridScale ?? 5,
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
  const WINDOW_STATES = ['open', 'minimized', 'hidden'] as const;
  type WS = (typeof WINDOW_STATES)[number];
  return {
    id: String(w._id),
    collection: w.collection ?? '',
    documentId: String(w.documentId),
    state: WINDOW_STATES.includes(w.state as WS) ? (w.state as WS) : 'open',
    x: w.x ?? null,
    y: w.y ?? null,
    width: w.width ?? null,
    height: w.height ?? null,
    zIndex: w.zIndex ?? 0,
  };
}

function serializePlayerState(doc: {
  _id: unknown;
  campaignId: unknown;
  userId: unknown;
  activeScreenId?: unknown;
  viewports?: Array<{
    screenId: unknown;
    zoom?: number;
    panX?: number;
    panY?: number;
  }>;
  windowOverrides?: Array<{
    windowId?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    state?: string;
  }>;
}): TabletopPlayerStateData {
  const WINDOW_STATES = ['open', 'minimized', 'hidden'] as const;
  type WS = (typeof WINDOW_STATES)[number];
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    userId: String(doc.userId),
    activeScreenId: doc.activeScreenId ? String(doc.activeScreenId) : null,
    viewports: (doc.viewports ?? []).map(
      (v): ViewportData => ({
        screenId: String(v.screenId),
        zoom: v.zoom ?? 1,
        panX: v.panX ?? 0,
        panY: v.panY ?? 0,
      })
    ),
    windowOverrides: (doc.windowOverrides ?? []).map(
      (wo): WindowOverrideData => ({
        windowId: wo.windowId ?? '',
        x: wo.x ?? 0,
        y: wo.y ?? 0,
        width: wo.width ?? 0,
        height: wo.height ?? 0,
        state: WINDOW_STATES.includes(wo.state as WS) ? (wo.state as WS) : 'open',
      })
    ),
  };
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

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
// Auth helpers
// ---------------------------------------------------------------------------

async function requireCampaignMember(
  campaignId: string
): Promise<{ userId: string; role: 'gm' | 'player'; sessionUserId: string }> {
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
    members.some(
      (m: { userId: unknown; role?: string }) => String(m.userId) === userId && m.role === 'gm'
    );

  if (isGM) return { userId, role: 'gm', sessionUserId: user.id };

  // Player access: user is in the members list
  const isMember = members.some((m: { userId: unknown }) => String(m.userId) === userId);
  if (isMember) return { userId, role: 'player', sessionUserId: user.id };

  throw new Error('Forbidden');
}

async function requireCampaignGM(
  campaignId: string
): Promise<{ userId: string; sessionUserId: string }> {
  const result = await requireCampaignMember(campaignId);
  if (result.role !== 'gm') throw new Error('Forbidden');
  return { userId: result.userId, sessionUserId: result.sessionUserId };
}

// ---------------------------------------------------------------------------
// listTabletopScreens
// ---------------------------------------------------------------------------

export { listTabletopScreensSchema };

export const listTabletopScreens = createServerFn({ method: 'GET' })
  .inputValidator(listTabletopScreensSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const docs = await TabletopScreen.find(
        { campaignId: data.campaignId },
        '_id campaignId name tabOrder mode gridStyle gridSize gridVisible gridScale createdBy createdAt updatedAt'
      )
        .sort({ tabOrder: 1 })
        .lean();

      return (
        docs as Array<{
          _id: unknown;
          campaignId: unknown;
          name?: string;
          tabOrder?: number;
          mode?: string;
          gridStyle?: string;
          gridSize?: number;
          gridVisible?: boolean;
          gridScale?: number;
          createdBy: unknown;
          createdAt?: Date;
          updatedAt?: Date;
        }>
      ).map(serializeTabletopScreen);
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'listTabletopScreens',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// createTabletopScreen
// ---------------------------------------------------------------------------

export { createTabletopScreenSchema };

const MAX_TAB_ORDER_RETRIES = 3;

export const createTabletopScreen = createServerFn({ method: 'POST' })
  .inputValidator(createTabletopScreenSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;

      let doc: {
        _id: unknown;
        campaignId: unknown;
        name?: string;
        tabOrder?: number;
        mode?: string;
        gridStyle?: string;
        gridSize?: number;
        gridVisible?: boolean;
        gridScale?: number;
        createdBy: unknown;
        createdAt?: Date;
        updatedAt?: Date;
      };

      for (let attempt = 0; attempt < MAX_TAB_ORDER_RETRIES; attempt++) {
        const mongoSession = await mongoose.startSession();
        try {
          doc = (await mongoSession.withTransaction(async () => {
            const last = (await TabletopScreen.findOne({ campaignId: data.campaignId })
              .sort({ tabOrder: -1 })
              .select('tabOrder')
              .session(mongoSession)
              .lean()) as { tabOrder?: number } | null;

            const nextOrder = (last?.tabOrder ?? -1) + 1;

            const now = new Date();
            const createdDocs = (await TabletopScreen.create(
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

        serverCaptureEvent(sessionUserId, 'tabletop_screen_created', {
          campaign_id: data.campaignId,
          screen_id: String(doc._id),
        });

        return { success: true, screen: serializeTabletopScreen(doc) };
      }

      const exhaustionError = new Error('Failed to allocate tabOrder after retries');
      serverCaptureException(exhaustionError, sessionUserId, {
        action: 'createTabletopScreen',
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
      if (!(e instanceof AlreadyReportedError)) {
        serverCaptureException(e, sessionUserId, {
          action: 'createTabletopScreen',
          campaignId: data.campaignId,
        });
      }
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// getTabletopScreen — fetch a single screen with hydrated windows
// ---------------------------------------------------------------------------

export { getTabletopScreenSchema };

export const getTabletopScreen = createServerFn({ method: 'GET' })
  .inputValidator(getTabletopScreenSchema)
  .handler(async ({ data }): Promise<TabletopScreenDetailData> => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const doc = (await TabletopScreen.findOne({
        _id: data.id,
        campaignId: data.campaignId,
      }).lean()) as {
        _id: unknown;
        campaignId: unknown;
        name?: string;
        tabOrder?: number;
        mode?: string;
        gridStyle?: string;
        gridSize?: number;
        gridVisible?: boolean;
        gridScale?: number;
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
      } | null;

      if (!doc) throw new Error('Screen not found');

      const windows = (doc.windows ?? []).map(serializeWindow);

      // Collect all refs from windows
      const refs: Array<{ collection: string; documentId: string }> = [];
      for (const w of windows) {
        refs.push({ collection: w.collection, documentId: w.documentId });
      }

      const hydrated = await hydrateRefs(refs, data.campaignId);

      return {
        ...serializeTabletopScreen(doc),
        windows,
        hydrated,
      };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'getTabletopScreen',
        screenId: data.id,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// renameTabletopScreen
// ---------------------------------------------------------------------------

export { renameTabletopScreenSchema };

export const renameTabletopScreen = createServerFn({ method: 'POST' })
  .inputValidator(renameTabletopScreenSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;

      const screen = await TabletopScreen.findById(data.id);
      if (!screen) throw new Error('Screen not found');
      if (String(screen.campaignId) !== data.campaignId) throw new Error('Forbidden');

      screen.name = data.name.trim();
      screen.updatedAt = new Date();
      await screen.save();

      serverCaptureEvent(sessionUserId, 'tabletop_screen_renamed', {
        campaign_id: data.campaignId,
        screen_id: data.id,
      });

      return { success: true, screen: serializeTabletopScreen(screen) };
    } catch (e) {
      if ((e as { code?: number })?.code === 11000) {
        throw new Error('A screen with that name already exists in this campaign');
      }
      serverCaptureException(e, sessionUserId, {
        action: 'renameTabletopScreen',
        screenId: data.id,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// deleteTabletopScreen
// ---------------------------------------------------------------------------

export { deleteTabletopScreenSchema };

export const deleteTabletopScreen = createServerFn({ method: 'POST' })
  .inputValidator(deleteTabletopScreenSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;

      // Use a transaction so the count-check + delete is atomic
      const mongoSession = await mongoose.startSession();
      let deletedTabOrder: number;
      try {
        deletedTabOrder = await mongoSession.withTransaction(async () => {
          const screen = await TabletopScreen.findOne({
            _id: data.id,
            campaignId: data.campaignId,
          }).session(mongoSession);
          if (!screen) throw new Error('Screen not found');

          const count = await TabletopScreen.countDocuments({
            campaignId: data.campaignId,
          }).session(mongoSession);
          if (count <= 1) throw new Error('Cannot delete the last screen');

          const tabOrder = typeof screen.tabOrder === 'number' ? screen.tabOrder : 0;
          await TabletopScreen.deleteOne({ _id: data.id, campaignId: data.campaignId }).session(
            mongoSession
          );

          return tabOrder;
        });
      } finally {
        await mongoSession.endSession();
      }

      // Return the remaining screens so the client can resolve the next active screen
      const remaining = await TabletopScreen.find(
        { campaignId: data.campaignId },
        '_id campaignId name tabOrder mode gridStyle gridSize gridVisible gridScale createdBy createdAt updatedAt'
      )
        .sort({ tabOrder: 1 })
        .lean();

      serverCaptureEvent(sessionUserId, 'tabletop_screen_deleted', {
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
            mode?: string;
            gridStyle?: string;
            gridSize?: number;
            gridVisible?: boolean;
            gridScale?: number;
            createdBy: unknown;
            createdAt?: Date;
            updatedAt?: Date;
          }>
        ).map(serializeTabletopScreen),
      };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'deleteTabletopScreen',
        screenId: data.id,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// updateTabletopScreenSettings — partial update of grid/mode settings
// ---------------------------------------------------------------------------

export { updateTabletopScreenSettingsSchema };

export const updateTabletopScreenSettings = createServerFn({ method: 'POST' })
  .inputValidator(updateTabletopScreenSettingsSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;

      // Build $set for only the fields that were provided
      const setFields: Record<string, unknown> = { updatedAt: new Date() };
      if (data.gridStyle !== undefined) setFields.gridStyle = data.gridStyle;
      if (data.gridSize !== undefined) setFields.gridSize = data.gridSize;
      if (data.gridVisible !== undefined) setFields.gridVisible = data.gridVisible;
      if (data.gridScale !== undefined) setFields.gridScale = data.gridScale;
      if (data.mode !== undefined) setFields.mode = data.mode;

      const result = await TabletopScreen.updateOne(
        { _id: data.id, campaignId: data.campaignId },
        { $set: setFields }
      );

      if (result.matchedCount === 0) {
        throw new Error('Screen not found');
      }

      serverCaptureEvent(sessionUserId, 'tabletop_screen_settings_updated', {
        campaign_id: data.campaignId,
        screen_id: data.id,
      });

      return { success: true };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'updateTabletopScreenSettings',
        screenId: data.id,
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// openTabletopWindow — open a wiki ref as a window (or focus existing dup)
// ---------------------------------------------------------------------------

/**
 * **Duplicate rule:** If a window with the same `collection + documentId` already
 * exists on this screen, the existing window is focused (state -> 'open', zIndex
 * bumped to max + 1) and returned with `existed: true`.  No second window is
 * created for the same ref.
 */

export { openTabletopWindowSchema };

export const openTabletopWindow = createServerFn({ method: 'POST' })
  .inputValidator(openTabletopWindowSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;

      const screen = await TabletopScreen.findOne({
        _id: data.screenId,
        campaignId: data.campaignId,
      });
      if (!screen) throw new Error('Screen not found');

      if (!screen.windows) {
        screen.windows = [];
      }
      const windows = screen.windows;

      // Check for existing window with same ref
      const existing = windows.find(
        (w: { collection?: string; documentId?: unknown }) =>
          w.collection === data.collection && String(w.documentId) === data.documentId
      );

      if (existing) {
        // Focus existing: set state to open, bump zIndex
        const maxZ = windows.reduce(
          (max: number, w: { zIndex?: number }) => Math.max(max, w.zIndex ?? 0),
          0
        );
        existing.state = 'open';
        existing.zIndex = maxZ + 1;
        screen.updatedAt = new Date();
        await screen.save();

        serverCaptureEvent(sessionUserId, 'tabletop_window_focused', {
          campaign_id: data.campaignId,
          screen_id: data.screenId,
          window_id: String(existing._id),
        });

        return { success: true, window: serializeWindow(existing), existed: true };
      }

      // Enforce cap
      if (windows.length >= TABLETOP_LIMITS.MAX_WINDOWS) {
        throw new Error(`A screen cannot have more than ${TABLETOP_LIMITS.MAX_WINDOWS} windows`);
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
      windows.push(newWindow);
      screen.updatedAt = new Date();
      await screen.save();

      // The pushed sub-doc now has an _id assigned by Mongoose
      const created = windows[windows.length - 1];

      serverCaptureEvent(sessionUserId, 'tabletop_window_opened', {
        campaign_id: data.campaignId,
        screen_id: data.screenId,
        window_id: String(created._id),
      });

      return { success: true, window: serializeWindow(created), existed: false };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'openTabletopWindow',
        screenId: data.screenId,
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// closeTabletopWindow — remove a window from a screen
// ---------------------------------------------------------------------------

export { closeTabletopWindowSchema };

export const closeTabletopWindow = createServerFn({ method: 'POST' })
  .inputValidator(closeTabletopWindowSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;

      const result = await TabletopScreen.updateOne(
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
        const screenExists = await TabletopScreen.countDocuments({
          _id: data.screenId,
          campaignId: data.campaignId,
        });
        if (screenExists === 0) {
          throw new Error('Screen not found');
        }
        // Window wasn't present — true no-op
        return { success: true };
      }

      serverCaptureEvent(sessionUserId, 'tabletop_window_closed', {
        campaign_id: data.campaignId,
        screen_id: data.screenId,
        window_id: data.windowId,
      });

      return { success: true };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'closeTabletopWindow',
        campaignId: data.campaignId,
        screenId: data.screenId,
        windowId: data.windowId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// getPlayerState — fetch the caller's player state for a campaign
// ---------------------------------------------------------------------------

export { getPlayerStateSchema };

export const getPlayerState = createServerFn({ method: 'GET' })
  .inputValidator(getPlayerStateSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const doc = (await TabletopPlayerState.findOne({
        campaignId: data.campaignId,
        userId: member.userId,
      }).lean()) as {
        _id: unknown;
        campaignId: unknown;
        userId: unknown;
        activeScreenId?: unknown;
        viewports?: Array<{
          screenId: unknown;
          zoom?: number;
          panX?: number;
          panY?: number;
        }>;
        windowOverrides?: Array<{
          windowId?: string;
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          state?: string;
        }>;
      } | null;

      if (!doc) return null;

      return serializePlayerState(doc);
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'getPlayerState',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// updatePlayerState — upsert the caller's player state
// ---------------------------------------------------------------------------

export { updatePlayerStateSchema };

export const updatePlayerState = createServerFn({ method: 'POST' })
  .inputValidator(updatePlayerStateSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const setFields: Record<string, unknown> = {};
      if (data.activeScreenId !== undefined) {
        setFields.activeScreenId = data.activeScreenId;
      }

      // Viewport upsert: replace the matching screenId entry or push new
      if (data.viewport) {
        const existing = await TabletopPlayerState.findOne({
          campaignId: data.campaignId,
          userId: member.userId,
          'viewports.screenId': data.viewport.screenId,
        });

        if (existing) {
          // Update existing viewport entry
          await TabletopPlayerState.updateOne(
            {
              campaignId: data.campaignId,
              userId: member.userId,
              'viewports.screenId': data.viewport.screenId,
            },
            {
              $set: {
                'viewports.$.zoom': data.viewport.zoom,
                'viewports.$.panX': data.viewport.panX,
                'viewports.$.panY': data.viewport.panY,
                ...setFields,
              },
            },
            { upsert: true }
          );
        } else {
          // Push new viewport entry (or create the whole doc)
          await TabletopPlayerState.updateOne(
            {
              campaignId: data.campaignId,
              userId: member.userId,
            },
            {
              $push: {
                viewports: {
                  screenId: data.viewport.screenId,
                  zoom: data.viewport.zoom,
                  panX: data.viewport.panX,
                  panY: data.viewport.panY,
                },
              },
              $set: setFields,
              $setOnInsert: {
                campaignId: data.campaignId,
                userId: member.userId,
              },
            },
            { upsert: true }
          );
        }
      } else if (data.windowOverride) {
        // Window override upsert: replace existing or push new
        const existing = await TabletopPlayerState.findOne({
          campaignId: data.campaignId,
          userId: member.userId,
          'windowOverrides.windowId': data.windowOverride.windowId,
        });

        if (existing) {
          await TabletopPlayerState.updateOne(
            {
              campaignId: data.campaignId,
              userId: member.userId,
              'windowOverrides.windowId': data.windowOverride.windowId,
            },
            {
              $set: {
                'windowOverrides.$.x': data.windowOverride.x,
                'windowOverrides.$.y': data.windowOverride.y,
                'windowOverrides.$.width': data.windowOverride.width,
                'windowOverrides.$.height': data.windowOverride.height,
                'windowOverrides.$.state': data.windowOverride.state,
                ...setFields,
              },
            }
          );
        } else {
          await TabletopPlayerState.updateOne(
            {
              campaignId: data.campaignId,
              userId: member.userId,
            },
            {
              $push: {
                windowOverrides: {
                  windowId: data.windowOverride.windowId,
                  x: data.windowOverride.x,
                  y: data.windowOverride.y,
                  width: data.windowOverride.width,
                  height: data.windowOverride.height,
                  state: data.windowOverride.state,
                },
              },
              $set: setFields,
              $setOnInsert: {
                campaignId: data.campaignId,
                userId: member.userId,
              },
            },
            { upsert: true }
          );
        }
      } else if (Object.keys(setFields).length > 0) {
        // Only activeScreenId update
        await TabletopPlayerState.updateOne(
          {
            campaignId: data.campaignId,
            userId: member.userId,
          },
          {
            $set: setFields,
            $setOnInsert: {
              campaignId: data.campaignId,
              userId: member.userId,
            },
          },
          { upsert: true }
        );
      }

      // Fetch and return the updated state
      const doc = (await TabletopPlayerState.findOne({
        campaignId: data.campaignId,
        userId: member.userId,
      }).lean()) as {
        _id: unknown;
        campaignId: unknown;
        userId: unknown;
        activeScreenId?: unknown;
        viewports?: Array<{
          screenId: unknown;
          zoom?: number;
          panX?: number;
          panY?: number;
        }>;
        windowOverrides?: Array<{
          windowId?: string;
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          state?: string;
        }>;
      } | null;

      return { success: true, state: doc ? serializePlayerState(doc) : null };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'updatePlayerState',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });
