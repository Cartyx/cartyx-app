/**
 * E2E for drawing permissions — drawings are GM-only.
 *  - A GM sees drawings and has the drawing tool + controls.
 *  - A player NEVER sees drawings (the server returns none) and has no drawing
 *    tool / drawings toggle — but still sees the active map itself.
 *
 * Drawings are GM-only end-to-end: `listMapDrawings` returns an empty list to
 * non-GMs and create/update/delete/clear are GM-gated server-side; the client
 * additionally hides the drawing tool + controls for non-GMs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { SignJWT, decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Drawing Permissions';
const PLAYER_PROVIDER_ID = 'e2e-drawing-player';
const DATA_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#222"/></svg>'
  );

interface Provisioned {
  campaignId: string;
  mapId: string;
  gmId: string;
  playerCookie: string;
}

let client: MongoClient;
let provisioned: Provisioned;

function db(): Db {
  return process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
}

function drawings() {
  return db().collection('mapDrawing');
}

async function provision(database: Db): Promise<Provisioned> {
  const storage = JSON.parse(
    readFileSync(join(process.cwd(), 'e2e', '.auth', 'storageState.json'), 'utf-8')
  ) as { cookies: Array<{ name: string; value: string }> };
  const cookie = storage.cookies.find((c) => c.name === 'cartyx_session');
  if (!cookie) throw new Error('No cartyx_session cookie — globalSetup did not run?');
  const providerId = (decodeJwt(cookie.value) as { user?: { id?: string } }).user?.id;
  const gm = await database.collection('users').findOne({ providerId });
  if (!gm?._id) throw new Error('Session GM user not found');

  const now = new Date();

  // A dedicated player member (stable providerId) so we can mint its session.
  await database.collection('users').updateOne(
    { providerId: PLAYER_PROVIDER_ID },
    {
      $setOnInsert: {
        provider: 'e2e',
        providerId: PLAYER_PROVIDER_ID,
        role: 'player',
        firstName: 'E2E',
        lastName: 'Player',
        email: 'e2e-drawing-player@test.local',
        createdAt: now,
      },
    },
    { upsert: true }
  );
  const player = await database.collection('users').findOne({ providerId: PLAYER_PROVIDER_ID });
  if (!player) throw new Error('Failed to provision e2e player user');

  const campaignId = (
    await database.collection('campaigns').insertOne({
      gameMasterId: gm._id,
      name: CAMPAIGN_NAME,
      description: 'E2E drawing permissions test.',
      status: 'active',
      inviteCode: 'e2e-' + Math.random().toString(36).slice(2, 12),
      maxPlayers: 6,
      members: [
        { userId: gm._id, role: 'gm', joinedAt: now },
        { userId: player._id, role: 'player', joinedAt: now },
      ],
      links: [],
      createdAt: now,
      updatedAt: now,
    })
  ).insertedId;

  const mapId = (
    await database.collection('map').insertOne({
      campaignId,
      createdBy: gm._id,
      name: 'E2E Map',
      tags: [],
      imageKey: 'e2e/draw-perm-map.svg',
      imageUrl: DATA_IMG,
      imageWidth: 1024,
      imageHeight: 1024,
      locationId: null,
      scale: { gridType: 'square', pixelsPerSquare: 50, feetPerSquare: 5 },
      gridOverlay: { enabled: false, color: '#ffffff66' },
      createdAt: now,
      updatedAt: now,
    })
  ).insertedId;

  await database.collection('tabletopscreen').insertOne({
    campaignId,
    name: 'Map',
    tabOrder: 0,
    createdBy: gm._id,
    mode: 'grid',
    gridStyle: 'dark',
    gridSize: 50,
    gridVisible: true,
    gridScale: 5,
    locationId: null,
    battleMapImage: null,
    activeMapId: mapId,
    windows: [],
    createdAt: now,
    updatedAt: now,
  });

  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not set');
  const playerCookie = await new SignJWT({
    user: {
      id: PLAYER_PROVIDER_ID,
      provider: 'test',
      name: 'E2E Player',
      email: 'e2e-drawing-player@test.local',
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

  return {
    campaignId: String(campaignId),
    mapId: String(mapId),
    gmId: String(gm._id),
    playerCookie,
  };
}

/** Seed a GM-authored rectangle drawing on the map. */
async function seedDrawing() {
  const now = new Date();
  await drawings().insertOne({
    mapId: new ObjectId(provisioned.mapId),
    campaignId: new ObjectId(provisioned.campaignId),
    kind: 'rect',
    color: '#e74c3c',
    strokeWidth: 4,
    filled: true,
    points: [],
    x: 300,
    y: 300,
    width: 200,
    height: 160,
    createdBy: new ObjectId(provisioned.gmId),
    createdAt: now,
    updatedAt: now,
  });
}

async function waitForStage(page: Page) {
  const stage = page.getByTestId('active-map-stage');
  try {
    await expect(stage).toBeVisible({ timeout: 20000 });
  } catch {
    await page.reload();
    await expect(stage).toBeVisible({ timeout: 25000 });
  }
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
  provisioned = await provision(db());
});

test.afterEach(async () => {
  if (provisioned?.mapId) {
    await drawings().deleteMany({ mapId: new ObjectId(provisioned.mapId) });
  }
});

test.afterAll(async () => {
  if (!client) return;
  if (provisioned?.campaignId) {
    const cid = new ObjectId(provisioned.campaignId);
    await drawings().deleteMany({ campaignId: cid });
    await db().collection('tabletopscreen').deleteMany({ campaignId: cid });
    await db().collection('map').deleteMany({ campaignId: cid });
    await db().collection('campaigns').deleteMany({ _id: cid });
  }
  await db().collection('users').deleteOne({ providerId: PLAYER_PROVIDER_ID });
  await client.close();
});

test('a GM sees the drawing and has the drawing tool', async ({ page }) => {
  await seedDrawing();
  await page.goto(`/campaigns/${provisioned.campaignId}/play?tab=tabletop`);
  await waitForStage(page);

  await expect(page.getByTestId('map-drawing')).toHaveCount(1);
  await expect(page.getByTestId('tool-drawing')).toBeVisible();
  await expect(page.getByTestId('map-drawings-toggle')).toBeVisible();
});

test('a player never sees drawings and has no drawing tool, but still sees the map', async ({
  browser,
}) => {
  await seedDrawing();
  // Sanity: the drawing exists in the DB.
  await expect
    .poll(() => drawings().countDocuments({ mapId: new ObjectId(provisioned.mapId) }))
    .toBe(1);

  const playerContext = await browser.newContext();
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
  await playerPage.goto(`/campaigns/${provisioned.campaignId}/play?tab=tabletop`);
  await waitForStage(playerPage);

  // The player still sees the active map…
  await expect(playerPage.getByTestId('active-map-stage')).toBeVisible();
  // …but never the GM's drawing (server returns none for non-GMs)…
  await expect(playerPage.getByTestId('map-drawing')).toHaveCount(0);
  await expect(playerPage.getByTestId('map-drawing-layer')).toHaveCount(0);
  // …and has no drawing tool or drawing controls.
  await expect(playerPage.getByTestId('tool-drawing')).toHaveCount(0);
  await expect(playerPage.getByTestId('map-drawings-toggle')).toHaveCount(0);
  await expect(playerPage.getByTestId('map-clear-drawings')).toHaveCount(0);

  // The drawing was not deleted — it's just hidden from the player.
  await expect
    .poll(() => drawings().countDocuments({ mapId: new ObjectId(provisioned.mapId) }))
    .toBe(1);

  await playerContext.close();
});
