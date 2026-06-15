/**
 * E2E for multi-token group move (GM):
 *  - a GM shift-selects multiple tokens and drags one of them; ALL selected
 *    tokens move together by the same delta (formation preserved), in the DOM
 *    and persisted to the DB.
 *  - dragging a single, unselected token still moves only that token (the
 *    multi-select change must not regress single-token drag).
 *
 * Group move is GM-only — players can move only their own single token — and
 * that restriction is enforced server-side in moveMapToken (a player may move a
 * token only if they own it). The harness has a GM session, so we validate the
 * GM group-move behaviour here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Token Group Move';
const DATA_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#222"/></svg>'
  );

interface Provisioned {
  campaignId: string;
  mapId: string;
  gmId: string;
}

let client: MongoClient;
let provisioned: Provisioned;

function db(): Db {
  return process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
}

function tokens() {
  return db().collection('mapToken');
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

  const campaignId = (
    await database.collection('campaigns').insertOne({
      gameMasterId: gm._id,
      name: CAMPAIGN_NAME,
      description: 'E2E token group-move test.',
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
      imageKey: 'e2e/group-move-map.svg',
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

  return { campaignId: String(campaignId), mapId: String(mapId), gmId: String(gm._id) };
}

/** Seed a public GM-owned token at (x,y) and return its string id. */
async function seedToken(x: number, y: number, label: string): Promise<string> {
  const now = new Date();
  const res = await tokens().insertOne({
    mapId: new ObjectId(provisioned.mapId),
    campaignId: new ObjectId(provisioned.campaignId),
    sourceCollection: 'monster',
    sourceDocumentId: new ObjectId(),
    instanceNumber: 1,
    ownerUserId: null,
    x,
    y,
    sizeSquares: 2,
    color: '#3498db',
    label,
    imageUrl: '',
    labelVisible: true,
    hiddenFromPlayers: false,
    zIndex: 0,
    createdBy: new ObjectId(provisioned.gmId),
    createdAt: now,
    updatedAt: now,
  });
  return String(res.insertedId);
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
}

function tokenLocator(page: Page, id: string) {
  return page.locator(`[data-testid="map-token"][data-token-id="${id}"]`);
}

async function tokenDoc(id: string) {
  return (await tokens().findOne({ _id: new ObjectId(id) })) as {
    x?: number;
    y?: number;
  } | null;
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
    await tokens().deleteMany({ mapId: new ObjectId(provisioned.mapId) });
  }
});

test.afterAll(async () => {
  if (!client) return;
  if (provisioned?.campaignId) {
    const cid = new ObjectId(provisioned.campaignId);
    await tokens().deleteMany({ campaignId: cid });
    await db().collection('tabletopscreen').deleteMany({ campaignId: cid });
    await db().collection('map').deleteMany({ campaignId: cid });
    await db().collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

test('a GM shift-selects multiple tokens and drags them together', async ({ page }) => {
  const aId = await seedToken(300, 500, 'Alpha');
  const bId = await seedToken(700, 500, 'Bravo');

  await gotoTabletop(page);
  const a = tokenLocator(page, aId);
  const b = tokenLocator(page, bId);
  await expect(a).toBeVisible({ timeout: 20000 });
  await expect(b).toBeVisible();

  const beforeA = (await tokenDoc(aId))!;
  const beforeB = (await tokenDoc(bId))!;

  // Select A, then shift-select B → both selected (aria-pressed on the avatars).
  await a.click();
  await b.click({ modifiers: ['Shift'] });
  await expect(a.locator('[aria-pressed]')).toHaveAttribute('aria-pressed', 'true');
  await expect(b.locator('[aria-pressed]')).toHaveAttribute('aria-pressed', 'true');

  const boxA = (await a.boundingBox())!;
  const boxB = (await b.boundingBox())!;

  // Drag A by a clear delta — B must move with it by the same amount.
  await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxA.x + boxA.width / 2 + 200, boxA.y + boxA.height / 2 + 120, {
    steps: 10,
  });
  await page.mouse.up();

  // Both visibly moved right + down.
  await expect.poll(async () => (await a.boundingBox())?.x ?? boxA.x).toBeGreaterThan(boxA.x + 80);
  await expect.poll(async () => (await b.boundingBox())?.x ?? boxB.x).toBeGreaterThan(boxB.x + 80);

  // Both persisted, and the formation is preserved (same delta for each).
  await expect
    .poll(async () => (await tokenDoc(aId))?.x ?? 0)
    .toBeGreaterThan((beforeA.x ?? 0) + 1);
  await expect
    .poll(async () => (await tokenDoc(bId))?.x ?? 0)
    .toBeGreaterThan((beforeB.x ?? 0) + 1);

  const afterA = (await tokenDoc(aId))!;
  const afterB = (await tokenDoc(bId))!;
  const dxA = (afterA.x ?? 0) - (beforeA.x ?? 0);
  const dyA = (afterA.y ?? 0) - (beforeA.y ?? 0);
  const dxB = (afterB.x ?? 0) - (beforeB.x ?? 0);
  const dyB = (afterB.y ?? 0) - (beforeB.y ?? 0);
  expect(dxA).toBeGreaterThan(1);
  expect(dyA).toBeGreaterThan(1);
  // Same translation applied to both (allow a tiny rounding tolerance).
  expect(Math.abs(dxA - dxB)).toBeLessThan(2);
  expect(Math.abs(dyA - dyB)).toBeLessThan(2);
});

test('dragging an unselected token moves only that token', async ({ page }) => {
  const aId = await seedToken(300, 500, 'Alpha');
  const bId = await seedToken(700, 500, 'Bravo');

  await gotoTabletop(page);
  const a = tokenLocator(page, aId);
  const b = tokenLocator(page, bId);
  await expect(a).toBeVisible({ timeout: 20000 });
  await expect(b).toBeVisible();

  const beforeB = (await tokenDoc(bId))!;
  const boxA = (await a.boundingBox())!;

  // Drag A without any multi-selection — B must stay put.
  await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxA.x + boxA.width / 2 + 200, boxA.y + boxA.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect.poll(async () => (await tokenDoc(aId))?.x ?? 0).toBeGreaterThan(305);

  const afterB = (await tokenDoc(bId))!;
  expect(Math.abs((afterB.x ?? 0) - (beforeB.x ?? 0))).toBeLessThan(2);
  expect(Math.abs((afterB.y ?? 0) - (beforeB.y ?? 0))).toBeLessThan(2);
});

test('a GM removes a selected token via the confirm dialog', async ({ page }) => {
  const aId = await seedToken(400, 400, 'Doomed');

  await gotoTabletop(page);
  const a = tokenLocator(page, aId);
  await expect(a).toBeVisible({ timeout: 20000 });

  // Select, press Delete → a confirm dialog appears (GM-only token removal).
  await a.click();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Remove token?');

  // Confirm → the token is gone from the DOM and the DB.
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(a).toHaveCount(0);
  await expect.poll(() => tokens().countDocuments({ _id: new ObjectId(aId) })).toBe(0);
});
