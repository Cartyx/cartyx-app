/**
 * E2E: dragging monsters onto the active map.
 *
 * Validates the full pipeline against the real app + database:
 *   1. A GM can drag MULTIPLE monsters onto the map and they become tokens.
 *   2. Monster tokens land on the GM-Private layer by default.
 *   3. A GM can move a monster token to the Public layer (right-click menu).
 *   4. Only a GM can move monster tokens — a player sees public ones but gets
 *      no layer-move menu, and never sees GM-Private tokens.
 *
 * Self-contained: provisions an isolated campaign (map + monsters + a player
 * member) directly in Mongo so it never depends on manually-seeded maps and
 * never collides with the other (skipped) tabletop specs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { SignJWT, decodeJwt } from 'jose';

// Serial: all tests share one provisioned campaign on a single worker. Without
// this, fullyParallel spreads tests across workers that each re-provision and
// delete the shared campaign by name, clobbering each other ("Campaign not
// found"). 90s timeout covers dev-server navigation + the reload fallback.
test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Monster Tokens';
const MAP_W = 1024;
const MAP_H = 1024;

// A tiny inline image so ActiveMapStage's <img> renders without hitting R2.
const DATA_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#243"/></svg>'
  );

interface Provisioned {
  campaignId: string;
  mapId: string;
  monsterIds: string[];
  playerCookie: string;
}

let client: MongoClient;
let provisioned: Provisioned;

async function provision(db: Db): Promise<Provisioned> {
  // Own the campaign as the EXACT user whose session globalSetup minted —
  // there can be more than one role:'gm' user, so `findOne({role:'gm'})` is
  // ambiguous and could pick a different GM than the active session, leaving
  // the page non-GM (no map stage). Decode the session's providerId instead.
  const storage = JSON.parse(
    readFileSync(join(process.cwd(), 'e2e', '.auth', 'storageState.json'), 'utf-8')
  ) as { cookies: Array<{ name: string; value: string }> };
  const sessionCookie = storage.cookies.find((c) => c.name === 'cartyx_session');
  if (!sessionCookie) throw new Error('No cartyx_session cookie in storageState — globalSetup?');
  const sessionProviderId = (decodeJwt(sessionCookie.value) as { user?: { id?: string } }).user?.id;
  if (!sessionProviderId) throw new Error('Could not decode session providerId');
  const gm = await db.collection('users').findOne({ providerId: sessionProviderId });
  if (!gm?.providerId) throw new Error('Session GM user not found in DB');

  // Dedicated player user (stable providerId) so we can mint its session.
  const playerProviderId = 'e2e-monster-player';
  await db.collection('users').updateOne(
    { providerId: playerProviderId },
    {
      $setOnInsert: {
        providerId: playerProviderId,
        provider: 'test',
        firstName: 'E2E',
        lastName: 'Player',
        email: 'e2e-monster-player@test.local',
        role: 'player',
        campaigns: [],
        createdAt: new Date(),
      },
      $set: { updatedAt: new Date() },
    },
    { upsert: true }
  );
  const player = await db.collection('users').findOne({ providerId: playerProviderId });
  if (!player) throw new Error('Failed to provision e2e player user');

  // Reconcile the mapToken unique index to the multi-instance shape (the app's
  // boot only adds indexes, never drops, so a stale unique index would block
  // a second monster of the same type). Idempotent.
  const tokenCol = db.collection('mapToken');
  await tokenCol.dropIndex('mapId_1_sourceCollection_1_sourceDocumentId_1').catch(() => {});
  await tokenCol
    .createIndex(
      { mapId: 1, sourceCollection: 1, sourceDocumentId: 1, instanceNumber: 1 },
      { unique: true }
    )
    .catch(() => {});

  const now = new Date();

  // Nuke any prior e2e campaign(s) + their data, however a previous run died.
  const stale = await db
    .collection('campaigns')
    .find({ name: CAMPAIGN_NAME }, { projection: { _id: 1 } })
    .toArray();
  if (stale.length) {
    const ids = stale.map((c) => c._id);
    await db.collection('mapToken').deleteMany({ campaignId: { $in: ids } });
    await db.collection('map').deleteMany({ campaignId: { $in: ids } });
    await db.collection('monsters').deleteMany({ campaignId: { $in: ids } });
    await db.collection('campaigns').deleteMany({ _id: { $in: ids } });
  }

  const campaignRes = await db.collection('campaigns').insertOne({
    gameMasterId: gm._id,
    name: CAMPAIGN_NAME,
    description: 'E2E isolated campaign for monster token drag tests.',
    status: 'active',
    // Random — campaigns.inviteCode is unique-indexed.
    inviteCode: 'e2e-' + Math.random().toString(36).slice(2, 12),
    maxPlayers: 6,
    members: [
      { userId: gm._id, role: 'gm', joinedAt: now },
      { userId: player._id, role: 'player', joinedAt: now },
    ],
    links: [],
    createdAt: now,
    updatedAt: now,
  });
  const campaignId = campaignRes.insertedId;

  // Two monsters in this campaign.
  await db.collection('monsters').deleteMany({ campaignId });
  const monsterDocs = [
    { name: 'E2E Goblin', size: 'small', color: '#22c55e' },
    { name: 'E2E Ogre', size: 'large', color: '#ef4444' },
  ].map((m) => ({
    campaignId,
    createdBy: gm._id,
    name: m.name,
    size: m.size,
    type: 'humanoid',
    subtype: '',
    alignment: 'neutral evil',
    cr: { value: 1, xp: 200, proficiencyBonus: 2 },
    picture: DATA_IMG,
    pictureCrop: null,
    color: m.color,
    tags: [],
    createdAt: now,
    updatedAt: now,
  }));
  const monsterRes = await db.collection('monsters').insertMany(monsterDocs);
  const monsterIds = Object.values(monsterRes.insertedIds).map((id) => String(id));

  // An active map for the campaign.
  await db.collection('map').deleteMany({ campaignId });
  const mapRes = await db.collection('map').insertOne({
    campaignId,
    createdBy: gm._id,
    name: 'E2E Map',
    tags: [],
    imageKey: 'e2e/monster-map.svg',
    imageUrl: DATA_IMG,
    imageWidth: MAP_W,
    imageHeight: MAP_H,
    locationId: null,
    scale: { gridType: 'square', pixelsPerSquare: 50, feetPerSquare: 5 },
    gridOverlay: { enabled: false, color: '#ffffff66' },
    createdAt: now,
    updatedAt: now,
  });
  const mapId = mapRes.insertedId;
  await db
    .collection('campaigns')
    .updateOne({ _id: campaignId }, { $set: { activeMapId: mapId, updatedAt: now } });

  // Clear any stale tokens for this map.
  await db.collection('mapToken').deleteMany({ mapId });

  // Mint a player session cookie (mirrors app/server/session.ts shape).
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not set');
  const token = await new SignJWT({
    user: {
      id: playerProviderId,
      provider: 'test',
      name: 'E2E Player',
      email: 'e2e-monster-player@test.local',
      avatar: null,
      role: 'player',
      accessToken: null,
      refreshToken: null,
      tokenIssuedAt: Math.floor(Date.now() / 1000),
    },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(new TextEncoder().encode(secret));

  return { campaignId: String(campaignId), mapId: String(mapId), monsterIds, playerCookie: token };
}

/** Dispatch a real HTML5 drop of a wiki document onto the active map stage. */
async function dropOnMap(
  page: import('@playwright/test').Page,
  payload: { collection: string; documentId: string; title: string },
  offset: { dx: number; dy: number },
  opts: { ctrl?: boolean } = {}
): Promise<void> {
  await page.evaluate(
    ({ payload, offset, opts }) => {
      const stage = document.querySelector(
        '[data-testid="active-map-stage"]'
      ) as HTMLElement | null;
      if (!stage) throw new Error('active-map-stage not found');
      const rect = stage.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2 + offset.dx;
      const clientY = rect.top + rect.height / 2 + offset.dy;
      const dt = new DataTransfer();
      dt.setData('application/x-cartyx-document', JSON.stringify(payload));
      for (const type of ['dragenter', 'dragover', 'drop'] as const) {
        const event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          ctrlKey: opts.ctrl ?? false,
        });
        // Chromium's DragEvent constructor ignores the dataTransfer init member,
        // so force it on explicitly — otherwise handleDrop sees a null transfer.
        Object.defineProperty(event, 'dataTransfer', { value: dt });
        stage.dispatchEvent(event);
      }
    },
    { payload, offset, opts }
  );
}

