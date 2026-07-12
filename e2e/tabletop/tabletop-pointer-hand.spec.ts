/**
 * E2E: pointer selects/moves objects, hand pans (+ middle-mouse / Space pan).
 *
 * Covers the pan-vs-select split introduced in Task 6:
 *  - The pointer tool no longer pans on a background drag (it only
 *    deselects); it still lets you drag a map text to move it.
 *  - The hand tool pans on a background drag, same as before.
 *  - Holding Space pans the map even while the pointer tool is active.
 *
 * Provisioning mirrors tabletop-measurement.spec.ts (one map + one token);
 * this spec also seeds one map text (GM-authored, movable) directly in Mongo
 * so the "text is movable with pointer" case doesn't depend on the text tool.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Pointer Hand';
const DATA_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#222"/></svg>'
  );

interface Provisioned {
  campaignId: string;
  mapId: string;
  tokenId: string;
  textId: string;
}

let client: MongoClient;
let provisioned: Provisioned;

function db(): Db {
  return process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
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

  const stale = await database
    .collection('campaigns')
    .find({ name: CAMPAIGN_NAME }, { projection: { _id: 1 } })
    .toArray();
  if (stale.length) {
    const ids = stale.map((c) => c._id);
    await database.collection('mapToken').deleteMany({ campaignId: { $in: ids } });
    await database.collection('mapText').deleteMany({ campaignId: { $in: ids } });
    await database.collection('tabletopscreen').deleteMany({ campaignId: { $in: ids } });
    await database.collection('map').deleteMany({ campaignId: { $in: ids } });
    await database.collection('campaigns').deleteMany({ _id: { $in: ids } });
  }

  const now = new Date();
  const campaignId = (
    await database.collection('campaigns').insertOne({
      gameMasterId: gm._id,
      name: CAMPAIGN_NAME,
      description: 'E2E pointer/hand tool test.',
      status: 'active',
      inviteCode: 'e2e-' + Math.random().toString(36).slice(2, 12),
      maxPlayers: 6,
      members: [{ userId: gm._id, role: 'gm', joinedAt: now }],
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
      imageKey: 'e2e/pointer-hand-map.svg',
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

  const tokenId = (
    await database.collection('mapToken').insertOne({
      mapId,
      campaignId,
      sourceCollection: 'monster',
      sourceDocumentId: new ObjectId(),
      ownerUserId: null,
      x: 200,
      y: 200,
      sizeSquares: 1,
      instanceNumber: null,
      color: '#22c55e',
      label: 'A',
      imageUrl: '',
      labelVisible: true,
      hiddenFromPlayers: false,
      zIndex: 0,
      createdBy: gm._id,
      createdAt: now,
      updatedAt: now,
    })
  ).insertedId;

  // A GM-authored text well clear of the token, so the pointer tool can grab
  // and drag it without touching anything else on the map.
  const textId = (
    await database.collection('mapText').insertOne({
      mapId,
      campaignId,
      x: 700,
      y: 700,
      text: 'Movable label',
      color: '#fbbf24',
      fontSize: 24,
      createdBy: gm._id,
      createdAt: now,
      updatedAt: now,
    })
  ).insertedId;

  return {
    campaignId: String(campaignId),
    mapId: String(mapId),
    tokenId: String(tokenId),
    textId: String(textId),
  };
}

async function gotoTabletop(page: Page) {
  await page.goto(`/campaigns/${provisioned.campaignId}/play?tab=tabletop`);
  const stage = page.getByTestId('active-map-stage');
  try {
    await expect(stage).toBeVisible({ timeout: 20000 });
  } catch {
    await page.reload();
    await expect(stage).toBeVisible({ timeout: 20000 });
  }
  await expect(page.getByTestId('map-token')).toHaveCount(1, { timeout: 15000 });
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

test.afterAll(async () => {
  if (!client) return;
  if (provisioned?.campaignId) {
    const cid = new ObjectId(provisioned.campaignId);
    await db().collection('mapToken').deleteMany({ campaignId: cid });
    await db().collection('mapText').deleteMany({ campaignId: cid });
    await db().collection('tabletopscreen').deleteMany({ campaignId: cid });
    await db().collection('map').deleteMany({ campaignId: cid });
    await db().collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

test('pointer tool does not pan the map', async ({ page }) => {
  await gotoTabletop(page);
  const mapImg = page.locator('[data-testid="active-map-stage"] img');
  await page.getByTestId('tool-pointer').click();
  const before = await mapImg.boundingBox();
  const stage = page.getByTestId('active-map-stage');
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 100, { steps: 5 });
  await page.mouse.up();
  const after = await mapImg.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 0);
  expect(after!.y).toBeCloseTo(before!.y, 0);
});

test('hand tool pans the map', async ({ page }) => {
  await gotoTabletop(page);
  const mapImg = page.locator('[data-testid="active-map-stage"] img');
  await page.getByTestId('tool-hand').click();
  const before = await mapImg.boundingBox();
  const stage = page.getByTestId('active-map-stage');
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 100, { steps: 5 });
  await page.mouse.up();
  const after = await mapImg.boundingBox();
  expect(after!.x - before!.x).toBeGreaterThan(100);
});

test('space+drag pans with the pointer tool active', async ({ page }) => {
  await gotoTabletop(page);
  const mapImg = page.locator('[data-testid="active-map-stage"] img');
  await page.getByTestId('tool-pointer').click();
  const before = await mapImg.boundingBox();
  const stage = page.getByTestId('active-map-stage');
  const box = (await stage.boundingBox())!;
  await page.keyboard.down(' ');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  const after = await mapImg.boundingBox();
  expect(after!.x - before!.x).toBeGreaterThan(100);
});

test('space+drag pans with the ruler tool active (and ruler works after release)', async ({
  page,
}) => {
  await gotoTabletop(page);
  const mapImg = page.locator('[data-testid="active-map-stage"] img');
  await page.getByTestId('tool-ruler').click();
  await expect(page.getByTestId('tool-window-ruler')).toBeVisible();
  const before = await mapImg.boundingBox();
  const stage = page.getByTestId('active-map-stage');
  const box = (await stage.boundingBox())!;

  // Space bypasses the ruler handler: the drag pans and drops NO anchor.
  await page.keyboard.down(' ');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  const after = await mapImg.boundingBox();
  expect(after!.x - before!.x).toBeGreaterThan(100);
  await expect(page.getByTestId('ruler-anchor')).toHaveCount(0);

  // With Space released the ruler behaves normally: a click drops an anchor.
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await expect(page.getByTestId('ruler-anchor')).toHaveCount(1);
});

test('text is movable with the pointer tool', async ({ page }) => {
  await gotoTabletop(page);
  await page.getByTestId('tool-pointer').click();
  // MapTextLayer exposes a per-text `data-text-id` attribute alongside the
  // generic `map-text` testid; only one text is seeded for this spec.
  const text = page.getByTestId('map-text');
  const before = await text.boundingBox();
  // Drag from the element's center (matches Playwright's `hover()` target) so
  // the on-screen delta is exactly the mouse delta, independent of the text's
  // rendered width.
  const cx = before!.x + before!.width / 2;
  const cy = before!.y + before!.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy + 100, { steps: 5 });
  await page.mouse.up();
  const after = await text.boundingBox();
  expect(after!.x - before!.x).toBeGreaterThan(100);
});
