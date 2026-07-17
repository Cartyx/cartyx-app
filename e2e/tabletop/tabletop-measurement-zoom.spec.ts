/**
 * E2E regression: the measurement (ruler) anchor must land under the cursor at
 * any zoom / pan. Reproduces the user-reported bug where, after zooming in, a
 * ruler click drew the anchor dot away from the mouse pointer.
 *
 * The SVG circle's cx/cy are stage-local pixels (the ruler SVG is `inset-0`
 * inside the stage), so page-space anchor = stageBox.{x,y} + {cx,cy}. That must
 * equal the click point within a couple of pixels.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Measurement Zoom';
const DATA_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#222"/></svg>'
  );

let client: MongoClient;
let campaignId: string;

async function provision(db: Db): Promise<string> {
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
  const cid = (
    await db.collection('campaigns').insertOne({
      gameMasterId: gm._id,
      name: CAMPAIGN_NAME,
      description: 'E2E measurement zoom test.',
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
    await db.collection('map').insertOne({
      campaignId: cid,
      createdBy: gm._id,
      name: 'E2E Zoom Map',
      tags: [],
      imageKey: 'e2e/measure-zoom-map.svg',
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
    campaignId: cid,
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

  return String(cid);
}

async function gotoTabletop(page: Page) {
  await page.goto(`/campaigns/${campaignId}/play?tab=tabletop`);
  const stage = page.getByTestId('active-map-stage');
  try {
    await expect(stage).toBeVisible({ timeout: 20000 });
  } catch {
    await page.reload();
    await expect(stage).toBeVisible({ timeout: 20000 });
  }
}

/** Click at (clickX, clickY) with the ruler tool and assert the anchor dot lands there. */
async function assertAnchorUnderCursor(page: Page, clickX: number, clickY: number) {
  const stage = page.getByTestId('active-map-stage');
  await page.mouse.click(clickX, clickY);
  const anchor = page.getByTestId('ruler-anchor');
  await expect(anchor).toBeVisible();
  const stageBox = (await stage.boundingBox())!;
  const cxAttr = Number(await anchor.getAttribute('cx'));
  const cyAttr = Number(await anchor.getAttribute('cy'));
  expect(Math.abs(stageBox.x + cxAttr - clickX)).toBeLessThanOrEqual(2);
  expect(Math.abs(stageBox.y + cyAttr - clickY)).toBeLessThanOrEqual(2);
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
  campaignId = await provision(db);
});

test.afterAll(async () => {
  if (!client) return;
  if (campaignId) {
    const db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
    const cid = new ObjectId(campaignId);
    await db.collection('mapToken').deleteMany({ campaignId: cid });
    await db.collection('tabletopscreen').deleteMany({ campaignId: cid });
    await db.collection('map').deleteMany({ campaignId: cid });
    await db.collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

test('anchor dot lands under the cursor when zoomed in', async ({ page }) => {
  await gotoTabletop(page);
  const stage = page.getByTestId('active-map-stage');
  const box = (await stage.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Zoom in ~6 steps around the center (wheel up = zoom in).
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
  await page.waitForTimeout(100);

  await page.getByTestId('tool-ruler').click();
  // Click a point offset from center so pan/zoom errors show up.
  await assertAnchorUnderCursor(page, cx + 137, cy - 89);
});

test('anchor dot lands under the cursor at default zoom (control)', async ({ page }) => {
  await gotoTabletop(page);
  const stage = page.getByTestId('active-map-stage');
  const box = (await stage.boundingBox())!;

  await page.getByTestId('tool-ruler').click();
  await assertAnchorUnderCursor(page, box.x + box.width / 2 + 137, box.y + box.height / 2 - 89);
});
