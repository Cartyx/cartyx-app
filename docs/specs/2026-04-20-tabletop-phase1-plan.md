# Tabletop Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working tabletop with tabs, default grid (Konva), floating windows from wiki, real-time sync via PartyKit, persistent state, session event logging, ping tool, and focus-all.

**Architecture:** The Tabletop tab reuses existing patterns (GMScreen CRUD, FloatingWindowManager, PartyKit session hooks) while introducing Konva for grid rendering. A new `TabletopScreen` model stores per-tab state. `TabletopPlayerState` stores per-player viewport. `SessionEvent` logs timeline events. All real-time sync goes through a new PartyKit `tabletop` party.

**Tech Stack:** React 19, react-konva, TanStack React Query, TanStack React Start (server functions), MongoDB/Mongoose, PartyKit, Zod, Vitest, Playwright

---

## File Structure

### New Files

| Path                                                       | Responsibility                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `app/types/tabletop.ts`                                    | TypeScript types for tabletop data (TabletopScreenData, TabletopPlayerStateData, SessionEventData) |
| `app/types/schemas/tabletop.ts`                            | Zod validation schemas for tabletop server functions                                               |
| `app/server/db/models/TabletopScreen.ts`                   | Mongoose model for tabletop screens                                                                |
| `app/server/db/models/TabletopPlayerState.ts`              | Mongoose model for per-player state                                                                |
| `app/server/db/models/SessionEvent.ts`                     | Mongoose model for session timeline events                                                         |
| `app/server/functions/tabletop.ts`                         | Server functions (CRUD, windows, player state)                                                     |
| `app/server/functions/session-events.ts`                   | Server functions for session event logging                                                         |
| `app/hooks/useTabletopScreens.ts`                          | React Query hooks for tabletop CRUD                                                                |
| `app/hooks/useTabletopPlayerState.ts`                      | React Query hook for player viewport state                                                         |
| `app/hooks/useTabletopParty.ts`                            | PartyKit hook for tabletop real-time sync                                                          |
| `app/components/mainview/tabletop/TabletopView.tsx`        | Main tabletop container (replaces placeholder)                                                     |
| `app/components/mainview/tabletop/TabletopTabBar.tsx`      | Tab bar with notification badges, add/focus buttons                                                |
| `app/components/mainview/tabletop/TabletopCanvas.tsx`      | Canvas container (switches renderer by mode)                                                       |
| `app/components/mainview/tabletop/DefaultGrid.tsx`         | Konva-based default grid with style presets                                                        |
| `app/components/mainview/tabletop/PingOverlay.tsx`         | Konva layer for ephemeral ping animations                                                          |
| `app/components/mainview/tabletop/TabletopToolbar.tsx`     | Minimal toolbar (ping only for Phase 1)                                                            |
| `party/tabletop.ts`                                        | PartyKit server for tabletop room                                                                  |
| `tests/server/functions/tabletop.test.ts`                  | Unit tests for tabletop server functions                                                           |
| `tests/server/functions/session-events.test.ts`            | Unit tests for session event server functions                                                      |
| `tests/components/mainview/tabletop/TabletopView.test.tsx` | Component tests                                                                                    |
| `tests/components/mainview/tabletop/DefaultGrid.test.tsx`  | Grid rendering tests                                                                               |
| `e2e/tabletop/tabletop-tabs.spec.ts`                       | Playwright E2E for tab management                                                                  |
| `e2e/tabletop/tabletop-windows.spec.ts`                    | Playwright E2E for floating windows                                                                |
| `e2e/tabletop/tabletop-sync.spec.ts`                       | Playwright E2E for real-time sync                                                                  |
| `e2e/tabletop/tabletop-ping.spec.ts`                       | Playwright E2E for ping tool                                                                       |
| `e2e/fixtures/tabletop-fixtures.ts`                        | Test fixtures (seed data, auth helpers)                                                            |
| `playwright.config.ts`                                     | Playwright configuration                                                                           |

### Modified Files

| Path                                                             | Change                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------------- |
| `app/components/mainview/TabletopView.tsx`                       | Replace with import from `tabletop/TabletopView`            |
| `app/components/shared/TabBar.tsx`                               | Add optional `badge` prop to Tab interface                  |
| `app/utils/queryKeys.ts`                                         | Add `tabletop` key factory                                  |
| `app/components/wiki/shared/WikiItemActions.tsx` (or equivalent) | Add "Show on Tabletop" button                               |
| `package.json`                                                   | Add `react-konva`, `konva`, `@playwright/test` dependencies |

---

## Task 1: Install Dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install react-konva and konva**

```bash
npm install react-konva konva
```

- [ ] **Step 2: Install Playwright as dev dependency**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 3: Verify installation**

Run: `npx playwright --version`
Expected: Version number output (e.g., "1.59.1")

Run: `node -e "require('konva'); console.log('konva OK')"`
Expected: "konva OK"

- [ ] **Step 4: Create Playwright config**

Create `playwright.config.ts`:

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json playwright.config.ts
git commit -m "chore: add react-konva, konva, and playwright dependencies"
```

---

## Task 2: TypeScript Types & Zod Schemas

**Files:**

- Create: `app/types/tabletop.ts`
- Create: `app/types/schemas/tabletop.ts`
- Modify: `app/utils/queryKeys.ts`

- [ ] **Step 1: Create tabletop types**

Create `app/types/tabletop.ts`:

```typescript
export const GRID_STYLES = ['dark', 'parchment', 'hex', 'whiteboard'] as const;
export type GridStyle = (typeof GRID_STYLES)[number];

export const TABLETOP_MODES = ['grid', 'map', 'battlemap'] as const;
export type TabletopMode = (typeof TABLETOP_MODES)[number];

export const SESSION_EVENT_TYPES = [
  'reveal_document',
  'reveal_location',
  'map_change',
  'battle_start',
  'token_placed',
] as const;
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

export interface TabletopScreenData {
  id: string;
  campaignId: string;
  name: string;
  tabOrder: number;
  mode: TabletopMode;
  gridStyle: GridStyle;
  gridSize: number;
  gridVisible: boolean;
  gridScale: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TabletopScreenDetailData extends TabletopScreenData {
  windows: WindowData[];
  hydrated: Record<string, HydratedDocument>;
}

export interface WindowData {
  id: string;
  collection: string;
  documentId: string;
  state: 'open' | 'minimized' | 'hidden';
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  zIndex: number;
}

export interface HydratedDocument {
  id: string;
  collection: string;
  title: string;
  content: string;
  isPublic?: boolean;
  link?: string;
}

export interface TabletopPlayerStateData {
  id: string;
  campaignId: string;
  userId: string;
  activeScreenId: string | null;
  viewports: ViewportData[];
  windowOverrides: WindowOverrideData[];
}

export interface ViewportData {
  screenId: string;
  zoom: number;
  panX: number;
  panY: number;
}

export interface WindowOverrideData {
  windowId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  state: 'open' | 'minimized' | 'hidden';
}

export interface SessionEventData {
  id: string;
  campaignId: string;
  sessionId: string;
  timestamp: string;
  eventType: SessionEventType;
  documentId: string;
  collection: string;
  tabletopScreenId: string;
  triggeredBy: string;
  displayName: string;
}

// PartyKit message types for tabletop
export type TabletopMessage =
  | { type: 'window:show'; screenId: string; window: WindowData; displayName: string }
  | { type: 'window:close'; screenId: string; windowId: string }
  | { type: 'tab:create'; screen: TabletopScreenData }
  | { type: 'tab:rename'; screenId: string; name: string }
  | { type: 'tab:delete'; screenId: string }
  | { type: 'tab:focus-all'; screenId: string }
  | { type: 'tab:content-added'; screenId: string }
  | {
      type: 'ping';
      screenId: string;
      x: number;
      y: number;
      userId: string;
      userName: string;
      color: string;
    }
  | { type: 'grid:style-change'; screenId: string; gridStyle: GridStyle };
```

- [ ] **Step 2: Create Zod schemas**

Create `app/types/schemas/tabletop.ts`:

```typescript
import { z } from 'zod';
import { GRID_STYLES, TABLETOP_MODES, SESSION_EVENT_TYPES } from '~/types/tabletop';

// ---------------------------------------------------------------------------
// Screen CRUD
// ---------------------------------------------------------------------------

export const listTabletopScreensSchema = z.object({
  campaignId: z.string().trim().min(1),
});

export const createTabletopScreenSchema = z.object({
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Tab name is required'),
});

export const getTabletopScreenSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const renameTabletopScreenSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Tab name is required'),
});

export const deleteTabletopScreenSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const updateTabletopScreenSettingsSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  gridStyle: z.enum(GRID_STYLES).optional(),
  gridSize: z.number().min(20).max(200).optional(),
  gridVisible: z.boolean().optional(),
  gridScale: z.number().min(1).max(1000).optional(),
  mode: z.enum(TABLETOP_MODES).optional(),
});

// ---------------------------------------------------------------------------
// Windows (on tabletop screens)
// ---------------------------------------------------------------------------

const TABLETOP_COLLECTIONS: [string, ...string[]] = ['note', 'character', 'race', 'rule', 'player'];

