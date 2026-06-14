/**
 * E2E for the map text tool:
 *  - selecting the tool opens a settings popup (font size + color)
 *  - clicking the map writes text that shows up (and persists across reload)
 *  - text is selectable and Delete removes it
 *  - a GM can delete text authored by someone else
 *  - the show/hide toggle hides/shows all text
 *
 * The player-only-own delete restriction is enforced server-side in
 * deleteMapText (canDelete = isGM || createdBy === user); the harness only has
 * a GM session, so we validate the GM-can-delete-anyone half here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Map Text';
const DATA_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#222"/></svg>'
  );

interface Provisioned {
  campaignId: string;
  mapId: string;
  gmId: string;
  otherUserId: string;
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

  // A throwaway "other author" so we can prove a GM deletes others' text.
  const otherUserId = (
    await database.collection('users').insertOne({
      provider: 'e2e',
      providerId: 'e2e-text-other-' + Math.random().toString(36).slice(2, 12),
      role: 'player',
      firstName: 'Other',
      lastName: 'Author',
      createdAt: now,
    })
  ).insertedId;

  const campaignId = (
    await database.collection('campaigns').insertOne({
      gameMasterId: gm._id,
      name: CAMPAIGN_NAME,
      description: 'E2E map text test.',
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
      imageKey: 'e2e/text-map.svg',
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
    otherUserId: String(otherUserId),
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

async function selectTextTool(page: Page) {
  await page.getByTestId('tool-text').click();
  await expect(page.getByTestId('text-settings-panel')).toBeVisible();
}

/** Click the map at a fraction of the stage and type `value`, committing it. */
async function writeText(page: Page, fx: number, fy: number, value: string) {
  const box = (await page.getByTestId('active-map-stage').boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  const input = page.getByTestId('map-text-input');
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press('Enter');
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
  // Keep tests independent: clear all text on the map between them.
  if (provisioned?.mapId) {
    await db()
      .collection('mapText')
      .deleteMany({ mapId: new ObjectId(provisioned.mapId) });
  }
});

test.afterAll(async () => {
  if (!client) return;
  if (provisioned?.campaignId) {
    const cid = new ObjectId(provisioned.campaignId);
    await db().collection('mapText').deleteMany({ campaignId: cid });
    await db().collection('tabletopscreen').deleteMany({ campaignId: cid });
    await db().collection('map').deleteMany({ campaignId: cid });
    await db().collection('campaigns').deleteMany({ _id: cid });
  }
  if (provisioned?.otherUserId) {
    await db()
      .collection('users')
      .deleteOne({ _id: new ObjectId(provisioned.otherUserId) });
  }
  await client.close();
});

test('selecting the text tool opens a settings popup with size + color', async ({ page }) => {
  await gotoTabletop(page);
  await selectTextTool(page);

  const panel = page.getByTestId('text-settings-panel');
  // Font-size presets and a color picker are present.
  await expect(panel.getByTestId('text-size-24')).toBeVisible();
  await panel.getByTestId('text-size-24').click();
  await expect(panel.getByTestId('text-size-24')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: 'Select color #e74c3c' })).toBeVisible();

  // Dismiss without leaving the tool.
  await page.getByRole('button', { name: 'Close text settings' }).click();
  await expect(panel).toBeHidden();
});

test('writing text shows it on the map and it persists across a reload', async ({ page }) => {
  await gotoTabletop(page);
  await selectTextTool(page);

  await writeText(page, 0.6, 0.45, 'Ambush here');

  const text = page.getByTestId('map-text').filter({ hasText: 'Ambush here' });
  await expect(text).toBeVisible();

  // Stored on the map doc.
  await expect
    .poll(async () =>
      db()
        .collection('mapText')
        .countDocuments({ mapId: new ObjectId(provisioned.mapId), text: 'Ambush here' })
    )
    .toBe(1);

  // Survives a reload (loaded from the server).
  await page.reload();
  await expect(page.getByTestId('active-map-stage')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('map-text').filter({ hasText: 'Ambush here' })).toBeVisible();
});

test('text is selectable and Delete removes your own text', async ({ page }) => {
  await gotoTabletop(page);
  await selectTextTool(page);
  await writeText(page, 0.55, 0.5, 'Trap');

  const text = page.getByTestId('map-text').filter({ hasText: 'Trap' });
  await expect(text).toBeVisible();

  // Select, then Delete.
  await text.click();
  await page.keyboard.press('Delete');

  await expect(page.getByTestId('map-text').filter({ hasText: 'Trap' })).toHaveCount(0);
  await expect
    .poll(async () =>
      db()
        .collection('mapText')
        .countDocuments({ mapId: new ObjectId(provisioned.mapId), text: 'Trap' })
    )
    .toBe(0);
});

test("a GM can delete another user's text", async ({ page }) => {
  // Seed a text authored by a different user.
  const now = new Date();
  await db()
    .collection('mapText')
    .insertOne({
      mapId: new ObjectId(provisioned.mapId),
      campaignId: new ObjectId(provisioned.campaignId),
      x: 500,
      y: 500,
      text: 'Players note',
      color: '#3498db',
      fontSize: 16,
      createdBy: new ObjectId(provisioned.otherUserId),
      createdAt: now,
      updatedAt: now,
    });

  await gotoTabletop(page);
  await selectTextTool(page);

  const text = page.getByTestId('map-text').filter({ hasText: 'Players note' });
  await expect(text).toBeVisible({ timeout: 20000 });

  await text.click();
  await page.keyboard.press('Delete');

  await expect(page.getByTestId('map-text').filter({ hasText: 'Players note' })).toHaveCount(0);
  await expect
    .poll(async () =>
      db()
        .collection('mapText')
        .countDocuments({ mapId: new ObjectId(provisioned.mapId), text: 'Players note' })
    )
    .toBe(0);
});

test('the show/hide text toggle hides and shows all text', async ({ page }) => {
  await gotoTabletop(page);
  await selectTextTool(page);
  await writeText(page, 0.6, 0.4, 'Toggle me');

  await expect(page.getByTestId('map-text').filter({ hasText: 'Toggle me' })).toBeVisible();

  // Hide → no text rendered.
  await page.getByTestId('map-text-toggle').click();
  await expect(page.getByTestId('map-text')).toHaveCount(0);

  // Show → text returns.
  await page.getByTestId('map-text-toggle').click();
  await expect(page.getByTestId('map-text').filter({ hasText: 'Toggle me' })).toBeVisible();
});