test.beforeAll(async () => {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* env may be set externally */
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  client = new MongoClient(uri);
  await client.connect();
  const db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
  provisioned = await provision(db);
});

test.afterAll(async () => {
  if (!client) return;
  if (provisioned?.campaignId) {
    const db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
    const cid = new ObjectId(provisioned.campaignId);
    await db.collection('mapToken').deleteMany({ mapId: new ObjectId(provisioned.mapId) });
    await db.collection('map').deleteMany({ campaignId: cid });
    await db.collection('monsters').deleteMany({ campaignId: cid });
    await db.collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

test.beforeEach(async () => {
  // Isolate each test — start with no tokens on the shared map.
  const db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
  await db.collection('mapToken').deleteMany({ mapId: new ObjectId(provisioned.mapId) });
});

/**
 * Open the tabletop as the (default, GM) page and wait until the map drop
 * handler is actually live. A `dragover` is harmless (creates nothing) and
 * flips the stage's drag-over ring once handleDragOver is attached — a
 * reliable readiness signal that avoids dropping into a not-yet-interactive
 * stage (which would silently no-op).
 */
/** Navigate to the tabletop and wait for the active map; reload once if a
 *  transient load leaves the stage unrendered. */
async function gotoTabletopStage(page: import('@playwright/test').Page): Promise<void> {
  const url = `/campaigns/${provisioned.campaignId}/play?tab=tabletop`;
  await page.goto(url);
  const stage = page.getByTestId('active-map-stage');
  try {
    await expect(stage).toBeVisible({ timeout: 20000 });
  } catch {
    await page.reload();
    await expect(stage).toBeVisible({ timeout: 20000 });
  }
}

async function openTabletopAsGm(page: import('@playwright/test').Page): Promise<void> {
  await gotoTabletopStage(page);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const stage = document.querySelector('[data-testid="active-map-stage"]');
          if (!stage) return false;
          // The handler's setIsDragOverMap re-render is async, so a dragover
          // dispatched this tick only shows the ring on a LATER tick. Check for
          // the ring first (from a prior poll iteration), then dispatch again.
          if (stage.className.includes('ring-emerald')) return true;
          const rect = stage.getBoundingClientRect();
          const dt = new DataTransfer();
          dt.setData(
            'application/x-cartyx-document',
            JSON.stringify({ collection: 'monster', documentId: 'probe', title: 'probe' })
          );
          const ev = new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          });
          Object.defineProperty(ev, 'dataTransfer', { value: dt });
          stage.dispatchEvent(ev);
          return false;
        }),
      { timeout: 15000, intervals: [100, 150, 200, 300, 500] }
    )
    .toBe(true);
}

