import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Ruler Color';
const DATA_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#222"/></svg>'
  );

// A preset offered by the shared ColorPicker; distinct from the amber default.
const PICKED_COLOR = '#e74c3c';

interface Provisioned {
  campaignId: string;
  tokenAId: string;
  tokenBId: string;
  providerId: string;
}

let client: MongoClient;
let provisioned: Provisioned;
let originalRulerColor: string | undefined;

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
  if (!providerId) throw new Error('No providerId in session JWT');
  const gm = await database.collection('users').findOne({ providerId });
  if (!gm?._id) throw new Error('Session GM user not found');

  const now = new Date();
  const campaignId = (
    await database.collection('campaigns').insertOne({
      gameMasterId: gm._id,
      name: CAMPAIGN_NAME,
      description: 'E2E ruler color test.',
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
      imageKey: 'e2e/ruler-color-map.svg',
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

  const docA = tokenDoc(campaignId, mapId, gm._id, 'A', 200, 200, now);
  const docB = tokenDoc(campaignId, mapId, gm._id, 'B', 200, 700, now);
  const tokenAId = (await database.collection('mapToken').insertOne(docA)).insertedId;
  const tokenBId = (await database.collection('mapToken').insertOne(docB)).insertedId;

  return {
    campaignId: String(campaignId),
    tokenAId: String(tokenAId),
    tokenBId: String(tokenBId),
    providerId,
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
  await expect(page.getByTestId('map-token')).toHaveCount(2, { timeout: 15000 });
}

async function selectRuler(page: Page) {
  await page.getByTestId('tool-ruler').click();
  await expect(page.getByTestId('tool-window-ruler')).toBeVisible();
}

/** Draw a measurement between the two provisioned tokens (deterministic). */
async function measureBetweenTokens(page: Page) {
  await page.locator(`[data-token-id="${provisioned.tokenAId}"]`).click();
  await page.locator(`[data-token-id="${provisioned.tokenBId}"]`).click();
  await expect(page.getByTestId('ruler-distance')).toBeVisible();
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

  // Remember the GM's existing ruler color so we can restore it afterwards.
  const gm = await db().collection('users').findOne({ providerId: provisioned.providerId });
  originalRulerColor = (gm?.preferences as { rulerColor?: string } | undefined)?.rulerColor;
  // Start each run from a known-clean state (no persisted color).
  await db()
    .collection('users')
    .updateOne(
      { providerId: provisioned.providerId },
      { $unset: { 'preferences.rulerColor': '' } }
    );
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
  // Restore the GM's original ruler color (or clear it if there was none).
  if (provisioned?.providerId) {
    if (originalRulerColor) {
      await db()
        .collection('users')
        .updateOne(
          { providerId: provisioned.providerId },
          { $set: { 'preferences.rulerColor': originalRulerColor } }
        );
    } else {
      await db()
        .collection('users')
        .updateOne(
          { providerId: provisioned.providerId },
          { $unset: { 'preferences.rulerColor': '' } }
        );
    }
  }
  await client.close();
});

test('selecting the ruler tool opens the measurement settings popup', async ({ page }) => {
  await gotoTabletop(page);
  await selectRuler(page);
  await expect(page.getByTestId('ruler-settings-panel')).toBeVisible();
  await expect(page.getByTestId('tool-window-ruler-header')).toContainText('Measurement');

  // Closing the window also deactivates the ruler tool (reverts to pointer).
  await page.getByTestId('tool-window-ruler-close').click();
  await expect(page.getByTestId('tool-window-ruler')).toHaveCount(0);
  await expect(page.getByTestId('tool-pointer')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('active-map-stage')).not.toHaveCSS('cursor', 'crosshair');
});

test('picking a color changes the live measurement line and label color', async ({ page }) => {
  await gotoTabletop(page);
  await selectRuler(page);
  await measureBetweenTokens(page);

  // Default amber before any pick.
  await expect(page.getByTestId('ruler-line-stroke')).toHaveAttribute('stroke', '#fbbf24');

  const panel = page.getByTestId('ruler-settings-panel');
  await panel.getByRole('button', { name: `Select color ${PICKED_COLOR}` }).click();

  // The swatch readout, the SVG line, and the label border all update live.
  await expect(page.getByTestId('ruler-color-value')).toHaveText(PICKED_COLOR);
  await expect(page.getByTestId('ruler-line-stroke')).toHaveAttribute('stroke', PICKED_COLOR);
  // #e74c3c === rgb(231, 76, 60)
  await expect(page.getByTestId('ruler-distance')).toHaveCSS(
    'border-top-color',
    'rgb(231, 76, 60)'
  );
});

test('the chosen color is stored on the user record', async ({ page }) => {
  await gotoTabletop(page);
  await selectRuler(page);
  await page
    .getByTestId('ruler-settings-panel')
    .getByRole('button', { name: `Select color ${PICKED_COLOR}` })
    .click();

  await expect
    .poll(
      async () => {
        const gm = await db().collection('users').findOne({ providerId: provisioned.providerId });
        return (gm?.preferences as { rulerColor?: string } | undefined)?.rulerColor;
      },
      { timeout: 10000 }
    )
    .toBe(PICKED_COLOR);
});

test('the chosen color persists across a reload', async ({ page }) => {
  // The previous test persisted PICKED_COLOR to the DB.
  await gotoTabletop(page);
  await selectRuler(page);
  // The popup reflects the persisted color on a fresh load.
  await expect(page.getByTestId('ruler-color-value')).toHaveText(PICKED_COLOR);

  await measureBetweenTokens(page);
  await expect(page.getByTestId('ruler-line-stroke')).toHaveAttribute('stroke', PICKED_COLOR);
});
