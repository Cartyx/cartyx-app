/**
 * E2E: the measurement (ruler) tool on the active map.
 *
 * Covers every described behavior:
 *  - Selecting the ruler tool switches the cursor to a crosshair.
 *  - Clicking an empty map point drops an anchor; moving the mouse draws a line
 *    with a live distance in feet (derived from the map's scale).
 *  - Clicking one token then another draws a fixed line between them and shows
 *    the exact distance (500px ÷ 50 px/sq × 5 ft/sq = 50 ft).
 *  - Switching to another tool removes the measurement.
 *  - Clicking a new map point relocates the anchor (only one measurement).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Measurement';
const DATA_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#222"/></svg>'
  );

interface Provisioned {
  campaignId: string;
  tokenAId: string;
  tokenBId: string;
}

let client: MongoClient;
let provisioned: Provisioned;

function tokenDoc(
  campaignId: ObjectId,
  mapId: ObjectId,
  gmId: ObjectId,
  label: string,
  x: number,
  y: number,
  now: Date
) {
  return {
    mapId,
    campaignId,
    sourceCollection: 'monster',
    sourceDocumentId: new ObjectId(),
    ownerUserId: null,
    x,
    y,
    sizeSquares: 1,
    instanceNumber: null,
    color: '#22c55e',
    label,
    imageUrl: '',
    labelVisible: true,
    hiddenFromPlayers: false,
    zIndex: 0,
    createdBy: gmId,
    createdAt: now,
    updatedAt: now,
  };
}

async function provision(db: Db): Promise<Provisioned> {
  const storage = JSON.parse(
    readFileSync(join(process.cwd(), 'e2e', '.auth', 'storageState.json'), 'utf-8')
  ) as { cookies: Array<{ name: string; value: string }> };
  const cookie = storage.cookies.find((c) => c.name === 'cartyx_session');
  if (!cookie) throw new Error('No cartyx_session cookie — globalSetup did not run?');
  const providerId = (decodeJwt(cookie.value) as { user?: { id?: string } }).user?.id;
  const gm = await db.collection('users').findOne({ providerId });
  if (!gm?._id) throw new Error('Session GM user not found');

  const stale = await db
    .collection('campaigns')
    .find({ name: CAMPAIGN_NAME }, { projection: { _id: 1 } })
    .toArray();
  if (stale.length) {
    const ids = stale.map((c) => c._id);
    await db.collection('mapToken').deleteMany({ campaignId: { $in: ids } });
    await db.collection('tabletopscreen').deleteMany({ campaignId: { $in: ids } });
    await db.collection('map').deleteMany({ campaignId: { $in: ids } });
    await db.collection('campaigns').deleteMany({ _id: { $in: ids } });
  }

  const now = new Date();
  const campaignId = (
    await db.collection('campaigns').insertOne({
      gameMasterId: gm._id,
      name: CAMPAIGN_NAME,
      description: 'E2E measurement tool test.',
      status: 'active',
      inviteCode: 'e2e-' + Math.random().toString(36).slice(2, 12),
      maxPlayers: 6,
      members: [{ userId: gm._id, role: 'gm', joinedAt: now }],
      links: [],
      createdAt: now,
      updatedAt: now,
    })
  ).insertedId;

  // 50 px per square, 5 ft per square → 10 px/ft. Not referenced in app code
  // as a constant; the tool reads it from the map.
  const mapId = (
    await db.collection('map').insertOne({
      campaignId,
      createdBy: gm._id,
      name: 'E2E Map',
      tags: [],
      imageKey: 'e2e/measure-map.svg',
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

  await db.collection('tabletopscreen').insertOne({
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

  // Two tokens 500 image-px apart vertically → 50 ft.
  const docA = tokenDoc(campaignId, mapId, gm._id, 'A', 200, 200, now);
  const docB = tokenDoc(campaignId, mapId, gm._id, 'B', 200, 700, now);
  const tokenAId = (await db.collection('mapToken').insertOne(docA)).insertedId;
  const tokenBId = (await db.collection('mapToken').insertOne(docB)).insertedId;

  return {
    campaignId: String(campaignId),
    tokenAId: String(tokenAId),
    tokenBId: String(tokenBId),
  };
}

async function gotoTabletop(page: import('@playwright/test').Page) {
  await page.goto(`/campaigns/${provisioned.campaignId}/play?tab=tabletop`);
  const stage = page.getByTestId('active-map-stage');
  try {
    await expect(stage).toBeVisible({ timeout: 20000 });
  } catch {
    await page.reload();
    await expect(stage).toBeVisible({ timeout: 20000 });
  }
  await expect(page.getByTestId('map-token')).toHaveCount(2, { timeout: 15000 });
}

async function selectRuler(page: import('@playwright/test').Page) {
  await page.getByTestId('tool-ruler').click();
  await expect(page.getByTestId('tool-window-ruler')).toBeVisible();
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
    await db.collection('mapToken').deleteMany({ campaignId: cid });
    await db.collection('tabletopscreen').deleteMany({ campaignId: cid });
    await db.collection('map').deleteMany({ campaignId: cid });
    await db.collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

test('selecting the ruler tool shows a crosshair cursor', async ({ page }) => {
  await gotoTabletop(page);
  await selectRuler(page);
  await expect
    .poll(async () =>
      page.getByTestId('active-map-stage').evaluate((el) => getComputedStyle(el).cursor)
    )
    .toBe('crosshair');
});

test('clicking a point then moving draws a line with a live distance in feet', async ({ page }) => {
  await gotoTabletop(page);
  await selectRuler(page);

  const box = (await page.getByTestId('active-map-stage').boundingBox())!;
  // An empty spot on the right (tokens are on the left third).
  const px = box.x + box.width * 0.75;
  const py = box.y + box.height * 0.4;
  await page.mouse.click(px, py);

  await expect(page.getByTestId('ruler-anchor')).toBeVisible();

  // Move away → a line + a positive distance.
  await page.mouse.move(px - 200, py + 120, { steps: 6 });
  await expect(page.getByTestId('ruler-line')).toBeVisible();
  const label = page.getByTestId('ruler-distance');
  await expect(label).toBeVisible();
  await expect
    .poll(async () => parseInt((await label.textContent())?.replace(/[^0-9]/g, '') || '0', 10))
    .toBeGreaterThan(0);
});

test('measuring between two tokens shows the exact scaled distance', async ({ page }) => {
  await gotoTabletop(page);
  await selectRuler(page);

  await page.locator(`[data-token-id="${provisioned.tokenAId}"]`).click();
  await page.locator(`[data-token-id="${provisioned.tokenBId}"]`).click();

  // 500 image px / 50 px-per-square * 5 ft-per-square = 50 ft.
  await expect(page.getByTestId('ruler-distance')).toHaveText('50 ft');
});

test('switching to another tool removes the measurement', async ({ page }) => {
  await gotoTabletop(page);
  await selectRuler(page);

  const box = (await page.getByTestId('active-map-stage').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.4);
  await expect(page.getByTestId('ruler-anchor')).toBeVisible();

  await page.getByTestId('tool-pointer').click();
  await expect(page.getByTestId('ruler-line')).toHaveCount(0);
  await expect(page.getByTestId('ruler-distance')).toHaveCount(0);
});

test('clicking a new point relocates the single measurement anchor', async ({ page }) => {
  await gotoTabletop(page);
  await selectRuler(page);

  const box = (await page.getByTestId('active-map-stage').boundingBox())!;
  const first = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.3 };
  const second = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.7 };

  await page.mouse.click(first.x, first.y);
  const anchor = page.getByTestId('ruler-anchor');
  await expect(anchor).toBeVisible();
  const firstBox = (await anchor.boundingBox())!;

  await page.mouse.click(second.x, second.y);
  // Still exactly one measurement, and the anchor moved to the new point.
  await expect(anchor).toHaveCount(1);
  await expect
    .poll(async () => (await anchor.boundingBox())?.y ?? firstBox.y)
    .toBeGreaterThan(firstBox.y + 50);
});