export const openTabletopWindowSchema = z.object({
  screenId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  collection: z.enum(TABLETOP_COLLECTIONS),
  documentId: z.string().trim().min(1),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
});

export const closeTabletopWindowSchema = z.object({
  screenId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  windowId: z.string().trim().min(1),
});

// ---------------------------------------------------------------------------
// Player State
// ---------------------------------------------------------------------------

export const getPlayerStateSchema = z.object({
  campaignId: z.string().trim().min(1),
});

export const updatePlayerStateSchema = z.object({
  campaignId: z.string().trim().min(1),
  activeScreenId: z.string().nullable().optional(),
  viewport: z
    .object({
      screenId: z.string().trim().min(1),
      zoom: z.number(),
      panX: z.number(),
      panY: z.number(),
    })
    .optional(),
  windowOverride: z
    .object({
      windowId: z.string().trim().min(1),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      state: z.enum(['open', 'minimized', 'hidden']),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Session Events
// ---------------------------------------------------------------------------

export const createSessionEventSchema = z.object({
  campaignId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  eventType: z.enum(SESSION_EVENT_TYPES),
  documentId: z.string().trim().min(1),
  collection: z.string().trim().min(1),
  tabletopScreenId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
});

export const listSessionEventsSchema = z.object({
  campaignId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
});
```

- [ ] **Step 3: Add query keys for tabletop**

Add to `app/utils/queryKeys.ts`:

```typescript
  tabletop: {
    all: ['tabletop'] as const,
    list: (campaignId: string) => ['tabletop', 'list', campaignId] as const,
    detail: (campaignId: string, screenId: string) =>
      ['tabletop', 'detail', campaignId, screenId] as const,
    playerState: (campaignId: string) => ['tabletop', 'playerState', campaignId] as const,
  },
  sessionEvents: {
    all: ['sessionEvents'] as const,
    list: (campaignId: string, sessionId: string) =>
      ['sessionEvents', 'list', campaignId, sessionId] as const,
  },
```

- [ ] **Step 4: Commit**

```bash
git add app/types/tabletop.ts app/types/schemas/tabletop.ts app/utils/queryKeys.ts
git commit -m "feat(tabletop): add TypeScript types, Zod schemas, and query keys"
```

---

## Task 3: MongoDB Models

**Files:**

- Create: `app/server/db/models/TabletopScreen.ts`
- Create: `app/server/db/models/TabletopPlayerState.ts`
- Create: `app/server/db/models/SessionEvent.ts`

- [ ] **Step 1: Create TabletopScreen model**

Create `app/server/db/models/TabletopScreen.ts`:

```typescript
import mongoose from 'mongoose';
import { GRID_STYLES, TABLETOP_MODES } from '~/types/tabletop';

export const TABLETOP_LIMITS = {
  MAX_WINDOWS: 20,
} as const;

const windowSchema = new mongoose.Schema(
  {
    collection: { type: String, required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    state: {
      type: String,
      enum: ['open', 'minimized', 'hidden'],
      default: 'open',
    },
    x: { type: Number, default: null },
    y: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    zIndex: { type: Number, default: 0 },
  },
  { _id: true }
);

const tabletopScreenSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    name: { type: String, required: true },
    tabOrder: { type: Number, default: 0 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    mode: {
      type: String,
      enum: TABLETOP_MODES,
      default: 'grid',
    },
    gridStyle: {
      type: String,
      enum: GRID_STYLES,
      default: 'dark',
    },
    gridSize: { type: Number, default: 50 },
    gridVisible: { type: Boolean, default: true },
    gridScale: { type: Number, default: 5 },
    locationId: { type: mongoose.Schema.Types.ObjectId, default: null },
    battleMapImage: { type: String, default: null },
    windows: {
      type: [windowSchema],
      default: [],
      validate: {
        validator: (v: unknown) => Array.isArray(v) && v.length <= TABLETOP_LIMITS.MAX_WINDOWS,
        message: `A screen cannot contain more than ${TABLETOP_LIMITS.MAX_WINDOWS} windows.`,
      },
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'tabletopscreen' }
);

tabletopScreenSchema.index({ campaignId: 1, tabOrder: 1 }, { unique: true });
tabletopScreenSchema.index({ campaignId: 1, name: 1 }, { unique: true });

export const TabletopScreen =
  mongoose.models.TabletopScreen || mongoose.model('TabletopScreen', tabletopScreenSchema);
```

- [ ] **Step 2: Create TabletopPlayerState model**

Create `app/server/db/models/TabletopPlayerState.ts`:

```typescript
import mongoose from 'mongoose';

const viewportSchema = new mongoose.Schema(
  {
    screenId: { type: mongoose.Schema.Types.ObjectId, required: true },
    zoom: { type: Number, default: 1 },
    panX: { type: Number, default: 0 },
    panY: { type: Number, default: 0 },
  },
  { _id: false }
);

const windowOverrideSchema = new mongoose.Schema(
  {
    windowId: { type: String, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    state: {
      type: String,
      enum: ['open', 'minimized', 'hidden'],
      default: 'open',
    },
  },
  { _id: false }
);

const tabletopPlayerStateSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    activeScreenId: { type: mongoose.Schema.Types.ObjectId, default: null },
    viewports: { type: [viewportSchema], default: [] },
    windowOverrides: { type: [windowOverrideSchema], default: [] },
  },
  { collection: 'tabletopplayerstate' }
);

tabletopPlayerStateSchema.index({ campaignId: 1, userId: 1 }, { unique: true });

export const TabletopPlayerState =
  mongoose.models.TabletopPlayerState ||
  mongoose.model('TabletopPlayerState', tabletopPlayerStateSchema);
```

- [ ] **Step 3: Create SessionEvent model**

Create `app/server/db/models/SessionEvent.ts`:

```typescript
import mongoose from 'mongoose';
import { SESSION_EVENT_TYPES } from '~/types/tabletop';

const sessionEventSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
    },
    timestamp: { type: Date, default: Date.now },
    eventType: {
      type: String,
      enum: SESSION_EVENT_TYPES,
      required: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    collection: { type: String, required: true },
    tabletopScreenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TabletopScreen',
      required: true,
    },
    triggeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    displayName: { type: String, required: true },
  },
  { collection: 'sessionevent' }
);

sessionEventSchema.index({ campaignId: 1, sessionId: 1, timestamp: 1 });

export const SessionEvent =
  mongoose.models.SessionEvent || mongoose.model('SessionEvent', sessionEventSchema);
```

- [ ] **Step 4: Commit**

```bash
git add app/server/db/models/TabletopScreen.ts app/server/db/models/TabletopPlayerState.ts app/server/db/models/SessionEvent.ts
git commit -m "feat(tabletop): add MongoDB models for TabletopScreen, PlayerState, SessionEvent"
```

---

## Task 4: Server Functions — Tabletop Screen CRUD

**Files:**

- Create: `app/server/functions/tabletop.ts`

- [ ] **Step 1: Write tests for tabletop CRUD**

Create `tests/server/functions/tabletop.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies following existing pattern from tests/server/functions/auth.test.ts
vi.mock('~/server/session', () => ({
  getSession: vi.fn(),
}));
vi.mock('~/server/db/connection', () => ({
  connectDB: vi.fn(),
  isDBConnected: vi.fn(() => true),
}));

describe('tabletop server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('schema validation', () => {
    it('listTabletopScreensSchema rejects empty campaignId', async () => {
      const { listTabletopScreensSchema } = await import('~/types/schemas/tabletop');
      const result = listTabletopScreensSchema.safeParse({ campaignId: '' });
      expect(result.success).toBe(false);
    });

    it('createTabletopScreenSchema rejects empty name', async () => {
      const { createTabletopScreenSchema } = await import('~/types/schemas/tabletop');
      const result = createTabletopScreenSchema.safeParse({
        campaignId: 'abc123',
        name: '',
      });
      expect(result.success).toBe(false);
    });

    it('createTabletopScreenSchema accepts valid input', async () => {
      const { createTabletopScreenSchema } = await import('~/types/schemas/tabletop');
      const result = createTabletopScreenSchema.safeParse({
        campaignId: 'abc123',
        name: 'Battle Map 1',
      });
      expect(result.success).toBe(true);
    });

    it('updateTabletopScreenSettingsSchema rejects invalid gridStyle', async () => {
      const { updateTabletopScreenSettingsSchema } = await import('~/types/schemas/tabletop');
      const result = updateTabletopScreenSettingsSchema.safeParse({
        id: 'abc',
        campaignId: 'abc123',
        gridStyle: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('updateTabletopScreenSettingsSchema accepts valid gridStyle', async () => {
      const { updateTabletopScreenSettingsSchema } = await import('~/types/schemas/tabletop');
      const result = updateTabletopScreenSettingsSchema.safeParse({
        id: 'abc',
        campaignId: 'abc123',
        gridStyle: 'parchment',
      });
      expect(result.success).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/server/functions/tabletop.test.ts`
Expected: All 5 tests pass

- [ ] **Step 3: Write tabletop server functions**

Create `app/server/functions/tabletop.ts` — this follows the exact same pattern as `app/server/functions/gmscreens.ts`. I'm abbreviating for the plan but the implementation should mirror that file's auth/error patterns:

```typescript
import { createServerFn } from '@tanstack/react-start';
import mongoose from 'mongoose';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { TabletopScreen, TABLETOP_LIMITS } from '../db/models/TabletopScreen';
import { TabletopPlayerState } from '../db/models/TabletopPlayerState';
import { serverCaptureException, serverCaptureEvent } from '../utils/posthog';
import type {
  TabletopScreenData,
  TabletopScreenDetailData,
  WindowData,
  HydratedDocument,
  TabletopPlayerStateData,
} from '~/types/tabletop';
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

function serializeScreen(doc: {
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
    mode: (doc.mode as TabletopScreenData['mode']) ?? 'grid',
    gridStyle: (doc.gridStyle as TabletopScreenData['gridStyle']) ?? 'dark',
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
  return {
    id: String(w._id),
    collection: w.collection ?? '',
    documentId: String(w.documentId),
    state: ['open', 'minimized', 'hidden'].includes(w.state ?? '')
      ? (w.state as WindowData['state'])
      : 'open',
    x: w.x ?? null,
    y: w.y ?? null,
    width: w.width ?? null,
    height: w.height ?? null,
    zIndex: w.zIndex ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Auth helpers — campaign member (any role) and GM-only
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

  const member = members.find((m: { userId: unknown }) => String(m.userId) === userId);
  const isOwner = String(campaign.gameMasterId) === userId;

  if (!member && !isOwner) throw new Error('Not a campaign member');

  const role: 'gm' | 'player' = isOwner || member?.role === 'gm' ? 'gm' : 'player';

  return { userId, role, sessionUserId: user.id };
}

async function requireCampaignGM(
  campaignId: string
): Promise<{ userId: string; sessionUserId: string }> {
  const result = await requireCampaignMember(campaignId);
  if (result.role !== 'gm') throw new Error('Forbidden');
  return { userId: result.userId, sessionUserId: result.sessionUserId };
}

// ---------------------------------------------------------------------------
// listTabletopScreens — any campaign member can list
// ---------------------------------------------------------------------------

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

      return (docs as Array<Parameters<typeof serializeScreen>[0]>).map(serializeScreen);
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'listTabletopScreens',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// createTabletopScreen — GM only
// ---------------------------------------------------------------------------

export const createTabletopScreen = createServerFn({ method: 'POST' })
  .inputValidator(createTabletopScreenSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;

      const last = (await TabletopScreen.findOne({ campaignId: data.campaignId })
        .sort({ tabOrder: -1 })
        .select('tabOrder')
        .lean()) as { tabOrder?: number } | null;

      const nextOrder = (last?.tabOrder ?? -1) + 1;
      const now = new Date();

      const doc = await TabletopScreen.create({
        campaignId: data.campaignId,
        name: data.name.trim(),
        tabOrder: nextOrder,
        createdBy: gm.userId,
        createdAt: now,
        updatedAt: now,
      });

      serverCaptureEvent(sessionUserId, 'tabletop_screen_created', {
        campaign_id: data.campaignId,
        screen_id: String(doc._id),
      });

      return { success: true, screen: serializeScreen(doc) };
    } catch (e) {
      if ((e as { code?: number })?.code === 11000) {
        throw new Error('A tab with that name already exists');
      }
      serverCaptureException(e, sessionUserId, {
        action: 'createTabletopScreen',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// getTabletopScreen — any member, returns hydrated windows
// ---------------------------------------------------------------------------

export const getTabletopScreen = createServerFn({ method: 'GET' })
  .inputValidator(getTabletopScreenSchema)
  .handler(async ({ data }): Promise<TabletopScreenDetailData> => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const doc = await TabletopScreen.findOne({
        _id: data.id,
        campaignId: data.campaignId,
      }).lean();

      if (!doc) throw new Error('Screen not found');

      const windows = ((doc as { windows?: unknown[] }).windows ?? []).map((w: unknown) =>
        serializeWindow(w as Parameters<typeof serializeWindow>[0])
      );

      // Hydrate window refs using shared utility
      const { hydrateRefs } = await import('./tabletop-hydration');
      const refs = windows.map((w) => ({
        collection: w.collection,
        documentId: w.documentId,
      }));
      const hydrated = await hydrateRefs(refs, data.campaignId);

      return {
        ...serializeScreen(doc as Parameters<typeof serializeScreen>[0]),
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
// renameTabletopScreen — GM only
// ---------------------------------------------------------------------------

export const renameTabletopScreen = createServerFn({ method: 'POST' })
  .inputValidator(renameTabletopScreenSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;

      const result = await TabletopScreen.updateOne(
        { _id: data.id, campaignId: data.campaignId },
        { $set: { name: data.name.trim(), updatedAt: new Date() } }
      );

      if (result.matchedCount === 0) throw new Error('Screen not found');

      serverCaptureEvent(sessionUserId, 'tabletop_screen_renamed', {
        campaign_id: data.campaignId,
        screen_id: data.id,
      });

      return { success: true };
    } catch (e) {
      if ((e as { code?: number })?.code === 11000) {
        throw new Error('A tab with that name already exists');
      }
      serverCaptureException(e, sessionUserId, {
        action: 'renameTabletopScreen',
        screenId: data.id,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// deleteTabletopScreen — GM only
// ---------------------------------------------------------------------------

export const deleteTabletopScreen = createServerFn({ method: 'POST' })
  .inputValidator(deleteTabletopScreenSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;

      const count = await TabletopScreen.countDocuments({
        campaignId: data.campaignId,
      });
      if (count <= 1) throw new Error('Cannot delete the last tab');

      const result = await TabletopScreen.deleteOne({
        _id: data.id,
        campaignId: data.campaignId,
      });

      if (result.deletedCount === 0) throw new Error('Screen not found');

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
        remaining: (remaining as Array<Parameters<typeof serializeScreen>[0]>).map(serializeScreen),
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
// updateTabletopScreenSettings — GM only
// ---------------------------------------------------------------------------

export const updateTabletopScreenSettings = createServerFn({ method: 'POST' })
  .inputValidator(updateTabletopScreenSettingsSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;

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

      if (result.matchedCount === 0) throw new Error('Screen not found');

      return { success: true };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'updateTabletopScreenSettings',
        screenId: data.id,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// openTabletopWindow — GM only (shows wiki item on tabletop)
// ---------------------------------------------------------------------------

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

      if (!screen.windows) screen.windows = [];
      const windows = screen.windows;

      // Check for existing window with same ref
      const existing = windows.find(
        (w: { collection?: string; documentId?: unknown }) =>
          w.collection === data.collection && String(w.documentId) === data.documentId
      );

      if (existing) {
        const maxZ = windows.reduce(
          (max: number, w: { zIndex?: number }) => Math.max(max, w.zIndex ?? 0),
          0
        );
        existing.state = 'open';
        existing.zIndex = maxZ + 1;
        screen.updatedAt = new Date();
        await screen.save();
        return { success: true, window: serializeWindow(existing), existed: true };
      }

      if (windows.length >= TABLETOP_LIMITS.MAX_WINDOWS) {
        throw new Error(`A tab cannot have more than ${TABLETOP_LIMITS.MAX_WINDOWS} windows`);
      }

      const maxZ = windows.reduce(
        (max: number, w: { zIndex?: number }) => Math.max(max, w.zIndex ?? 0),
        0
      );
      windows.push({
        collection: data.collection,
        documentId: data.documentId,
        state: 'open',
        x: data.x ?? null,
        y: data.y ?? null,
        width: null,
        height: null,
        zIndex: maxZ + 1,
      });
      screen.updatedAt = new Date();
      await screen.save();

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
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// closeTabletopWindow — GM only (removes for everyone)
// ---------------------------------------------------------------------------

export const closeTabletopWindow = createServerFn({ method: 'POST' })
  .inputValidator(closeTabletopWindowSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;

      await TabletopScreen.updateOne(
        { _id: data.screenId, campaignId: data.campaignId },
        {
          $pull: { windows: { _id: data.windowId } },
          $set: { updatedAt: new Date() },
        }
      );

      return { success: true };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'closeTabletopWindow',
        screenId: data.screenId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// getPlayerState — returns current user's tabletop player state
// ---------------------------------------------------------------------------

export const getPlayerState = createServerFn({ method: 'GET' })
  .inputValidator(getPlayerStateSchema)
  .handler(async ({ data }): Promise<TabletopPlayerStateData | null> => {
    const member = await requireCampaignMember(data.campaignId);

    const doc = await TabletopPlayerState.findOne({
      campaignId: data.campaignId,
      userId: member.userId,
    }).lean();

    if (!doc) return null;

    return {
      id: String((doc as { _id: unknown })._id),
      campaignId: String((doc as { campaignId: unknown }).campaignId),
      userId: String((doc as { userId: unknown }).userId),
      activeScreenId: (doc as { activeScreenId?: unknown }).activeScreenId
        ? String((doc as { activeScreenId: unknown }).activeScreenId)
        : null,
      viewports: ((doc as { viewports?: unknown[] }).viewports ?? []).map((v: unknown) => {
        const vp = v as { screenId: unknown; zoom?: number; panX?: number; panY?: number };
        return {
          screenId: String(vp.screenId),
          zoom: vp.zoom ?? 1,
          panX: vp.panX ?? 0,
          panY: vp.panY ?? 0,
        };
      }),
      windowOverrides: ((doc as { windowOverrides?: unknown[] }).windowOverrides ?? []).map(
        (wo: unknown) => {
          const o = wo as {
            windowId: string;
            x: number;
            y: number;
            width: number;
            height: number;
            state?: string;
          };
          return {
            windowId: o.windowId,
            x: o.x,
            y: o.y,
            width: o.width,
            height: o.height,
            state: (o.state as 'open' | 'minimized' | 'hidden') ?? 'open',
          };
        }
      ),
    };
  });

// ---------------------------------------------------------------------------
// updatePlayerState — upsert current user's tabletop state
// ---------------------------------------------------------------------------

export const updatePlayerState = createServerFn({ method: 'POST' })
  .inputValidator(updatePlayerStateSchema)
  .handler(async ({ data }) => {
    const member = await requireCampaignMember(data.campaignId);

    const update: Record<string, unknown> = {};

    if (data.activeScreenId !== undefined) {
      update.activeScreenId = data.activeScreenId;
    }

    if (data.viewport) {
      // Upsert the viewport for this screen
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
          },
        }
      );
      // If screen not in viewports array, push it
      await TabletopPlayerState.updateOne(
        {
          campaignId: data.campaignId,
          userId: member.userId,
          'viewports.screenId': { $ne: data.viewport.screenId },
        },
        { $push: { viewports: data.viewport } }
      );
    }

    if (data.windowOverride) {
      // Upsert window override
      await TabletopPlayerState.updateOne(
        {
          campaignId: data.campaignId,
          userId: member.userId,
          'windowOverrides.windowId': data.windowOverride.windowId,
        },
        { $set: { 'windowOverrides.$': data.windowOverride } }
      );
      await TabletopPlayerState.updateOne(
        {
          campaignId: data.campaignId,
          userId: member.userId,
          'windowOverrides.windowId': { $ne: data.windowOverride.windowId },
        },
        { $push: { windowOverrides: data.windowOverride } }
      );
    }

    if (data.activeScreenId !== undefined) {
      await TabletopPlayerState.updateOne(
        { campaignId: data.campaignId, userId: member.userId },
        { $set: { activeScreenId: data.activeScreenId } },
        { upsert: true }
      );
    }

    return { success: true };
  });
```

- [ ] **Step 4: Create hydration utility**

Create `app/server/functions/tabletop-hydration.ts`:

```typescript
import { Note } from '../db/models/Note';
import { Character } from '../db/models/Character';
import { Race } from '../db/models/Race';
import { Rule } from '../db/models/Rule';
import type { HydratedDocument } from '~/types/tabletop';

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
    async fetch(ids, campaignId) {
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
    async fetch(ids, campaignId) {
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
    async fetch(ids, campaignId) {
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
    async fetch(ids, campaignId) {
      return Rule.find({ _id: { $in: ids }, campaignId }, '_id title content isPublic')
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
  player: {
    async fetch(ids, campaignId) {
      const { Player } = await import('../db/models/Player');
      return Player.find({ _id: { $in: ids }, campaignId }, '_id firstName lastName description')
        .lean()
        .then(
          (
            docs: Array<{
              _id: unknown;
              firstName?: string;
              lastName?: string;
              description?: string;
            }>
          ) =>
            docs.map((d) => ({
              _id: d._id,
              title: `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim(),
              content: d.description ?? '',
              isPublic: true,
            }))
        );
    },
  },
};

export async function hydrateRefs(
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
```

- [ ] **Step 5: Commit**

```bash
git add app/server/functions/tabletop.ts app/server/functions/tabletop-hydration.ts tests/server/functions/tabletop.test.ts
git commit -m "feat(tabletop): add server functions for screen CRUD, windows, player state"
```

---

## Task 5: Session Event Server Functions

**Files:**

- Create: `app/server/functions/session-events.ts`
- Create: `tests/server/functions/session-events.test.ts`

- [ ] **Step 1: Write session event tests**

Create `tests/server/functions/session-events.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('session event schemas', () => {
  it('createSessionEventSchema rejects missing eventType', async () => {
    const { createSessionEventSchema } = await import('~/types/schemas/tabletop');
    const result = createSessionEventSchema.safeParse({
      campaignId: 'abc',
      sessionId: 'sess1',
      documentId: 'doc1',
      collection: 'character',
      tabletopScreenId: 'screen1',
      displayName: 'Strahd',
    });
    expect(result.success).toBe(false);
  });

  it('createSessionEventSchema accepts valid input', async () => {
    const { createSessionEventSchema } = await import('~/types/schemas/tabletop');
    const result = createSessionEventSchema.safeParse({
      campaignId: 'abc',
      sessionId: 'sess1',
      eventType: 'reveal_document',
      documentId: 'doc1',
      collection: 'character',
      tabletopScreenId: 'screen1',
      displayName: 'Strahd',
    });
    expect(result.success).toBe(true);
  });

  it('listSessionEventsSchema requires sessionId', async () => {
    const { listSessionEventsSchema } = await import('~/types/schemas/tabletop');
    const result = listSessionEventsSchema.safeParse({
      campaignId: 'abc',
      sessionId: '',
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/server/functions/session-events.test.ts`
Expected: All 3 tests pass

- [ ] **Step 3: Create session event server functions**

Create `app/server/functions/session-events.ts`:

```typescript
import { createServerFn } from '@tanstack/react-start';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { SessionEvent } from '../db/models/SessionEvent';
import { serverCaptureException } from '../utils/posthog';
import type { SessionEventData } from '~/types/tabletop';
import { createSessionEventSchema, listSessionEventsSchema } from '~/types/schemas/tabletop';

function serializeEvent(doc: {
  _id: unknown;
  campaignId: unknown;
  sessionId: unknown;
  timestamp?: Date;
  eventType?: string;
  documentId: unknown;
  collection?: string;
  tabletopScreenId: unknown;
  triggeredBy: unknown;
  displayName?: string;
}): SessionEventData {
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    sessionId: String(doc.sessionId),
    timestamp: doc.timestamp instanceof Date ? doc.timestamp.toISOString() : '',
    eventType: (doc.eventType as SessionEventData['eventType']) ?? 'reveal_document',
    documentId: String(doc.documentId),
    collection: doc.collection ?? '',
    tabletopScreenId: String(doc.tabletopScreenId),
    triggeredBy: String(doc.triggeredBy),
    displayName: doc.displayName ?? '',
  };
}

async function requireGM(campaignId: string): Promise<{ userId: string }> {
  const user = await getSession();
  if (!user) throw new Error('Not authenticated');

  await connectDB();
  if (!isDBConnected()) throw new Error('Database not available');

  const dbUser = await User.findOne({ providerId: user.id });
  if (!dbUser) throw new Error('User not found');

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const userId = String(dbUser._id);
  const isGM =
    String(campaign.gameMasterId) === userId ||
    (campaign.members ?? []).some(
      (m: { userId: unknown; role?: string }) => String(m.userId) === userId && m.role === 'gm'
    );
  if (!isGM) throw new Error('Forbidden');

  return { userId };
}

export const createSessionEvent = createServerFn({ method: 'POST' })
  .inputValidator(createSessionEventSchema)
  .handler(async ({ data }) => {
    try {
      const gm = await requireGM(data.campaignId);

      const doc = await SessionEvent.create({
        campaignId: data.campaignId,
        sessionId: data.sessionId,
        timestamp: new Date(),
        eventType: data.eventType,
        documentId: data.documentId,
        collection: data.collection,
        tabletopScreenId: data.tabletopScreenId,
        triggeredBy: gm.userId,
        displayName: data.displayName,
      });

      return { success: true, event: serializeEvent(doc) };
    } catch (e) {
      serverCaptureException(e, undefined, {
        action: 'createSessionEvent',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

export const listSessionEvents = createServerFn({ method: 'GET' })
  .inputValidator(listSessionEventsSchema)
  .handler(async ({ data }) => {
    try {
      const user = await getSession();
      if (!user) throw new Error('Not authenticated');
      await connectDB();

      const docs = await SessionEvent.find({
        campaignId: data.campaignId,
        sessionId: data.sessionId,
      })
        .sort({ timestamp: 1 })
        .lean();

      return (docs as Array<Parameters<typeof serializeEvent>[0]>).map(serializeEvent);
    } catch (e) {
      serverCaptureException(e, undefined, {
        action: 'listSessionEvents',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });
```

- [ ] **Step 4: Commit**

```bash
git add app/server/functions/session-events.ts tests/server/functions/session-events.test.ts
git commit -m "feat(tabletop): add session event server functions for timeline logging"
```

---

## Task 6: React Query Hooks

**Files:**

- Create: `app/hooks/useTabletopScreens.ts`
- Create: `app/hooks/useTabletopPlayerState.ts`

- [ ] **Step 1: Create useTabletopScreens hook**

Create `app/hooks/useTabletopScreens.ts` — follows same pattern as `useGMScreens.ts`:

```typescript
import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/PostHogProvider';
import { queryKeys } from '~/utils/queryKeys';
import type { TabletopScreenData, TabletopScreenDetailData } from '~/types/tabletop';
import {
  listTabletopScreensSchema,
  getTabletopScreenSchema,
  createTabletopScreenSchema,
  renameTabletopScreenSchema,
  deleteTabletopScreenSchema,
  updateTabletopScreenSettingsSchema,
  openTabletopWindowSchema,
  closeTabletopWindowSchema,
} from '~/types/schemas/tabletop';

// Server function wrappers
const listScreensFn = createServerFn({ method: 'GET' })
  .inputValidator(listTabletopScreensSchema)
  .handler(async ({ data }) => {
    const { listTabletopScreens } = await import('~/server/functions/tabletop');
    return listTabletopScreens({ data });
  });

const getScreenFn = createServerFn({ method: 'GET' })
  .inputValidator(getTabletopScreenSchema)
  .handler(async ({ data }) => {
    const { getTabletopScreen } = await import('~/server/functions/tabletop');
    return getTabletopScreen({ data });
  });

const createScreenFn = createServerFn({ method: 'POST' })
  .inputValidator(createTabletopScreenSchema)
  .handler(async ({ data }) => {
    const { createTabletopScreen } = await import('~/server/functions/tabletop');
    return createTabletopScreen({ data });
  });

const renameScreenFn = createServerFn({ method: 'POST' })
  .inputValidator(renameTabletopScreenSchema)
  .handler(async ({ data }) => {
    const { renameTabletopScreen } = await import('~/server/functions/tabletop');
    return renameTabletopScreen({ data });
  });

const deleteScreenFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteTabletopScreenSchema)
  .handler(async ({ data }) => {
    const { deleteTabletopScreen } = await import('~/server/functions/tabletop');
    return deleteTabletopScreen({ data });
  });

const updateSettingsFn = createServerFn({ method: 'POST' })
  .inputValidator(updateTabletopScreenSettingsSchema)
  .handler(async ({ data }) => {
    const { updateTabletopScreenSettings } = await import('~/server/functions/tabletop');
    return updateTabletopScreenSettings({ data });
  });

const openWindowFn = createServerFn({ method: 'POST' })
  .inputValidator(openTabletopWindowSchema)
  .handler(async ({ data }) => {
    const { openTabletopWindow } = await import('~/server/functions/tabletop');
    return openTabletopWindow({ data });
  });

const closeWindowFn = createServerFn({ method: 'POST' })
  .inputValidator(closeTabletopWindowSchema)
  .handler(async ({ data }) => {
    const { closeTabletopWindow } = await import('~/server/functions/tabletop');
    return closeTabletopWindow({ data });
  });

// Hooks
export function useTabletopScreenList(campaignId: string) {
  const {
    data: screens = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.tabletop.list(campaignId),
    queryFn: () => listScreensFn({ data: { campaignId } }),
    enabled: !!campaignId,
  });
  return {
    screens,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useTabletopScreenDetail(campaignId: string, screenId: string | null) {
  const {
    data: screen = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.tabletop.detail(campaignId, screenId ?? ''),
    queryFn: () => getScreenFn({ data: { id: screenId!, campaignId } }),
    enabled: !!campaignId && !!screenId,
  });
  return {
    screen,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useTabletopMutations(campaignId: string) {
  const queryClient = useQueryClient();

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.tabletop.list(campaignId) });

  const invalidateDetail = (screenId: string) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.tabletop.detail(campaignId, screenId) });

  const createScreen = useMutation({
    mutationFn: (name: string) => createScreenFn({ data: { campaignId, name } }),
    onError: (e) => {
      captureException(e, { action: 'createTabletopScreen' });
    },
  });

  const renameScreen = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameScreenFn({ data: { id, campaignId, name } }),
    onSuccess: () => {
      invalidateList();
    },
    onError: (e) => {
      captureException(e, { action: 'renameTabletopScreen' });
    },
  });

  const deleteScreen = useMutation({
    mutationFn: (id: string) => deleteScreenFn({ data: { id, campaignId } }),
    onError: (e) => {
      captureException(e, { action: 'deleteTabletopScreen' });
    },
  });

  const updateSettings = useMutation({
    mutationFn: (params: {
      id: string;
      gridStyle?: string;
      gridSize?: number;
      gridVisible?: boolean;
      gridScale?: number;
      mode?: string;
    }) => updateSettingsFn({ data: { ...params, campaignId } }),
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.id);
    },
    onError: (e) => {
      captureException(e, { action: 'updateTabletopSettings' });
    },
  });

  const openWindow = useMutation({
    mutationFn: (params: {
      screenId: string;
      collection: string;
      documentId: string;
      x?: number | null;
      y?: number | null;
    }) => openWindowFn({ data: { ...params, campaignId } }),
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.screenId);
    },
    onError: (e) => {
      captureException(e, { action: 'openTabletopWindow' });
    },
  });

  const closeWindow = useMutation({
    mutationFn: ({ screenId, windowId }: { screenId: string; windowId: string }) =>
      closeWindowFn({ data: { screenId, campaignId, windowId } }),
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.screenId);
    },
    onError: (e) => {
      captureException(e, { action: 'closeTabletopWindow' });
    },
  });

  return {
    createScreen,
    renameScreen,
    deleteScreen,
    updateSettings,
    openWindow,
    closeWindow,
    invalidateList,
    invalidateDetail,
  };
}

export type { TabletopScreenData, TabletopScreenDetailData };
```

- [ ] **Step 2: Create useTabletopPlayerState hook**

Create `app/hooks/useTabletopPlayerState.ts`:

```typescript
import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryKeys } from '~/utils/queryKeys';
import { getPlayerStateSchema, updatePlayerStateSchema } from '~/types/schemas/tabletop';

const getStateFn = createServerFn({ method: 'GET' })
  .inputValidator(getPlayerStateSchema)
  .handler(async ({ data }) => {
    const { getPlayerState } = await import('~/server/functions/tabletop');
    return getPlayerState({ data });
  });

const updateStateFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePlayerStateSchema)
  .handler(async ({ data }) => {
    const { updatePlayerState } = await import('~/server/functions/tabletop');
    return updatePlayerState({ data });
  });

export function useTabletopPlayerState(campaignId: string) {
  const { data: playerState = null, isLoading } = useQuery({
    queryKey: queryKeys.tabletop.playerState(campaignId),
    queryFn: () => getStateFn({ data: { campaignId } }),
    enabled: !!campaignId,
  });

  const updateState = useMutation({
    mutationFn: (params: {
      activeScreenId?: string | null;
      viewport?: { screenId: string; zoom: number; panX: number; panY: number };
      windowOverride?: {
        windowId: string;
        x: number;
        y: number;
        width: number;
        height: number;
        state: 'open' | 'minimized' | 'hidden';
      };
    }) => updateStateFn({ data: { campaignId, ...params } }),
  });

  return { playerState, isLoading, updateState };
}
```

- [ ] **Step 3: Commit**

```bash
git add app/hooks/useTabletopScreens.ts app/hooks/useTabletopPlayerState.ts
git commit -m "feat(tabletop): add React Query hooks for screens and player state"
```

---

## Task 7: TabBar Enhancement (Notification Badge)

**Files:**

- Modify: `app/components/shared/TabBar.tsx`

- [ ] **Step 1: Add badge prop to Tab interface**

In `app/components/shared/TabBar.tsx`, add `badge?: boolean` to the `Tab` interface and render a dot indicator when active:

```typescript
import { type ReactNode } from 'react';

export interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
  hidden?: boolean;
  badge?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  accentColor?: string;
}

export function TabBar({ tabs, activeTab, onTabChange, accentColor = '#3498db' }: TabBarProps) {
  const visibleTabs = tabs.filter((t) => !t.hidden);
  return (
    <div className="flex border-b border-white/[0.06] bg-[#0D1117]">
      {visibleTabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`relative px-5 py-2.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === tab.id
              ? 'text-slate-200 border-b-2'
              : 'text-slate-500 hover:text-slate-400'
          }`}
          style={activeTab === tab.id ? { borderBottomColor: accentColor } : undefined}
        >
          {tab.icon}
          {tab.label}
          {tab.badge && activeTab !== tab.id && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#2563EB] animate-pulse" />
          )}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/shared/TabBar.tsx
git commit -m "feat(shared): add notification badge support to TabBar component"
```

---

## Task 8: Default Grid Component (Konva)

**Files:**

- Create: `app/components/mainview/tabletop/DefaultGrid.tsx`
- Create: `tests/components/mainview/tabletop/DefaultGrid.test.tsx`

- [ ] **Step 1: Write grid component test**

Create `tests/components/mainview/tabletop/DefaultGrid.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DefaultGrid } from '~/components/mainview/tabletop/DefaultGrid';

describe('DefaultGrid', () => {
  it('renders a canvas element', () => {
    const { container } = render(
      <DefaultGrid
        width={800}
        height={600}
        gridStyle="dark"
        gridSize={50}
        gridVisible={true}
      />
    );
    // react-konva renders to a canvas
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
  });

  it('renders with data-testid', () => {
    render(
      <DefaultGrid
        width={800}
        height={600}
        gridStyle="dark"
        gridSize={50}
        gridVisible={true}
      />
    );
    expect(screen.getByTestId('default-grid')).toBeDefined();
  });
});
```

- [ ] **Step 2: Create DefaultGrid component**

Create `app/components/mainview/tabletop/DefaultGrid.tsx`:

```typescript
import { Stage, Layer, Line, Rect } from 'react-konva';
import type { GridStyle } from '~/types/tabletop';

interface DefaultGridProps {
  width: number;
  height: number;
  gridStyle: GridStyle;
  gridSize: number;
  gridVisible: boolean;
}

const GRID_THEMES: Record<GridStyle, { bg: string; line: string; lineOpacity: number }> = {
  dark: { bg: '#0D1117', line: '#1a2332', lineOpacity: 0.8 },
  parchment: { bg: '#f4e4c1', line: '#c4a882', lineOpacity: 0.5 },
  hex: { bg: '#0D1117', line: '#1a2332', lineOpacity: 0.8 },
  whiteboard: { bg: '#ffffff', line: '#e0e0e0', lineOpacity: 0.6 },
};

export function DefaultGrid({
  width,
  height,
  gridStyle,
  gridSize,
  gridVisible,
}: DefaultGridProps) {
  const theme = GRID_THEMES[gridStyle];

  const verticalLines: number[][] = [];
  const horizontalLines: number[][] = [];

  if (gridVisible) {
    for (let x = 0; x <= width; x += gridSize) {
      verticalLines.push([x, 0, x, height]);
    }
    for (let y = 0; y <= height; y += gridSize) {
      horizontalLines.push([0, y, width, y]);
    }
  }

  return (
    <div data-testid="default-grid">
      <Stage width={width} height={height}>
        <Layer>
          {/* Background */}
          <Rect x={0} y={0} width={width} height={height} fill={theme.bg} />

          {/* Grid lines */}
          {verticalLines.map((points, i) => (
            <Line
              key={`v-${i}`}
              points={points}
              stroke={theme.line}
              strokeWidth={1}
              opacity={theme.lineOpacity}
            />
          ))}
          {horizontalLines.map((points, i) => (
            <Line
              key={`h-${i}`}
              points={points}
              stroke={theme.line}
              strokeWidth={1}
              opacity={theme.lineOpacity}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/components/mainview/tabletop/DefaultGrid.test.tsx`
Expected: Tests pass (note: may need to mock canvas — if so, add `vitest-canvas-mock` or skip canvas tests in CI)

- [ ] **Step 4: Commit**

```bash
git add app/components/mainview/tabletop/DefaultGrid.tsx tests/components/mainview/tabletop/DefaultGrid.test.tsx
git commit -m "feat(tabletop): add DefaultGrid Konva component with style presets"
```

---

## Task 9: TabletopTabBar Component

**Files:**

- Create: `app/components/mainview/tabletop/TabletopTabBar.tsx`

- [ ] **Step 1: Create TabletopTabBar**

Create `app/components/mainview/tabletop/TabletopTabBar.tsx`:

```typescript
import { useState } from 'react';
import { Plus, Focus } from 'lucide-react';
import { TabBar, type Tab } from '~/components/shared/TabBar';
import type { TabletopScreenData } from '~/types/tabletop';

interface TabletopTabBarProps {
  screens: TabletopScreenData[];
  activeScreenId: string | null;
  onScreenChange: (screenId: string) => void;
  onCreateScreen: (name: string) => void;
  onFocusAll: () => void;
  isGM: boolean;
  badgeScreenIds: Set<string>;
}

export function TabletopTabBar({
  screens,
  activeScreenId,
  onScreenChange,
  onCreateScreen,
  onFocusAll,
  isGM,
  badgeScreenIds,
}: TabletopTabBarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const tabs: Tab[] = screens.map((s) => ({
    id: s.id,
    label: s.name,
    badge: badgeScreenIds.has(s.id),
  }));

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreateScreen(trimmed);
    setNewName('');
    setIsCreating(false);
  };

  return (
    <div className="flex items-center gap-2" data-testid="tabletop-tab-bar">
      <TabBar
        tabs={tabs}
        activeTab={activeScreenId ?? ''}
        onTabChange={onScreenChange}
        accentColor="#2563EB"
      />

      {isGM && (
        <div className="flex items-center gap-1 ml-2">
          {isCreating ? (
            <form
              onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
              className="flex items-center gap-1"
            >
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Tab name..."
                className="bg-[#161B22] border border-white/10 rounded px-2 py-1 text-xs text-slate-200 w-28"
                autoFocus
                onBlur={() => { if (!newName.trim()) setIsCreating(false); }}
              />
              <button
                type="submit"
                className="text-xs text-[#2563EB] hover:text-blue-400 px-1"
              >
                Add
              </button>
            </form>
          ) : (
            <button
              onClick={() => setIsCreating(true)}
              className="text-slate-500 hover:text-slate-300 p-1"
              title="Add tab"
            >
              <Plus size={14} />
            </button>
          )}

          <button
            onClick={onFocusAll}
            className="text-slate-500 hover:text-slate-300 p-1"
            title="Focus all players to this tab"
          >
            <Focus size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/mainview/tabletop/TabletopTabBar.tsx
git commit -m "feat(tabletop): add TabletopTabBar with create, badges, and focus-all"
```

---

## Task 10: Ping Overlay Component

**Files:**

- Create: `app/components/mainview/tabletop/PingOverlay.tsx`

- [ ] **Step 1: Create PingOverlay**

Create `app/components/mainview/tabletop/PingOverlay.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Layer, Circle, Text } from 'react-konva';

export interface PingData {
  id: string;
  x: number;
  y: number;
  userName: string;
  color: string;
  createdAt: number;
}

interface PingOverlayProps {
  pings: PingData[];
  onPingExpired: (id: string) => void;
}

const PING_DURATION_MS = 3000;
const PING_MAX_RADIUS = 30;

export function PingOverlay({ pings, onPingExpired }: PingOverlayProps) {
  const [, setTick] = useState(0);

  // Animate pings and expire them
  useEffect(() => {
    if (pings.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      for (const ping of pings) {
        if (now - ping.createdAt > PING_DURATION_MS) {
          onPingExpired(ping.id);
        }
      }
      setTick((t) => t + 1);
    }, 50);

    return () => clearInterval(interval);
  }, [pings, onPingExpired]);

  return (
    <Layer>
      {pings.map((ping) => {
        const elapsed = Date.now() - ping.createdAt;
        const progress = Math.min(elapsed / PING_DURATION_MS, 1);
        const opacity = 1 - progress;
        const radius = PING_MAX_RADIUS * (0.5 + progress * 0.5);

        return (
          <React.Fragment key={ping.id}>
            <Circle
              x={ping.x}
              y={ping.y}
              radius={radius}
              stroke={ping.color}
              strokeWidth={3}
              opacity={opacity}
            />
            <Circle
              x={ping.x}
              y={ping.y}
              radius={5}
              fill={ping.color}
              opacity={opacity}
            />
            <Text
              x={ping.x + 10}
              y={ping.y - 10}
              text={ping.userName}
              fontSize={11}
              fill={ping.color}
              opacity={opacity}
            />
          </React.Fragment>
        );
      })}
    </Layer>
  );
}
```

Add the React import at the top:

```typescript
import React, { useEffect, useState } from 'react';
```

- [ ] **Step 2: Commit**

```bash
git add app/components/mainview/tabletop/PingOverlay.tsx
git commit -m "feat(tabletop): add PingOverlay component for ephemeral ping animations"
```

---

## Task 11: PartyKit Tabletop Party Server

**Files:**

- Create: `party/tabletop.ts`
- Create: `app/hooks/useTabletopParty.ts`

- [ ] **Step 1: Create PartyKit tabletop server**

Create `party/tabletop.ts`:

```typescript
import type * as Party from 'partykit/server';

export default class TabletopParty implements Party.Server {
  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    // New connection joins the room
    console.info(`[Tabletop] ${conn.id} connected to room ${this.room.id}`);
  }

  onMessage(message: string, sender: Party.Connection) {
    // Broadcast to all OTHER connections in the room
    this.room.broadcast(message, [sender.id]);
  }

  onClose(conn: Party.Connection) {
    console.info(`[Tabletop] ${conn.id} disconnected from room ${this.room.id}`);
  }
}
```

- [ ] **Step 2: Create useTabletopParty hook**

Create `app/hooks/useTabletopParty.ts`:

```typescript
import usePartySocket from 'partysocket/react';
import { useCallback, useRef } from 'react';
import type { TabletopMessage } from '~/types/tabletop';

const PARTYKIT_HOST = import.meta.env.VITE_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999';

export function useTabletopParty(
  campaignId: string | null,
  getToken: () => Promise<string>,
  onMessage: (msg: TabletopMessage) => void
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const stableOnMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as TabletopMessage;
      onMessageRef.current(data);
    } catch (err) {
      console.error('[TabletopParty] Failed to parse message', err);
    }
  }, []);

  const roomId = campaignId ? `tabletop-${campaignId}` : '__disabled__';

  const socket = usePartySocket({
    host: PARTYKIT_HOST,
    room: roomId,
    party: 'tabletop',
    query: campaignId ? async () => ({ token: await getToken() }) : () => ({ token: '' }),
    onOpen() {
      console.info(`[TabletopParty] Connected to room ${roomId}`);
    },
    onClose(event) {
      if (campaignId && event.code !== 1000) {
        console.warn(`[TabletopParty] Disconnected code=${event.code}`);
      }
    },
    onMessage: stableOnMessage,
    startClosed: !campaignId,
    maxRetries: campaignId ? undefined : 0,
  });

  const send = useCallback(
    (msg: TabletopMessage) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    },
    [socket]
  );

  return { socket, send };
}
```

- [ ] **Step 3: Commit**

```bash
git add party/tabletop.ts app/hooks/useTabletopParty.ts
git commit -m "feat(tabletop): add PartyKit tabletop party server and client hook"
```

---

## Task 12: Main TabletopView Component

**Files:**

- Create: `app/components/mainview/tabletop/TabletopView.tsx`
- Modify: `app/components/mainview/TabletopView.tsx` (replace placeholder)

- [ ] **Step 1: Create the full TabletopView**

Create `app/components/mainview/tabletop/TabletopView.tsx`:

```typescript
import { useState, useCallback, useEffect, useRef } from 'react';
import { useTabletopScreenList, useTabletopScreenDetail, useTabletopMutations } from '~/hooks/useTabletopScreens';
import { useTabletopPlayerState } from '~/hooks/useTabletopPlayerState';
import { useTabletopParty } from '~/hooks/useTabletopParty';
import { TabletopTabBar } from './TabletopTabBar';
import { TabletopCanvas } from './TabletopCanvas';
import { FloatingWindowManager, type ManagedWindow } from '~/components/mainview/FloatingWindowManager';
import type { TabletopMessage, TabletopScreenData } from '~/types/tabletop';
import type { PingData } from './PingOverlay';

interface TabletopViewProps {
  campaignId: string;
  isGM: boolean;
  getToken: () => Promise<string>;
  sessionId: string | null;
}

export function TabletopView({ campaignId, isGM, getToken, sessionId }: TabletopViewProps) {
  const { screens, isLoading } = useTabletopScreenList(campaignId);
  const mutations = useTabletopMutations(campaignId);
  const { playerState, updateState } = useTabletopPlayerState(campaignId);

  const [activeScreenId, setActiveScreenId] = useState<string | null>(null);
  const [badgeScreenIds, setBadgeScreenIds] = useState<Set<string>>(new Set());
  const [pings, setPings] = useState<PingData[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize active screen from player state or first screen
  useEffect(() => {
    if (activeScreenId) return;
    if (playerState?.activeScreenId) {
      setActiveScreenId(playerState.activeScreenId);
    } else if (screens.length > 0) {
      setActiveScreenId(screens[0].id);
    }
  }, [screens, playerState, activeScreenId]);

  // Fetch detail for active screen
  const { screen: activeScreen } = useTabletopScreenDetail(campaignId, activeScreenId);

  // PartyKit message handler
  const handleMessage = useCallback(
    (msg: TabletopMessage) => {
      switch (msg.type) {
        case 'tab:create':
          mutations.invalidateList();
          break;
        case 'tab:rename':
        case 'tab:delete':
          mutations.invalidateList();
          break;
        case 'tab:focus-all':
          setActiveScreenId(msg.screenId);
          break;
        case 'tab:content-added':
          if (msg.screenId !== activeScreenId) {
            setBadgeScreenIds((prev) => new Set([...prev, msg.screenId]));
          }
          break;
        case 'window:show':
        case 'window:close':
          if (msg.screenId === activeScreenId) {
            mutations.invalidateDetail(msg.screenId);
          }
          break;
        case 'ping':
          setPings((prev) => [
            ...prev,
            {
              id: `${msg.userId}-${Date.now()}`,
              x: msg.x,
              y: msg.y,
              userName: msg.userName,
              color: msg.color,
              createdAt: Date.now(),
            },
          ]);
          break;
        case 'grid:style-change':
          if (msg.screenId === activeScreenId) {
            mutations.invalidateDetail(msg.screenId);
          }
          break;
      }
    },
    [activeScreenId, mutations]
  );

  const { send } = useTabletopParty(campaignId, getToken, handleMessage);

  // Handle tab change
  const handleScreenChange = (screenId: string) => {
    setActiveScreenId(screenId);
    setBadgeScreenIds((prev) => {
      const next = new Set(prev);
      next.delete(screenId);
      return next;
    });
    updateState.mutate({ activeScreenId: screenId });
  };

  // Handle create screen
  const handleCreateScreen = async (name: string) => {
    const result = await mutations.createScreen.mutateAsync(name);
    if (result.success) {
      await mutations.invalidateList();
      setActiveScreenId(result.screen.id);
      send({ type: 'tab:create', screen: result.screen });
    }
  };

  // Handle focus all
  const handleFocusAll = () => {
    if (activeScreenId) {
      send({ type: 'tab:focus-all', screenId: activeScreenId });
    }
  };

  // Handle ping expired
  const handlePingExpired = useCallback((id: string) => {
    setPings((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // Build floating windows from active screen
  const managedWindows: ManagedWindow[] = (activeScreen?.windows ?? []).map((w) => {
    const hydrated = activeScreen?.hydrated[`${w.collection}:${w.documentId}`];
    return {
      id: w.id,
      title: hydrated?.title ?? 'Loading...',
      content: <div className="p-3 text-sm text-slate-300 whitespace-pre-wrap">{hydrated?.content ?? ''}</div>,
      position: w.x != null && w.y != null ? { x: w.x, y: w.y } : undefined,
      size: w.width != null && w.height != null ? { width: w.width, height: w.height } : undefined,
      state: w.state === 'minimized' ? 'minimized' : 'normal',
      zIndex: w.zIndex,
    };
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-slate-500">Loading tabletop...</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col" data-testid="tabletop-view">
      <TabletopTabBar
        screens={screens}
        activeScreenId={activeScreenId}
        onScreenChange={handleScreenChange}
        onCreateScreen={handleCreateScreen}
        onFocusAll={handleFocusAll}
        isGM={isGM}
        badgeScreenIds={badgeScreenIds}
      />

      <div className="relative flex-1 overflow-hidden">
        <TabletopCanvas
          screen={activeScreen}
          pings={pings}
          onPingExpired={handlePingExpired}
          containerRef={containerRef}
        />

        <FloatingWindowManager
          windows={managedWindows}
          onWindowsChange={() => {
            // Window changes handled through mutations
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create TabletopCanvas wrapper**

Create `app/components/mainview/tabletop/TabletopCanvas.tsx`:

```typescript
import { useEffect, useState, type RefObject } from 'react';
import { DefaultGrid } from './DefaultGrid';
import { PingOverlay, type PingData } from './PingOverlay';
import type { TabletopScreenDetailData } from '~/types/tabletop';

interface TabletopCanvasProps {
  screen: TabletopScreenDetailData | null;
  pings: PingData[];
  onPingExpired: (id: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
}

export function TabletopCanvas({
  screen,
  pings,
  onPingExpired,
  containerRef,
}: TabletopCanvasProps) {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height - 40, // subtract tab bar height
        });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  if (!screen) {
    return (
      <DefaultGrid
        width={dimensions.width}
        height={dimensions.height}
        gridStyle="dark"
        gridSize={50}
        gridVisible={true}
      />
    );
  }

  // For Phase 1, only mode='grid' is supported
  return (
    <DefaultGrid
      width={dimensions.width}
      height={dimensions.height}
      gridStyle={screen.gridStyle}
      gridSize={screen.gridSize}
      gridVisible={screen.gridVisible}
    />
  );
}
```

- [ ] **Step 3: Update the old TabletopView to redirect**

Replace `app/components/mainview/TabletopView.tsx`:

```typescript
// Re-export from tabletop directory
export { TabletopView } from './tabletop/TabletopView';
```

- [ ] **Step 4: Commit**

```bash
git add app/components/mainview/tabletop/TabletopView.tsx app/components/mainview/tabletop/TabletopCanvas.tsx app/components/mainview/tabletop/TabletopTabBar.tsx app/components/mainview/TabletopView.tsx
git commit -m "feat(tabletop): add main TabletopView with tabs, grid, windows, and real-time sync"
```

---

## Task 13: "Show on Tabletop" Button on Wiki Items

**Files:**

- Modify: Wiki item action components (character, note, race, rule views)

- [ ] **Step 1: Identify where wiki item actions are rendered**

Look for the components that render action buttons on wiki items in the inspector/detail panels. These will be in `app/components/wiki/` — look for buttons like "Open in GM Screen" or similar action patterns.

- [ ] **Step 2: Add "Show on Tabletop" button (GM only)**

In the wiki item detail/action component, add a button that:

- Only renders when `isGM` is true
- Calls `openTabletopWindow` mutation with the current screen's ID, collection type, and document ID
- Sends a `window:show` PartyKit message to broadcast to all players
- Sends a `tab:content-added` message to trigger badge on other tabs
- Creates a `SessionEvent` for the timeline

```typescript
// Example button (adapt to existing patterns):
{isGM && activeTabletopScreenId && (
  <button
    onClick={async () => {
      await openWindow.mutateAsync({
        screenId: activeTabletopScreenId,
        collection: 'character', // or 'note', 'rule', etc.
        documentId: item.id,
      });
      send({
        type: 'window:show',
        screenId: activeTabletopScreenId,
        window: { /* window data */ },
        displayName: item.title,
      });
      send({ type: 'tab:content-added', screenId: activeTabletopScreenId });
      // Create session event
      await createSessionEvent({
        campaignId,
        sessionId,
        eventType: 'reveal_document',
        documentId: item.id,
        collection: 'character',
        tabletopScreenId: activeTabletopScreenId,
        displayName: item.title,
      });
    }}
    className="text-xs text-slate-400 hover:text-[#2563EB] flex items-center gap-1"
    title="Show on Tabletop"
  >
    <Monitor size={12} />
    Show on Tabletop
  </button>
)}
```

- [ ] **Step 3: Commit**

```bash
git add app/components/wiki/
git commit -m "feat(tabletop): add Show on Tabletop button to wiki items (GM only)"
```

---

## Task 14: Playwright E2E Setup & Fixtures (renumbered from 13)

**Files:**

- Create: `e2e/fixtures/tabletop-fixtures.ts`
- Create: `e2e/tabletop/tabletop-tabs.spec.ts`

- [ ] **Step 1: Create E2E fixtures**

Create `e2e/fixtures/tabletop-fixtures.ts`:

```typescript
import { test as base, expect } from '@playwright/test';

// Extend base test with multi-user fixtures
export const test = base.extend<{
  gmPage: ReturnType<(typeof base)['page']>;
  playerPage: ReturnType<(typeof base)['page']>;
}>({
  gmPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // TODO: Implement GM login flow for your auth system
    // await loginAsGM(page);
    await use(page as never);
    await context.close();
  },
  playerPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // TODO: Implement player login flow for your auth system
    // await loginAsPlayer(page);
    await use(page as never);
    await context.close();
  },
});

export { expect };
```

- [ ] **Step 2: Create tab management E2E test**

Create `e2e/tabletop/tabletop-tabs.spec.ts`:

```typescript
import { test, expect } from '../fixtures/tabletop-fixtures';

test.describe('Tabletop Tab Management', () => {
  test.skip(true, 'Requires auth setup — enable after login fixtures are implemented');

  test('GM can create a new tab', async ({ gmPage }) => {
    // Navigate to campaign tabletop
    await gmPage.goto('/play/CAMPAIGN_ID');
    await gmPage.click('[data-testid="tab-tabletop"]');

    // Click add tab button
    await gmPage.click('[title="Add tab"]');

    // Type name and submit
    await gmPage.fill('input[placeholder="Tab name..."]', 'Battle Map 1');
    await gmPage.click('button:has-text("Add")');

    // Verify tab appears
    await expect(gmPage.getByText('Battle Map 1')).toBeVisible();
  });

  test('player sees tab created by GM in real-time', async ({ gmPage, playerPage }) => {
    const campaignUrl = '/play/CAMPAIGN_ID';
    await gmPage.goto(campaignUrl);
    await playerPage.goto(campaignUrl);

    // Both navigate to tabletop
    await gmPage.click('[data-testid="tab-tabletop"]');
    await playerPage.click('[data-testid="tab-tabletop"]');

    // GM creates tab
    await gmPage.click('[title="Add tab"]');
    await gmPage.fill('input[placeholder="Tab name..."]', 'City Map');
    await gmPage.click('button:has-text("Add")');

    // Player should see it appear
    await expect(playerPage.getByText('City Map')).toBeVisible({ timeout: 5000 });
  });

  test('Focus All pulls player to GM tab', async ({ gmPage, playerPage }) => {
    const campaignUrl = '/play/CAMPAIGN_ID';
    await gmPage.goto(campaignUrl);
    await playerPage.goto(campaignUrl);

    await gmPage.click('[data-testid="tab-tabletop"]');
    await playerPage.click('[data-testid="tab-tabletop"]');

    // GM clicks Focus All
    await gmPage.click('[title="Focus all players to this tab"]');

    // Player's active tab should match GM's
    // (implementation-specific assertion based on active tab styling)
  });
});
```

- [ ] **Step 3: Commit**

```bash
mkdir -p e2e/fixtures e2e/tabletop
git add e2e/fixtures/tabletop-fixtures.ts e2e/tabletop/tabletop-tabs.spec.ts playwright.config.ts
git commit -m "test(tabletop): add Playwright E2E setup with fixtures and tab management tests"
```

---

## Task 15: Integration — Wire TabletopView into MainView

**Files:**

- Modify: Main view component that renders `TabletopView` based on active tab

- [ ] **Step 1: Find and update the main view rendering**

The main view already renders `<TabletopView />` when the `tabletop` tab is active (based on TabNavigation). Update the import and pass required props (`campaignId`, `isGM`, `getToken`, `sessionId`) from the parent component's context.

Locate the parent component that conditionally renders `TabletopView` and update it to pass the required props. The exact file depends on the codebase structure — look at where `TabletopView` is imported and rendered.

- [ ] **Step 2: Verify the app builds**

Run: `npm run build`
Expected: No TypeScript errors, build succeeds

- [ ] **Step 3: Verify the app runs locally**

Run: `npm run dev`
Navigate to a campaign → Tabletop tab
Expected: Default grid renders, tab bar shows (GM sees add/focus buttons)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(tabletop): wire TabletopView into main campaign view"
```

---

## Task 16: Developer Documentation

**Files:**

- Create: `docs/tabletop/README.md`
- Create: `docs/tabletop/architecture.md`
- Create: `docs/tabletop/data-flow.md`
- Create: `docs/tabletop/real-time-sync.md`
- Create: `docs/tabletop/adding-features.md`

- [ ] **Step 1: Create documentation directory and overview README**

Create `docs/tabletop/README.md` — overview of the tabletop feature with links to other docs. Cover:

- Feature summary table (modes, renderers, purpose)
- Key concepts (screens, layers, player state, session events, ping)
- Quick links to other documentation files

- [ ] **Step 2: Create architecture documentation with ASCII diagrams**

Create `docs/tabletop/architecture.md` — include diagrams for:

- Dual renderer strategy (Konva vs Leaflet and when each is used)
- 6-layer compositing stack (visual diagram showing bottom to top)
- Component tree (full hierarchy from TabletopView down)
- Permissions model (what GM can do vs what players can do)
- File organization (where each type of code lives)

- [ ] **Step 3: Create data flow and persistence documentation**

Create `docs/tabletop/data-flow.md` — cover:

- Shared state vs personal state ownership
- Persistence flow diagram (user action → local state → PartyKit → debounce → MongoDB)
- Reconnection behavior (full state loaded from MongoDB on page load)
- Session event write-once pattern and how it feeds recaps

- [ ] **Step 4: Create real-time sync documentation**

Create `docs/tabletop/real-time-sync.md` — cover:

- PartyKit party setup (dedicated `tabletop` party, room ID pattern)
- All message types with TypeScript signatures
- Broadcast relay pattern (server is a simple relay, validation on client)
- Conflict resolution strategy (last-write-wins for tokens)
- Notification badge lifecycle
- Ping lifecycle (ephemeral, 3-second animation, never persisted)

- [ ] **Step 5: Create developer guide for extending the tabletop**

Create `docs/tabletop/adding-features.md` — how-to guides for:

- Adding a new drawing tool
- Adding a new layer
- Adding a new PartyKit message type
- Adding a new server function
- Testing checklist for any new feature

- [ ] **Step 6: Commit documentation**

```bash
mkdir -p docs/tabletop
git add docs/tabletop/
git commit -m "docs(tabletop): add comprehensive developer documentation with architecture diagrams"
```

---

## Summary

This plan implements Phase 1 of the Tabletop feature in 16 tasks:

1. **Dependencies** — react-konva, konva, Playwright
2. **Types & Schemas** — TypeScript interfaces and Zod validation
3. **MongoDB Models** — TabletopScreen, TabletopPlayerState, SessionEvent
4. **Server Functions** — CRUD, windows, player state (follows GMScreen patterns)
5. **Session Events** — Timeline logging server functions
6. **React Query Hooks** — Client-side data fetching layer
7. **TabBar Enhancement** — Badge notification support
8. **DefaultGrid** — Konva grid rendering with style presets
9. **TabletopTabBar** �� Tab bar with create/focus/badges
10. **PingOverlay** — Ephemeral animated ping circles
11. **PartyKit** — Real-time sync server and client hook
12. **TabletopView** — Main container wiring everything together
13. **Show on Tabletop** — Wiki button to broadcast items (GM only)
14. **Playwright E2E** — Test infrastructure and initial tests
15. **Integration** — Wire into the app, verify build
16. **Documentation** — Architecture docs, data flow diagrams, developer guides

Each task produces a working commit. Tasks 1-6 are backend/data layer, tasks 7-13 are frontend, tasks 14-15 are testing and integration, task 16 is documentation.
