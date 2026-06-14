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
import { test, expect } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { SignJWT } from 'jose';

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
  const gm = await db.collection('users').findOne({ role: 'gm' });
  if (!gm?.providerId) throw new Error('No GM user with providerId — run `npm run dev:seed`.');

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

  const now = new Date();

  // Idempotent campaign keyed by name + GM.
  await db.collection('campaigns').deleteMany({ name: CAMPAIGN_NAME, gameMasterId: gm._id });
  const campaignRes = await db.collection('campaigns').insertOne({
    gameMasterId: gm._id,
    name: CAMPAIGN_NAME,
    description: 'E2E isolated campaign for monster token drag tests.',
    status: 'active',
    inviteCode: 'e2emon' + Math.floor(now.getTime() % 100000),
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
  offset: { dx: number; dy: number }
): Promise<void> {
  await page.evaluate(
    ({ payload, offset }) => {
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
        const event = new DragEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
        // Chromium's DragEvent constructor ignores the dataTransfer init member,
        // so force it on explicitly — otherwise handleDrop sees a null transfer.
        Object.defineProperty(event, 'dataTransfer', { value: dt });
        stage.dispatchEvent(event);
      }
    },
    { payload, offset }
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
  if (client) {
    const db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
    const cid = new ObjectId(provisioned.campaignId);
    await db.collection('mapToken').deleteMany({ mapId: new ObjectId(provisioned.mapId) });
    await db.collection('map').deleteMany({ campaignId: cid });
    await db.collection('monsters').deleteMany({ campaignId: cid });
    await db.collection('campaigns').deleteMany({ _id: cid });
    await client.close();
  }
});

test('GM drags multiple monsters → GM-Private tokens, movable to Public; players cannot move them', async ({
  page,
  context,
}) => {
  const tabletopUrl = `/campaigns/${provisioned.campaignId}/play?tab=tabletop`;
  await page.goto(tabletopUrl);
  await expect(page.getByTestId('active-map-stage')).toBeVisible({ timeout: 15000 });

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

  await expect(page.getByTestId('map-token')).toHaveCount(2, { timeout: 15000 });
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
  await expect(playerPage.getByTestId('active-map-stage')).toBeVisible({ timeout: 15000 });

  // Only the public token is visible to the player.
  await expect(playerPage.getByTestId('map-token')).toHaveCount(1);
  await expect(playerPage.locator('[data-testid="map-token"][data-layer="public"]')).toHaveCount(1);

  // Right-click yields no move menu for a non-GM.
  await playerPage.locator('[data-testid="map-token"]').first().click({ button: 'right' });
  await expect(playerPage.getByRole('menuitem', { name: 'Public Tokens' })).toHaveCount(0);
  await expect(playerPage.getByRole('menuitem', { name: 'GM-Private Tokens' })).toHaveCount(0);

  await playerContext.close();
});
