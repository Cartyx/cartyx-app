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

  // The panel has no close affordance — it stays open while the tool is active.
  await expect(page.getByRole('button', { name: 'Close text settings' })).toHaveCount(0);
});

test('the settings panel stays open while writing, moving, and editing text', async ({ page }) => {
  await gotoTabletop(page);
  await selectTextTool(page);

  const panel = page.getByTestId('text-settings-panel');
  await expect(panel).toBeVisible();

  // …after writing text.
  await writeText(page, 0.55, 0.4, 'Sticky panel');
  const text = page.getByTestId('map-text').filter({ hasText: 'Sticky panel' });
  await expect(text).toBeVisible();
  await expect(panel).toBeVisible();

  // …after moving text (the reported regression).
  const b = (await text.boundingBox())!;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy + 90, { steps: 8 });
  await page.mouse.up();
  await expect(text).toBeVisible();
  await expect(panel).toBeVisible();
  // The size/color controls are still usable.
  await expect(panel.getByTestId('text-size-36')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Select color #2ecc71' })).toBeVisible();

  // …after entering edit mode and committing.
  await text.dblclick();
  await expect(page.getByTestId('map-text-input')).toBeVisible();
  await expect(panel).toBeVisible();
  await page.getByTestId('map-text-input').press('Enter');
  await expect(panel).toBeVisible();
});

test('the settings panel can be dragged and stays within the workspace', async ({ page }) => {
  await gotoTabletop(page);
  await selectTextTool(page);

  const panel = page.getByTestId('text-settings-panel');
  const header = page.getByTestId('text-settings-panel-header');
  const stage = (await page.getByTestId('active-map-stage').boundingBox())!;
  const before = (await panel.boundingBox())!;

  // Drag the header down-right — the panel follows.
  const dragBy = async (dx: number, dy: number) => {
    const h = (await header.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2 + dy, { steps: 8 });
    await page.mouse.up();
  };

  await dragBy(180, 140);
  const moved = (await panel.boundingBox())!;
  expect(moved.x).toBeGreaterThan(before.x + 80);
  expect(moved.y).toBeGreaterThan(before.y + 60);

  // Drag far past the top-left — it clamps inside the workspace, never lost.
  await dragBy(-3000, -3000);
  const clamped = (await panel.boundingBox())!;
  expect(clamped.x).toBeGreaterThanOrEqual(stage.x - 1);
  expect(clamped.y).toBeGreaterThanOrEqual(stage.y - 1);
  expect(clamped.x + clamped.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  await expect(panel).toBeVisible();
});

test('the panel stays visible after the workspace shrinks (it is not lost)', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 820 });
  await gotoTabletop(page);
  await selectTextTool(page);

  const panel = page.getByTestId('text-settings-panel');
  const header = page.getByTestId('text-settings-panel-header');

  // Drag the panel toward the bottom-right edge of the (large) workspace.
  const stage0 = (await page.getByTestId('active-map-stage').boundingBox())!;
  const h = (await header.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage0.x + stage0.width - 80, stage0.y + stage0.height - 80, { steps: 8 });
  await page.mouse.up();

  // Shrink the viewport (≈ opening the inspector / resizing the window).
  await page.setViewportSize({ width: 760, height: 560 });
  await page.waitForTimeout(300);

  // The panel re-clamps fully inside the smaller workspace — still visible.
  const stage1 = (await page.getByTestId('active-map-stage').boundingBox())!;
  await expect(panel).toBeVisible();
  const p = (await panel.boundingBox())!;
  expect(p.x).toBeGreaterThanOrEqual(stage1.x - 1);
  expect(p.y).toBeGreaterThanOrEqual(stage1.y - 1);
  expect(p.x + p.width).toBeLessThanOrEqual(stage1.x + stage1.width + 1);
  expect(p.y + p.height).toBeLessThanOrEqual(stage1.y + stage1.height + 1);

  // …and its controls are still usable.
  await expect(panel.getByTestId('text-size-72')).toBeVisible();
  await panel.getByTestId('text-size-72').click();
  await expect(panel.getByTestId('text-size-72')).toHaveAttribute('aria-pressed', 'true');
});

