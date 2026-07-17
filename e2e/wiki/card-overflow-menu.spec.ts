/**
 * E2E: the shared-vs-private proof for the wiki card overflow menu.
 *
 * The entire point of the overflow menu's two display actions is a split that
 * NO unit test can prove — it needs two independent browsers driven by two
 * DIFFERENT users:
 *
 *  - "Push to Tabletop" (GM only) is SHARED. It writes a window onto the
 *    campaign's TabletopScreen document, which every member of the campaign
 *    reads. A PLAYER, in their own browser, therefore sees it too.
 *  - "Show on Tab" is PRIVATE. It writes a window onto the CALLER's own
 *    tabletop player-state, which is per-user and never shared — so another
 *    user never sees it, and it survives a reload for its owner.
 *
 * We drive with Quests because `QuestWindow` carries a stable
 * `data-testid="quest-window"` — `FloatingWindow` and `CharacterWindow` have
 * none. The overflow trigger is aria-labelled "Quest actions" and the menu
 * items are `overflow-item-push` / `overflow-item-show-on-tab`.
 *
 * TWO USERS, NOT TWO GM TABS. The task brief suggested two GM contexts, but a
 * private window is keyed by user, so two contexts of the SAME GM cannot tell
 * shared from private (a reloaded second GM tab would see BOTH — the shared
 * screen window AND that same GM's own private window). To actually prove the
 * split we mint a real PLAYER session for a seeded player-member of the
 * campaign, entirely in-spec, following the JWT shape in `e2e/globalSetup.ts`
 * (no globalSetup change, no production code path). The player is a genuine
 * non-GM campaign member (role resolved from `campaign.members`).
 *
 * WHY THE OBSERVER RELOADS. Opening a tabletop window is persisted but is NOT
 * broadcast to other connected clients — no client ever emits the `window:show`
 * message (the realtime service is a pure relay and the send side was never
 * wired; the same is true of drag-and-drop). So a second browser converges only
 * on its next fetch. We reload the player to force that fetch. This proves the
 * SHARING SEMANTIC (push → shared surface, visible to another user); it does
 * NOT exercise live propagation, which does not currently work end-to-end. See
 * the task report for that finding.
 *
 * We deliberately do NOT `blockPartyKit` (which would abort ws://localhost:1999
 * and add noise); `npm run dev` — the Playwright webServer — runs the realtime
 * service, so leaving it up is harmless and realistic.
 *
 * Pre-conditions: seeded dev DB (`npm run dev:seed`) and the full dev stack
 * (web + realtime) on :3000 / :1999. This spec self-seeds its own quest.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { SignJWT } from 'jose';
import { test, expect, openWikiTab, openTabletopTab } from '../fixtures/tabletop-fixtures';
import type { Page, BrowserContext, Browser } from '@playwright/test';

/** Stable name so re-running the suite reuses one quest instead of piling up. */
const E2E_QUEST_NAME = 'E2E Overflow Menu Quest';

interface SeedData {
  campaignId: string;
  screenId: string;
}

function readSeed(): SeedData {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'e2e', '.auth', 'seed-data.json'), 'utf-8')
  ) as SeedData;
}

function loadEnv(): { mongoUri: string; sessionSecret: string } {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env optional when the vars are already in the environment (CI).
  }
  const mongoUri = process.env.MONGODB_URI;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!mongoUri) throw new Error('MONGODB_URI not set');
  if (!sessionSecret) throw new Error('SESSION_SECRET not set');
  if (/prod/i.test(mongoUri)) throw new Error('Refusing to use a production-looking MONGODB_URI');
  return { mongoUri, sessionSecret };
}

interface SessionUserDoc {
  providerId: string;
  provider?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  avatarUrl?: string;
  role?: string;
}

type StorageState = NonNullable<
  Exclude<Parameters<Browser['newContext']>[0], undefined>['storageState']
>;