test('GM drags multiple monsters → GM-Private tokens, movable to Public; players cannot move them', async ({
  page,
  context,
}) => {
  const tabletopUrl = `/campaigns/${provisioned.campaignId}/play?tab=tabletop`;
  await openTabletopAsGm(page);

  // 1 + 2: drag both monsters onto the map → two GM-Private tokens.
  await dropOnMap(
    page,
    { collection: 'monster', documentId: provisioned.monsterIds[0], title: 'E2E Goblin' },
    { dx: -120, dy: -60 }
  );
  await dropOnMap(
    page,
    { collection: 'monster', documentId: provisioned.monsterIds[1], title: 'E2E Ogre' },
    { dx: 120, dy: 60 }
  );

  await expect(page.getByTestId('map-token')).toHaveCount(2, { timeout: 30000 });
  await expect(page.locator('[data-testid="map-token"][data-layer="gm-private"]')).toHaveCount(2);

  // 3: move the first monster token to the Public layer via right-click menu.
  const firstToken = page.locator('[data-testid="map-token"]').first();
  await firstToken.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Public Tokens' }).click();

  await expect(page.locator('[data-testid="map-token"][data-layer="public"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="map-token"][data-layer="gm-private"]')).toHaveCount(1);

  // 4: a player sees only the public monster, never the GM-Private one, and
  // gets no layer-move menu (GM-only).
  const playerContext = await context.browser()!.newContext();
  await playerContext.addCookies([
    {
      name: 'cartyx_session',
      value: provisioned.playerCookie,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
  const playerPage = await playerContext.newPage();
  await playerPage.goto(tabletopUrl);
  try {
    await expect(playerPage.getByTestId('active-map-stage')).toBeVisible({ timeout: 20000 });
  } catch {
    await playerPage.reload();
    await expect(playerPage.getByTestId('active-map-stage')).toBeVisible({ timeout: 25000 });
  }

  // Only the public token is visible to the player.
  await expect(playerPage.getByTestId('map-token')).toHaveCount(1);
  await expect(playerPage.locator('[data-testid="map-token"][data-layer="public"]')).toHaveCount(1);

  // Right-click yields no move menu for a non-GM.
  await playerPage.locator('[data-testid="map-token"]').first().click({ button: 'right' });
  await expect(playerPage.getByRole('menuitem', { name: 'Public Tokens' })).toHaveCount(0);
  await expect(playerPage.getByRole('menuitem', { name: 'GM-Private Tokens' })).toHaveCount(0);

  await playerContext.close();
});

test('dragging the same monster repeatedly adds letter suffixes (A, B, C), each independent', async ({
  page,
}) => {
  await openTabletopAsGm(page);

  const goblinId = provisioned.monsterIds[0];
  for (let i = 0; i < 3; i++) {
    await dropOnMap(
      page,
      { collection: 'monster', documentId: goblinId, title: 'E2E Goblin' },
      { dx: -150 + i * 120, dy: -40 }
    );
    // Sequential so instance numbers are assigned deterministically.
    await expect(page.getByTestId('map-token')).toHaveCount(i + 1, { timeout: 15000 });
  }

  // Three independent tokens, distinct ids, labelled A / B / C.
  await expect(page.getByTestId('map-token')).toHaveCount(3);
  for (const letter of ['A', 'B', 'C']) {
    await expect(page.getByText(`E2E Goblin ${letter}`, { exact: true })).toBeVisible();
  }
  const ids = await page
    .locator('[data-testid="map-token"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-token-id')));
  expect(new Set(ids).size).toBe(3);
});

test('ctrl-drag opens a 1–20 counter and scatters that many lettered monster tokens', async ({
  page,
}) => {
  await openTabletopAsGm(page);

  await dropOnMap(
    page,
    { collection: 'monster', documentId: provisioned.monsterIds[0], title: 'E2E Goblin' },
    { dx: 0, dy: 0 },
    { ctrl: true }
  );

  // Dialog appears with a counter starting at 1.
  const dialog = page.getByTestId('monster-batch-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('monster-batch-count')).toHaveText('1');

  // Bump to 4 and place.
  for (let i = 0; i < 3; i++) await page.getByTestId('monster-batch-increment').click();
  await expect(page.getByTestId('monster-batch-count')).toHaveText('4');
  await page.getByTestId('monster-batch-place').click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('map-token')).toHaveCount(4, { timeout: 30000 });
  await expect(page.locator('[data-testid="map-token"][data-layer="gm-private"]')).toHaveCount(4);
  for (const letter of ['A', 'B', 'C', 'D']) {
    await expect(page.getByText(`E2E Goblin ${letter}`, { exact: true })).toBeVisible();
  }
});

test('the counter clamps to the 1–20 range', async ({ page }) => {
  await openTabletopAsGm(page);

  await dropOnMap(
    page,
    { collection: 'monster', documentId: provisioned.monsterIds[0], title: 'E2E Goblin' },
    { dx: 0, dy: 0 },
    { ctrl: true }
  );
  await expect(page.getByTestId('monster-batch-dialog')).toBeVisible();

  // Starts at 1 with the decrement disabled (can't go below 1).
  await expect(page.getByTestId('monster-batch-count')).toHaveText('1');
  await expect(page.getByTestId('monster-batch-decrement')).toBeDisabled();

  // Can't exceed 20 — clicking far past 20 caps the count, increment disabled.
  for (let i = 0; i < 25; i++) {
    if (await page.getByTestId('monster-batch-increment').isEnabled()) {
      await page.getByTestId('monster-batch-increment').click();
    }
  }
  await expect(page.getByTestId('monster-batch-count')).toHaveText('20');
  await expect(page.getByTestId('monster-batch-increment')).toBeDisabled();
});

test('placed monster tokens move independently', async ({ page }) => {
  await openTabletopAsGm(page);

  const goblinId = provisioned.monsterIds[0];
  await dropOnMap(
    page,
    { collection: 'monster', documentId: goblinId, title: 'E2E Goblin' },
    { dx: -160, dy: 0 }
  );
  await expect(page.getByTestId('map-token')).toHaveCount(1, { timeout: 30000 });
  await dropOnMap(
    page,
    { collection: 'monster', documentId: goblinId, title: 'E2E Goblin' },
    { dx: 160, dy: 0 }
  );
  await expect(page.getByTestId('map-token')).toHaveCount(2, { timeout: 30000 });

  const tokenA = page.locator('[data-testid="map-token"]').nth(0);
  const tokenB = page.locator('[data-testid="map-token"]').nth(1);
  const beforeA = await tokenA.boundingBox();
  const beforeB = await tokenB.boundingBox();
  if (!beforeA || !beforeB) throw new Error('token boxes unavailable');

  // Pointer-drag token A by a clear delta; token B must not follow.
  await page.mouse.move(beforeA.x + beforeA.width / 2, beforeA.y + beforeA.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeA.x + beforeA.width / 2 + 180, beforeA.y + beforeA.height / 2 + 60, {
    steps: 8,
  });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const box = await tokenA.boundingBox();
      return box ? box.x : beforeA.x;
    })
    .toBeGreaterThan(beforeA.x + 80);

  const afterB = await tokenB.boundingBox();
  expect(Math.abs((afterB?.x ?? 0) - beforeB.x)).toBeLessThan(15);
});
