/**
 * E2E for the unified tool-window system: cross-cutting behavior that isn't
 * specific to any single tool (Draw/Text/Measurement/Dice/Layers) — windows
 * cascade on open (overlapping, stepped down-and-right), and every window
 * shares the same chrome (grip + icon + title header, close X).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Tool Windows';
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
      description: 'E2E tool-window system test.',
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
      imageKey: 'e2e/tool-windows-map.svg',
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

  return {
    campaignId: String(campaignId),
    mapId: String(mapId),
    gmId: String(gm._id),
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
    await db().collection('tabletopscreen').deleteMany({ campaignId: cid });
    await db().collection('map').deleteMany({ campaignId: cid });
    await db().collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

test('a second tool window cascades over the first instead of tiling beside it', async ({
  page,
}) => {
  await gotoTabletop(page);
  await page.getByTestId('tool-drawing').click();
  await page.getByTestId('tool-layer').click();
  const a = (await page.getByTestId('tool-window-drawing').boundingBox())!;
  const b = (await page.getByTestId('tool-window-layer').boundingBox())!;
  // Cascade: the second window steps down-and-right by one cascade step and
  // overlaps the first, rather than being auto-tiled to a separate slot.
  const overlaps =
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  expect(overlaps).toBe(true);
  expect(Math.round(b.x - a.x)).toBe(28); // TOOL_WINDOW_CASCADE_STEP
  expect(Math.round(b.y - a.y)).toBe(28);
});

test('every tool window shows grip, icon+title, and close X', async ({ page }) => {
  await gotoTabletop(page);
  for (const [tool, id, title] of [
    ['tool-drawing', 'drawing', 'Draw'],
    ['tool-text', 'text', 'Text'],
    ['tool-ruler', 'ruler', 'Measurement'],
    ['tool-layer', 'layer', 'Layers'],
  ] as const) {
    await page.getByTestId(tool).click();
    const header = page.getByTestId(`tool-window-${id}-header`);
    await expect(header).toBeVisible();
    await expect(header).toContainText(title);
    await expect(page.getByTestId(`tool-window-${id}-close`)).toBeVisible();
    await page.getByTestId(`tool-window-${id}-close`).click();
    await expect(page.getByTestId(`tool-window-${id}`)).toHaveCount(0);
  }
});