/** Mint a `cartyx_session` cookie for the given app user, matching globalSetup. */
async function mintStorageState(
  user: SessionUserDoc,
  sessionSecret: string
): Promise<StorageState> {
  const sessionUser = {
    id: user.providerId,
    provider: user.provider ?? 'test',
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    email: user.email ?? null,
    avatar: user.avatarUrl ?? null,
    role: user.role ?? 'player',
    accessToken: null,
    refreshToken: null,
    tokenIssuedAt: Math.floor(Date.now() / 1000),
  };
  const token = await new SignJWT({ user: sessionUser })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(new TextEncoder().encode(sessionSecret));
  return {
    cookies: [
      {
        name: 'cartyx_session',
        value: token,
        domain: 'localhost',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };
}

// Computed once in beforeAll.
let playerStorageState: Awaited<ReturnType<typeof mintStorageState>>;
let playerUserId: string;
let gmUserId: string;

/**
 * Set up the fixtures the tests need, from a fresh DB state, before EACH test
 * (the tests mutate persisted, shared state):
 *
 *  1. Ensure the campaign has our fixture quest (dev:seed seeds none). It is
 *     public so a player can open its window; a GM would see it regardless.
 *  2. Remove any quest windows a previous test/run left — SHARED windows on the
 *     campaign's screens AND PRIVATE windows on every player-state — so each
 *     test starts from zero quest windows.
 *  3. Pin BOTH the GM and the player to the clean, globalSetup-created "E2E Test
 *     Screen" by setting their player-state `activeScreenId`. This makes the GM
 *     push to that screen and the player view that same screen, deterministically.
 */
async function prepareState(): Promise<void> {
  const { mongoUri } = loadEnv();
  const seed = readSeed();
  const campaignId = new mongoose.Types.ObjectId(seed.campaignId);
  const screenId = new mongoose.Types.ObjectId(seed.screenId);

  await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB });
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('Mongo connection has no db handle');

    let quest = await db.collection('quests').findOne({ campaignId, name: E2E_QUEST_NAME });
    if (!quest) {
      const now = new Date();
      const { insertedId } = await db.collection('quests').insertOne({
        name: E2E_QUEST_NAME,
        type: '',
        status: 'active',
        publicInfo: '',
        privateInfo: '',
        isPublic: true,
        giver: null,
        parentQuestId: null,
        links: [],
        events: [],
        images: [],
        tags: [],
        campaignId,
        createdBy: new mongoose.Types.ObjectId(gmUserId),
        createdAt: now,
        updatedAt: now,
      });
      quest = { _id: insertedId };
    }
    const questId = quest._id;

    await db
      .collection('tabletopscreen')
      .updateMany(
        { campaignId },
        { $pull: { windows: { collection: 'quest', documentId: questId } } }
      );
    await db
      .collection('tabletopplayerstate')
      .updateMany(
        { campaignId },
        { $pull: { privateWindows: { collection: 'quest', documentId: questId } } }
      );

    // Pin both users to the clean E2E Test Screen (upsert their player-state).
    for (const userId of [gmUserId, playerUserId]) {
      await db
        .collection('tabletopplayerstate')
        .updateOne(
          { campaignId, userId: new mongoose.Types.ObjectId(userId) },
          { $set: { activeScreenId: screenId } },
          { upsert: true }
        );
    }
  } finally {
    await mongoose.disconnect();
  }
}

/** Open a fresh player browser context (a real non-GM campaign member). */
async function openPlayer(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: playerStorageState });
  const page = await ctx.newPage();
  return { ctx, page };
}

/**
 * Navigate to the tabletop tab, open the Wiki panel, drill into Quests, and
 * open the fixture quest card's overflow menu. Leaves the menu open.
 *
 * Everything is scoped to the Wiki inspector panel: the tabletop main area can
 * have floating windows (e.g. the seeded location) whose OWN in-window nav
 * includes a "Quests" tab, so an unscoped `button "Quests"` would be ambiguous.
 * And `exact: true` on the trigger matters because the QuestCard root is itself
 * role="button" and its accessible name absorbs the nested trigger's label plus
 * the quest's text — a substring match would hit the card (the DOM ancestor,
 * sorted first) and open the editor instead of the menu.
 */
