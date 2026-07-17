/**
 * E2E for the Spell AoE tool:
 *  - selecting the tool opens a settings popup (shape/size/width/color), sphere
 *    selected by default
 *  - clicking the map with the sphere shape commits a template immediately —
 *    it renders as a `map-aoe` circle and persists
 *  - the Layers panel's Spell FX eye toggle hides and shows the AoE layer
 *    (a per-viewer visibility toggle, not a delete)
 *
 * The AoE tool is available to every campaign member (not GM-gated); the
 * harness only has a GM session, so placement is exercised as the GM. The
 * `spell-fx` layer toggle itself lives in the GM-only Layers panel, matching
 * the pattern already covered for drawings in tabletop-drawing.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Spell AoE';
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

function aoes() {
  return db().collection('mapAoE');
}

function countAoes(filter: Record<string, unknown> = {}) {
  return aoes().countDocuments({ mapId: new ObjectId(provisioned.mapId), ...filter });
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
      description: 'E2E spell AoE tool test.',
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
      imageKey: 'e2e/aoe-map.svg',
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

async function selectAoeTool(page: Page) {
  await page.getByTestId('tool-aoe').click();
  await expect(page.getByTestId('tool-window-aoe')).toBeVisible();
  await expect(page.getByTestId('aoe-settings-panel')).toBeVisible();
}

async function stageBox(page: Page) {
  return (await page.getByTestId('active-map-stage').boundingBox())!;
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
  // Keep tests independent: clear all AoE templates on the map between them.
  if (provisioned?.mapId) {
    await aoes().deleteMany({ mapId: new ObjectId(provisioned.mapId) });
  }
});

test.afterAll(async () => {
  if (!client) return;
  if (provisioned?.campaignId) {
    const cid = new ObjectId(provisioned.campaignId);
    await aoes().deleteMany({ campaignId: cid });
    await db().collection('tabletopscreen').deleteMany({ campaignId: cid });
    await db().collection('map').deleteMany({ campaignId: cid });
    await db().collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

test('selecting the AoE tool opens a settings popup with sphere selected by default', async ({
  page,
}) => {
  await gotoTabletop(page);
  await selectAoeTool(page);

  const panel = page.getByTestId('aoe-settings-panel');
  await expect(panel.getByTestId('aoe-shape-sphere')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('aoe-shape-cone')).toBeVisible();
  await expect(panel.getByTestId('aoe-shape-cube')).toBeVisible();
  await expect(panel.getByTestId('aoe-shape-line')).toBeVisible();
  await expect(panel.getByTestId('aoe-shape-cylinder')).toBeVisible();
  await expect(panel.getByTestId('aoe-size-input')).toHaveValue('20');
  // Width input is line-only — hidden while sphere is selected.
  await expect(panel.getByTestId('aoe-width-input')).toHaveCount(0);

  // Unified chrome: grip + icon + title header, and a close X that closes the
  // window and reverts the toolbar to pointer.
  await expect(page.getByTestId('tool-window-aoe-header')).toContainText('Spell AoE');
  await page.getByTestId('tool-window-aoe-close').click();
  await expect(page.getByTestId('tool-window-aoe')).toHaveCount(0);
  await expect(page.getByTestId('tool-pointer')).toHaveAttribute('aria-pressed', 'true');
});

test('clicking the map with the sphere shape places a template that renders and persists', async ({
  page,
}) => {
  await gotoTabletop(page);
  await selectAoeTool(page);

  const box = await stageBox(page);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);

  const circle = page.getByTestId('map-aoe');
  await expect(circle).toHaveCount(1);
  await expect(circle).toHaveAttribute('data-aoe-shape', 'sphere');
  await expect(page.getByTestId('map-aoe-layer')).toBeVisible();

  // Persisted with the default 20 ft size scaled by the map's 50 px / 5 ft
  // grid → 200 map-local px, and no rotation (radial shape).
  await expect.poll(() => countAoes({ shape: 'sphere' })).toBe(1);
  const doc = await aoes().findOne({ mapId: new ObjectId(provisioned.mapId), shape: 'sphere' });
  expect((doc as { sizePx?: number } | null)?.sizePx).toBe(200);
  expect((doc as { rotation?: number } | null)?.rotation).toBe(0);
});

test('the Layers panel eye toggle hides and shows the AoE layer', async ({ page }) => {
  await gotoTabletop(page);
  await selectAoeTool(page);

  const box = await stageBox(page);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.getByTestId('map-aoe')).toHaveCount(1);
  await expect.poll(() => countAoes()).toBe(1);

  // Open the GM Layers panel and hide the Spell FX layer via its eye.
  await page.getByTestId('tool-layer').click();
  const panel = page.getByTestId('layers-panel');
  await expect(panel).toBeVisible();
  const eye = panel.getByTestId('layer-visibility-spell-fx');
  await expect(eye).toHaveAttribute('aria-pressed', 'true'); // currently visible
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'false'); // now hidden

  // The whole AoE layer disappears — but nothing is deleted: it's a
  // per-viewer visibility toggle.
  await expect(page.getByTestId('map-aoe')).toHaveCount(0);
  await expect(page.getByTestId('map-aoe-layer')).toHaveCount(0);
  await expect.poll(() => countAoes()).toBe(1);

  // Toggling the eye back shows the layer + template again.
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('map-aoe-layer')).toHaveCount(1);
  await expect(page.getByTestId('map-aoe')).toHaveCount(1);
});

test('a placed template shows the placer name and an optional label', async ({ page }) => {
  await gotoTabletop(page);
  await selectAoeTool(page);

  // Provide an optional label (e.g. the spell name) before placing.
  await page.getByTestId('aoe-label-input').fill('Fireball');

  const box = await stageBox(page);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.getByTestId('map-aoe')).toHaveCount(1);

  // The label overlay renders the user label + the placer's name (denormalised
  // onto the doc at create time).
  const labelLayer = page.getByTestId('map-aoe-label-layer');
  await expect(labelLayer).toBeVisible();
  await expect(labelLayer.getByText('Fireball')).toBeVisible();

  // The persisted doc carries both the label and a non-empty placer name.
  await expect
    .poll(async () => {
      const doc = await aoes().findOne({ mapId: new ObjectId(provisioned.mapId) });
      return (doc as { label?: string } | null)?.label ?? null;
    })
    .toBe('Fireball');
  const doc = await aoes().findOne({ mapId: new ObjectId(provisioned.mapId) });
  expect(((doc as { createdByName?: string } | null)?.createdByName ?? '').length).toBeGreaterThan(
    0
  );
});

test('the per-viewer Show spell effects toggle hides and shows the AoE layer for everyone', async ({
  page,
}) => {
  await gotoTabletop(page);
  await selectAoeTool(page);

  const box = await stageBox(page);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.getByTestId('map-aoe')).toHaveCount(1);

  // The map-control toggle (available to every viewer, not GM-gated) hides the
  // AoE layer for this client without deleting anything.
  const toggle = page.getByTestId('map-spell-effects-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('map-aoe-layer')).toHaveCount(0);
  await expect.poll(() => countAoes()).toBe(1);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('map-aoe')).toHaveCount(1);
});

test('the pointer tool drags a placed template to a new position (persisted)', async ({ page }) => {
  await gotoTabletop(page);
  await selectAoeTool(page);

  const box = await stageBox(page);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.getByTestId('map-aoe')).toHaveCount(1);
  await expect.poll(() => countAoes()).toBe(1);

  const before = await aoes().findOne({ mapId: new ObjectId(provisioned.mapId), shape: 'sphere' });
  const startOriginX = (before as { originX?: number } | null)?.originX ?? 0;

  // Switch to the pointer tool, then drag the template to the right.
  await page.getByTestId('tool-pointer').click();
  const circle = page.getByTestId('map-aoe');
  const cbox = (await circle.boundingBox())!;
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy, { steps: 10 });
  await page.mouse.up();

  // The move persists (owner/GM) — originX increased, still exactly one doc.
  await expect
    .poll(async () => {
      const doc = await aoes().findOne({
        mapId: new ObjectId(provisioned.mapId),
        shape: 'sphere',
      });
      return (doc as { originX?: number } | null)?.originX ?? 0;
    })
    .toBeGreaterThan(startOriginX + 10);
  await expect.poll(() => countAoes()).toBe(1);
});
