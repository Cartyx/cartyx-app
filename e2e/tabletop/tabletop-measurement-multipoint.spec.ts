/**
 * E2E for the measurement (ruler) tool's multi-point + reset features:
 *  1. Double-clicking while drawing RESETS the tool — it stops drawing until
 *     the next click.
 *  2. Shift+click adds a waypoint and keeps drawing; the line can have many
 *     points, with a distance calculated per segment. Double-clicking removes
 *     all points (same reset).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Measurement Multipoint';
const DATA_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#222"/></svg>'
  );

interface Provisioned {
  campaignId: string;
  tokenAId: string;
  tokenBId: string;
  tokenCId: string;
}

let client: MongoClient;
let provisioned: Provisioned;

function db(): Db {
  return process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
}

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
      description: 'E2E multi-point measurement test.',
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
      imageKey: 'e2e/multipoint-map.svg',
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

  // A(200,200) → B(200,700): 500px = 10 squares = 50 ft.
  // B(200,700) → C(700,700): 500px = 10 squares = 50 ft.
  const tokenAId = (
    await database
      .collection('mapToken')
      .insertOne(tokenDoc(campaignId, mapId, gm._id, 'A', 200, 200, now))
  ).insertedId;
  const tokenBId = (
    await database
      .collection('mapToken')
      .insertOne(tokenDoc(campaignId, mapId, gm._id, 'B', 200, 700, now))
  ).insertedId;
  const tokenCId = (
    await database
      .collection('mapToken')
      .insertOne(tokenDoc(campaignId, mapId, gm._id, 'C', 700, 700, now))
  ).insertedId;

  return {
    campaignId: String(campaignId),
    tokenAId: String(tokenAId),
    tokenBId: String(tokenBId),
    tokenCId: String(tokenCId),
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
  await expect(page.getByTestId('map-token')).toHaveCount(3, { timeout: 15000 });
}

async function selectRuler(page: Page) {
  await page.getByTestId('tool-ruler').click();
}

async function shiftClickAt(page: Page, x: number, y: number) {
  await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  await page.keyboard.up('Shift');
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
    await db().collection('tabletopscreen').deleteMany({ campaignId: cid });
    await db().collection('map').deleteMany({ campaignId: cid });
    await db().collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

test('double-clicking while drawing resets the tool (and it draws again on next click)', async ({
  page,
}) => {
  await gotoTabletop(page);
  await selectRuler(page);

  const box = (await page.getByTestId('active-map-stage').boundingBox())!;
  const px = box.x + box.width * 0.75;
  const py = box.y + box.height * 0.4;

  // Draw a live line.
  await page.mouse.click(px, py);
  await expect(page.getByTestId('ruler-anchor')).toBeVisible();
  await page.mouse.move(px - 150, py + 120, { steps: 6 });
  await expect(page.getByTestId('ruler-line')).toBeVisible();
  await expect(page.getByTestId('ruler-distance').first()).toBeVisible();

  // Double-click resets — nothing is drawn anymore.
  await page.mouse.dblclick(px - 150, py + 120);
  await expect(page.getByTestId('ruler-anchor')).toHaveCount(0);
  await expect(page.getByTestId('ruler-line')).toHaveCount(0);
  await expect(page.getByTestId('ruler-distance')).toHaveCount(0);

  // A fresh click starts drawing again (the tool wasn't disabled).
  await page.mouse.click(px, py);
  await expect(page.getByTestId('ruler-anchor')).toBeVisible();
});

test('shift-clicking adds waypoints with a distance calculated per segment', async ({ page }) => {
  await gotoTabletop(page);
  await selectRuler(page);

  // Plain click A, shift+click B (adds a waypoint), plain click C (completes).
  await page.locator(`[data-token-id="${provisioned.tokenAId}"]`).click();
  await page.locator(`[data-token-id="${provisioned.tokenBId}"]`).click({ modifiers: ['Shift'] });
  await page.locator(`[data-token-id="${provisioned.tokenCId}"]`).click();

  // Two segments (A→B, B→C), each its own distance label, both 50 ft.
  const labels = page.getByTestId('ruler-distance');
  await expect(labels).toHaveCount(2);
  await expect(labels.nth(0)).toHaveText('50 ft');
  await expect(labels.nth(1)).toHaveText('50 ft');

  // Exactly one anchor; at least one intermediate waypoint dot.
  await expect(page.getByTestId('ruler-anchor')).toHaveCount(1);
  expect(await page.getByTestId('ruler-waypoint').count()).toBeGreaterThan(0);
});

test('shift-clicking on the map builds a multi-point line', async ({ page }) => {
  await gotoTabletop(page);
  await selectRuler(page);

  const box = (await page.getByTestId('active-map-stage').boundingBox())!;
  // Three points on the right half (clear of the tokens on the left).
  const p1 = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.25 };
  const p2 = { x: box.x + box.width * 0.85, y: box.y + box.height * 0.25 };
  const p3 = { x: box.x + box.width * 0.85, y: box.y + box.height * 0.6 };

  await page.mouse.click(p1.x, p1.y);
  await shiftClickAt(page, p2.x, p2.y);
  await shiftClickAt(page, p3.x, p3.y);
  // Move so the live segment from the last waypoint is non-trivial.
  await page.mouse.move(p3.x - 100, p3.y + 60, { steps: 4 });

  // At least two committed segments (P1→P2, P2→P3), one anchor, ≥1 waypoint.
  expect(await page.getByTestId('ruler-distance').count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('ruler-anchor')).toHaveCount(1);
  expect(await page.getByTestId('ruler-waypoint').count()).toBeGreaterThanOrEqual(1);

  // Each committed segment reports a positive distance.
  const first = parseInt(
    (await page.getByTestId('ruler-distance').nth(0).textContent())?.replace(/[^0-9]/g, '') || '0',
    10
  );
  const second = parseInt(
    (await page.getByTestId('ruler-distance').nth(1).textContent())?.replace(/[^0-9]/g, '') || '0',
    10
  );
  expect(first).toBeGreaterThan(0);
  expect(second).toBeGreaterThan(0);
});

test('double-clicking removes all points of a multi-point line', async ({ page }) => {
  await gotoTabletop(page);
  await selectRuler(page);

  const box = (await page.getByTestId('active-map-stage').boundingBox())!;
  const p1 = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.3 };
  const p2 = { x: box.x + box.width * 0.85, y: box.y + box.height * 0.3 };

  await page.mouse.click(p1.x, p1.y);
  await shiftClickAt(page, p2.x, p2.y);
  await expect(page.getByTestId('ruler-waypoint').first()).toBeVisible();
  expect(await page.getByTestId('ruler-distance').count()).toBeGreaterThanOrEqual(1);

  // Double-click clears every point + segment.
  await page.mouse.dblclick(p2.x, p2.y);
  await expect(page.getByTestId('ruler-anchor')).toHaveCount(0);
  await expect(page.getByTestId('ruler-waypoint')).toHaveCount(0);
  await expect(page.getByTestId('ruler-distance')).toHaveCount(0);
  await expect(page.getByTestId('ruler-line')).toHaveCount(0);
});