test('changing the font size resizes the selected text on the map', async ({ page }) => {
  await gotoTabletop(page);
  await selectTextTool(page);
  await writeText(page, 0.55, 0.45, 'Resize me');

  const text = page.getByTestId('map-text').filter({ hasText: 'Resize me' });
  await expect(text).toBeVisible();
  const fontPx = async () => parseFloat(await text.evaluate((el) => getComputedStyle(el).fontSize));
  const before = await fontPx();

  // Reproduce the reported flow: deselect, then re-select with the text tool,
  // then bump the size via a preset — it must apply to the placed text.
  await page.keyboard.press('Escape');
  await text.click();
  await page.getByTestId('text-settings-panel').getByTestId('text-size-96').click();

  // The on-map text grows, and the new size is persisted.
  await expect.poll(fontPx).toBeGreaterThan(before);
  await expect
    .poll(async () => {
      const doc = await db()
        .collection('mapText')
        .findOne({ mapId: new ObjectId(provisioned.mapId), text: 'Resize me' });
      return (doc as { fontSize?: number } | null)?.fontSize ?? 0;
    })
    .toBe(96);
});

test('font sizes larger than 48 are allowed for large maps', async ({ page }) => {
  await gotoTabletop(page);
  await selectTextTool(page);
  await writeText(page, 0.6, 0.5, 'Big label');

  const text = page.getByTestId('map-text').filter({ hasText: 'Big label' });
  await expect(text).toBeVisible();
  await text.click();

  // Use the exact-size input to set a value well above the old 48 cap.
  await page.getByTestId('text-settings-panel').getByTestId('text-size-input').fill('200');

  await expect
    .poll(async () => {
      const doc = await db()
        .collection('mapText')
        .findOne({ mapId: new ObjectId(provisioned.mapId), text: 'Big label' });
      return (doc as { fontSize?: number } | null)?.fontSize ?? 0;
    })
    .toBe(200);
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

test('hovering text highlights it (interactive) while the text tool is active', async ({
  page,
}) => {
  await gotoTabletop(page);
  await selectTextTool(page);
  await writeText(page, 0.6, 0.45, 'Hover me');

  const text = page.getByTestId('map-text').filter({ hasText: 'Hover me' });
  await text.hover();
  // Interactive affordance: a move cursor (it can be picked up and dragged).
  await expect(text).toHaveCSS('cursor', 'move');
});

test('dragging text moves it on the map and persists the new position', async ({ page }) => {
  await gotoTabletop(page);
  await selectTextTool(page);
  await writeText(page, 0.55, 0.4, 'Drag me');

  const text = page.getByTestId('map-text').filter({ hasText: 'Drag me' });
  await expect(text).toBeVisible();

  const before = (await text.boundingBox())!;
  const startBefore = await db()
    .collection('mapText')
    .findOne({ mapId: new ObjectId(provisioned.mapId), text: 'Drag me' });
  const x0 = (startBefore as { x?: number } | null)?.x ?? 0;
  const y0 = (startBefore as { y?: number } | null)?.y ?? 0;

  // Drag from the text's center down-right by a clear delta.
  const cx = before.x + before.width / 2;
  const cy = before.y + before.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 160, cy + 110, { steps: 8 });
  await page.mouse.up();

  // It visibly moved…
  await expect
    .poll(async () => (await text.boundingBox())?.x ?? before.x)
    .toBeGreaterThan(before.x + 40);

  // …and the new position persisted to the DB.
  await expect
    .poll(async () => {
      const doc = await db()
        .collection('mapText')
        .findOne({ mapId: new ObjectId(provisioned.mapId), text: 'Drag me' });
      return (doc as { x?: number } | null)?.x ?? x0;
    })
    .toBeGreaterThan(x0 + 1);
  const after = await db()
    .collection('mapText')
    .findOne({ mapId: new ObjectId(provisioned.mapId), text: 'Drag me' });
  expect((after as { y?: number } | null)?.y ?? y0).toBeGreaterThan(y0 + 1);
});

test('double-clicking text lets you edit it after it was placed', async ({ page }) => {
  await gotoTabletop(page);
  await selectTextTool(page);
  await writeText(page, 0.6, 0.5, 'Original');

  const original = page.getByTestId('map-text').filter({ hasText: 'Original' });
  await expect(original).toBeVisible();

  // Double-click opens the editor prefilled with the current text.
  await original.dblclick();
  const input = page.getByTestId('map-text-input');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('Original');

  // Replace and commit.
  await input.fill('Edited text');
  await input.press('Enter');

  await expect(page.getByTestId('map-text').filter({ hasText: 'Edited text' })).toBeVisible();
  await expect(page.getByTestId('map-text').filter({ hasText: 'Original' })).toHaveCount(0);

  // Persisted (same doc, updated content — still exactly one text on the map).
  await expect
    .poll(async () =>
      db()
        .collection('mapText')
        .countDocuments({ mapId: new ObjectId(provisioned.mapId), text: 'Edited text' })
    )
    .toBe(1);
  await expect
    .poll(async () =>
      db()
        .collection('mapText')
        .countDocuments({ mapId: new ObjectId(provisioned.mapId) })
    )
    .toBe(1);
});