async function openQuestMenu(page: Page, campaignUrl: string, screenId: string): Promise<void> {
  await page.goto(campaignUrl + '?tab=tabletop');
  // Explicitly select the target screen so the VIEW matches the screen the push
  // targets. TabletopView otherwise races: once its init effect defaults to the
  // first screen it ignores the persisted activeScreenId, so the GM could be
  // looking at a different screen than the one Push writes to.
  await openTabletopTab(page, screenId);
  await openWikiTab(page);

  const wiki = page.getByRole('tabpanel', { name: 'Wiki' });
  await wiki.getByRole('button', { name: 'Quests', exact: true }).click();

  const trigger = wiki.getByRole('button', { name: 'Quest actions', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await trigger.click();
}

test.describe('wiki card overflow menu', () => {
  // These tests mutate PERSISTED, SHARED state (the campaign's tabletop screens
  // and player-states) that both browsers read, so they must not run
  // concurrently; each resets that state first.
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const { mongoUri, sessionSecret } = loadEnv();
    const seed = readSeed();
    const campaignId = new mongoose.Types.ObjectId(seed.campaignId);

    await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB });
    try {
      const db = mongoose.connection.db;
      if (!db) throw new Error('Mongo connection has no db handle');
      const campaign = await db.collection('campaigns').findOne({ _id: campaignId });
      if (!campaign) throw new Error('Seeded campaign not found — run `npm run dev:seed`');
      gmUserId = String(campaign.gameMasterId);

      // Find a player-member whose user account can actually hold a session
      // (has a providerId). The other seeded players are label-only placeholders.
      const playerMembers = (campaign.members ?? []).filter(
        (m: { role?: string }) => m.role === 'player'
      );
      let playerUser: (SessionUserDoc & { _id: unknown }) | null = null;
      for (const member of playerMembers) {
        const userId = String((member as { userId: unknown }).userId);
        const u = await db
          .collection('users')
          .findOne({ _id: new mongoose.Types.ObjectId(userId) });
        if (u?.providerId) {
          playerUser = u as SessionUserDoc & { _id: unknown };
          break;
        }
      }
      if (!playerUser) {
        throw new Error(
          'No player-member with a providerId found on the seeded campaign — cannot mint a real player session.'
        );
      }
      playerUserId = String(playerUser._id);
      playerStorageState = await mintStorageState(playerUser, sessionSecret);
    } finally {
      await mongoose.disconnect();
    }
  });

  test.beforeEach(async () => {
    await prepareState();
  });

  // Symmetric cleanup. `prepareState` resets BEFORE each test, but without this
  // the suite would leave residue for OTHER specs sharing the dev DB: the last
  // test's quest windows (shared + private) and the `activeScreenId` we pinned
  // on the GM's and player's player-states. We scope the `$pull`s to THIS
  // fixture's questId exactly as `prepareState` does, so globalSetup's seeded
  // location window on the E2E screen is never touched.
  test.afterAll(async () => {
    const { mongoUri } = loadEnv();
    const seed = readSeed();
    const campaignId = new mongoose.Types.ObjectId(seed.campaignId);

    await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB });
    try {
      const db = mongoose.connection.db;
      if (!db) throw new Error('Mongo connection has no db handle');

      const quest = await db.collection('quests').findOne({ campaignId, name: E2E_QUEST_NAME });
      if (quest) {
        const questId = quest._id;
        await db
          .collection('tabletopscreen')
          .updateMany(
            { campaignId },
            { $pull: { windows: { collection: 'quest', documentId: questId } } }
          );
        await db
          .collection('tabletopplayerstate')
          .updateMany(
            { campaignId },
            { $pull: { privateWindows: { collection: 'quest', documentId: questId } } }
          );
      }

      // Unpin the activeScreenId we set in prepareState so we don't leave the GM
      // and player fixed to the E2E screen for whatever spec runs next.
      await db.collection('tabletopplayerstate').updateMany(
        {
          campaignId,
          userId: {
            $in: [gmUserId, playerUserId].map((id) => new mongoose.Types.ObjectId(id)),
          },
        },
        { $unset: { activeScreenId: '' } }
      );
    } finally {
      await mongoose.disconnect();
    }
  });

  test('Push to Tabletop is shared — a player sees the pushed window', async ({
    page,
    browser,
    campaignUrl,
    screenId,
  }) => {
    // GM-A pushes the fixture quest to the (shared) tabletop screen.
    await openQuestMenu(page, campaignUrl, screenId);
    await page.getByTestId('overflow-item-push').click();
    // It appears for the pusher immediately (local invalidation).
    await expect(page.getByTestId('quest-window').first()).toBeVisible({ timeout: 20_000 });

    // A real PLAYER, in their own browser, opens the SAME shared screen and sees
    // the same window — because Push writes to the screen doc every member reads.
    //
    // Push is NOT broadcast live (no client emits `window:show`), so the player
    // converges on the pushed window ONLY via a data fetch. If the player's
    // first fetch on navigation raced ahead of the GM's server `$push` landing,
    // the window simply isn't in that response yet — the product delivers it on
    // the NEXT fetch. So we reflect exactly that: reload to force a fresh fetch
    // and re-check, retrying until the window arrives. This removes the race
    // without weakening the assertion — the window MUST appear via refetch, and
    // it does not lean on the GM's own (local-cache) visibility as a signal.
    const { ctx, page: playerPage } = await openPlayer(browser);
    try {
      await playerPage.goto(campaignUrl + '?tab=tabletop');
      await expect(async () => {
        await playerPage.reload();
        await openTabletopTab(playerPage, screenId);
        await expect(playerPage.getByTestId('quest-window').first()).toBeVisible({
          timeout: 5_000,
        });
      }).toPass({ timeout: 30_000 });
    } finally {
      await ctx.close();
    }
  });

  test('Show on Tab is private — a player never sees the window', async ({
    page,
    browser,
    campaignUrl,
    screenId,
    locationName,
  }) => {
    // GM-A shows the fixture quest on their OWN tab (private player-state).
    await openQuestMenu(page, campaignUrl, screenId);
    await page.getByTestId('overflow-item-show-on-tab').click();
    // It appears for the caller…
    await expect(page.getByTestId('quest-window').first()).toBeVisible({ timeout: 20_000 });

    // …and never for anyone else: a player on the SAME screen in their own
    // browser does a full fetch of the shared screen + their own player-state,
    // neither of which holds the GM's private window — so it is simply not there.
    const { ctx, page: playerPage } = await openPlayer(browser);
    try {
      await playerPage.goto(campaignUrl + '?tab=tabletop');
      await openTabletopTab(playerPage, screenId);

      // POSITIVE CONTROL. Absence-of-quest-window is only meaningful if the
      // player's fetch of the shared screen actually succeeded AND rendered its
      // windows. So first assert the player DOES see the seeded location window
      // that globalSetup pins to this screen (a shared window, visible to every
      // member) — proving the fetch/render path worked. Without this, a
      // silently-failed fetch would render zero windows and make the negative
      // assertion below pass for the wrong reason.
      await expect(playerPage.getByRole('dialog', { name: locationName })).toBeVisible({
        timeout: 20_000,
      });

      // Now the negative assertion is trustworthy: the player's screen is fully
      // rendered, yet the GM's PRIVATE quest window (written only to the GM's own
      // player-state) is nowhere on it. Keep a short settle as a backstop so we
      // don't assert absence a frame before a late window could paint.
      await playerPage.waitForTimeout(2000);
      await expect(playerPage.getByTestId('quest-window')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('a private window survives a reload', async ({ page, campaignUrl, screenId }) => {
    await openQuestMenu(page, campaignUrl, screenId);
    await page.getByTestId('overflow-item-show-on-tab').click();
    await expect(page.getByTestId('quest-window').first()).toBeVisible({ timeout: 20_000 });

    // Private windows are persisted to the caller's player-state, so a full
    // reload must restore the window rather than lose it. Re-select the screen
    // after reload (TabletopView re-inits and may otherwise land on the first
    // screen), then assert the window is back.
    await page.reload();
    await openTabletopTab(page, screenId);
    await expect(page.getByTestId('quest-window').first()).toBeVisible({ timeout: 20_000 });
  });
});
