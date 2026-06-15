/**
 * E2E for the map drawing tool:
 *  - selecting the tool opens a settings popup (shape, color, size, fill)
 *  - pencil click-drag draws a stroke that renders + persists
 *  - changing the line size applies to a new drawing
 *  - the eraser removes a drawn stroke (DOM + DB)
 *  - square / circle, filled and outline, in a chosen color
 *  - the pointer tool selects a shape, the corner handle resizes it, Delete removes it
 *  - a GM can delete a drawing authored by someone else
 *  - the show/hide-drawings toggle hides/shows the layer
 *  - the GM "clear all" button empties the map
 *  - drawings persist across a reload
 *
 * The player-only-own restriction is enforced server-side in update/delete
 * (canModify = isGM || createdBy === user); the harness only has a GM session,
 * so we validate the GM-can-modify-anyone half here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Map Drawing';
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

function drawings() {
  return db().collection('mapDrawing');
}

function countDrawings(filter: Record<string, unknown> = {}) {
  return drawings().countDocuments({ mapId: new ObjectId(provisioned.mapId), ...filter });
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

  // A throwaway "other author" so we can prove a GM modifies others' drawings.
  const otherUserId = (
    await database.collection('users').insertOne({
      provider: 'e2e',
      providerId: 'e2e-draw-other-' + Math.random().toString(36).slice(2, 12),
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
      description: 'E2E map drawing test.',
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
      imageKey: 'e2e/draw-map.svg',
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

async function selectDrawingTool(page: Page) {
  await page.getByTestId('tool-drawing').click();
  await expect(page.getByTestId('drawing-settings-panel')).toBeVisible();
}

async function stageBox(page: Page) {
  return (await page.getByTestId('active-map-stage').boundingBox())!;
}

/** Drag the mouse along a polyline of [fx, fy] stage fractions (down→up). */
async function dragPath(page: Page, pts: Array<[number, number]>) {
  const box = await stageBox(page);
  const toX = (fx: number) => box.x + box.width * fx;
  const toY = (fy: number) => box.y + box.height * fy;
  await page.mouse.move(toX(pts[0]![0]), toY(pts[0]![1]));
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    await page.mouse.move(toX(pts[i]![0]), toY(pts[i]![1]), { steps: 8 });
  }
  await page.mouse.up();
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
  // Keep tests independent: clear all drawings on the map between them.
  if (provisioned?.mapId) {
    await drawings().deleteMany({ mapId: new ObjectId(provisioned.mapId) });
  }
});

test.afterAll(async () => {
  if (!client) return;
  if (provisioned?.campaignId) {
    const cid = new ObjectId(provisioned.campaignId);
    await drawings().deleteMany({ campaignId: cid });
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

test('selecting the drawing tool opens a settings popup with shape/color/size/fill', async ({
  page,
}) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);

  const panel = page.getByTestId('drawing-settings-panel');
  await expect(panel.getByTestId('draw-shape-pencil')).toBeVisible();
  await expect(panel.getByTestId('draw-shape-square')).toBeVisible();
  await expect(panel.getByTestId('draw-shape-circle')).toBeVisible();
  await expect(panel.getByTestId('draw-shape-eraser')).toBeVisible();
  await expect(panel.getByTestId('draw-size-8')).toBeVisible();
  await expect(panel.getByTestId('draw-size-input')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Select color #e74c3c' })).toBeVisible();

  // The fill/outline toggle appears for square/circle.
  await panel.getByTestId('draw-shape-square').click();
  await expect(panel.getByTestId('draw-shape-square')).toHaveAttribute('aria-pressed', 'true');
  const fill = panel.getByTestId('draw-fill-toggle');
  await expect(fill).toBeVisible();
  await expect(fill).toHaveAttribute('aria-pressed', 'false');
  await fill.click();
  await expect(fill).toHaveAttribute('aria-pressed', 'true');

  // No close affordance — it stays open while the tool is active.
  await expect(page.getByRole('button', { name: 'Close drawing settings' })).toHaveCount(0);
});

test('pencil click-drag draws a stroke that renders and persists', async ({ page }) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);

  await dragPath(page, [
    [0.4, 0.4],
    [0.5, 0.5],
    [0.6, 0.45],
    [0.65, 0.55],
  ]);

  const stroke = page.getByTestId('map-drawing');
  await expect(stroke).toHaveCount(1);
  await expect(stroke).toHaveAttribute('data-drawing-kind', 'pencil');

  // Persisted as a pencil doc with a non-empty points array.
  await expect.poll(() => countDrawings({ kind: 'pencil' })).toBe(1);
  const doc = await drawings().findOne({ mapId: new ObjectId(provisioned.mapId), kind: 'pencil' });
  expect(Array.isArray((doc as { points?: number[] } | null)?.points)).toBe(true);
  expect(((doc as { points?: number[] } | null)?.points ?? []).length).toBeGreaterThanOrEqual(4);
});

test('changing the line size applies to a new drawing', async ({ page }) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);

  const panel = page.getByTestId('drawing-settings-panel');
  await panel.getByTestId('draw-shape-square').click();
  await panel.getByTestId('draw-size-16').click();
  await expect(panel.getByTestId('draw-size-16')).toHaveAttribute('aria-pressed', 'true');

  await dragPath(page, [
    [0.4, 0.4],
    [0.6, 0.6],
  ]);

  await expect.poll(() => countDrawings({ kind: 'rect' })).toBe(1);
  await expect
    .poll(async () => {
      const doc = await drawings().findOne({
        mapId: new ObjectId(provisioned.mapId),
        kind: 'rect',
      });
      return (doc as { strokeWidth?: number } | null)?.strokeWidth ?? 0;
    })
    .toBe(16);
});

test('the eraser removes a drawn stroke (DOM + DB)', async ({ page }) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);

  // Draw a pencil stroke.
  const path: Array<[number, number]> = [
    [0.4, 0.4],
    [0.5, 0.5],
    [0.6, 0.5],
  ];
  await dragPath(page, path);
  await expect(page.getByTestId('map-drawing')).toHaveCount(1);
  await expect.poll(() => countDrawings()).toBe(1);

  // Switch to the eraser with a generous size and drag across the stroke.
  const panel = page.getByTestId('drawing-settings-panel');
  await panel.getByTestId('draw-shape-eraser').click();
  await panel.getByTestId('draw-size-32').click();
  await dragPath(page, path);

  await expect(page.getByTestId('map-drawing')).toHaveCount(0);
  await expect.poll(() => countDrawings()).toBe(0);
});

test('square outline draws in the chosen color and persists', async ({ page }) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);

  const panel = page.getByTestId('drawing-settings-panel');
  await panel.getByTestId('draw-shape-square').click();
  await panel.getByRole('button', { name: 'Select color #2ecc71' }).click();

  await dragPath(page, [
    [0.4, 0.4],
    [0.6, 0.6],
  ]);

  const rect = page.getByTestId('map-drawing');
  await expect(rect).toHaveAttribute('data-drawing-kind', 'rect');
  await expect(rect).toHaveAttribute('data-filled', 'false');
  await expect(rect).toHaveAttribute('stroke', '#2ecc71');
  await expect(rect).toHaveAttribute('fill', 'none');

  await expect
    .poll(async () => {
      const doc = await drawings().findOne({
        mapId: new ObjectId(provisioned.mapId),
        kind: 'rect',
      });
      return (doc as { color?: string; filled?: boolean } | null)?.color ?? '';
    })
    .toBe('#2ecc71');
  const doc = await drawings().findOne({ mapId: new ObjectId(provisioned.mapId), kind: 'rect' });
  expect((doc as { filled?: boolean } | null)?.filled).toBe(false);
});

test('square filled draws in the chosen color and persists', async ({ page }) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);

  const panel = page.getByTestId('drawing-settings-panel');
  await panel.getByTestId('draw-shape-square').click();
  await panel.getByTestId('draw-fill-toggle').click();
  await panel.getByRole('button', { name: 'Select color #3498db' }).click();

  await dragPath(page, [
    [0.4, 0.4],
    [0.6, 0.6],
  ]);

  const rect = page.getByTestId('map-drawing');
  await expect(rect).toHaveAttribute('data-filled', 'true');
  await expect(rect).toHaveAttribute('fill', '#3498db');

  await expect.poll(() => countDrawings({ kind: 'rect', filled: true })).toBe(1);
});

test('circle filled and outline draw in the chosen color and persist', async ({ page }) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);

  const panel = page.getByTestId('drawing-settings-panel');
  await panel.getByTestId('draw-shape-circle').click();
  await panel.getByRole('button', { name: 'Select color #e67e22' }).click();

  // Outline circle.
  await dragPath(page, [
    [0.35, 0.35],
    [0.5, 0.5],
  ]);
  const ellipse = page.getByTestId('map-drawing');
  await expect(ellipse).toHaveAttribute('data-drawing-kind', 'ellipse');
  await expect(ellipse).toHaveAttribute('stroke', '#e67e22');
  await expect(ellipse).toHaveAttribute('fill', 'none');
  await expect.poll(() => countDrawings({ kind: 'ellipse' })).toBe(1);

  // Filled circle.
  await panel.getByTestId('draw-fill-toggle').click();
  await dragPath(page, [
    [0.55, 0.55],
    [0.7, 0.7],
  ]);
  await expect.poll(() => countDrawings({ kind: 'ellipse', filled: true })).toBe(1);
  await expect.poll(() => countDrawings({ kind: 'ellipse' })).toBe(2);
});

test('the pointer tool selects a shape; the handle resizes it and Delete removes it', async ({
  page,
}) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);

  const panel = page.getByTestId('drawing-settings-panel');
  await panel.getByTestId('draw-shape-square').click();
  await dragPath(page, [
    [0.4, 0.4],
    [0.55, 0.55],
  ]);
  await expect.poll(() => countDrawings({ kind: 'rect' })).toBe(1);

  const widthOf = async () => {
    const doc = await drawings().findOne({ mapId: new ObjectId(provisioned.mapId), kind: 'rect' });
    return (doc as { width?: number } | null)?.width ?? 0;
  };
  const beforeWidth = await widthOf();
  expect(beforeWidth).toBeGreaterThan(0);

  // Select with the pointer tool.
  await page.getByTestId('tool-pointer').click();
  await page.getByTestId('map-drawing').click();
  await expect(page.getByTestId('drawing-selection')).toBeVisible();

  // Drag the corner handle outward — the bbox grows.
  const handle = page.getByTestId('drawing-resize-handle');
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 160, h.y + 140, { steps: 10 });
  await page.mouse.up();

  await expect.poll(widthOf).toBeGreaterThan(beforeWidth + 5);

  // Delete removes it (DOM + DB).
  await page.getByTestId('map-drawing').click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('map-drawing')).toHaveCount(0);
  await expect.poll(() => countDrawings()).toBe(0);
});

test('the pointer tool can drag a selected shape to a new spot', async ({ page }) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);
  await page.getByTestId('drawing-settings-panel').getByTestId('draw-shape-square').click();
  await dragPath(page, [
    [0.35, 0.35],
    [0.5, 0.5],
  ]);
  await expect.poll(() => countDrawings({ kind: 'rect' })).toBe(1);

  const geom = async () =>
    (await drawings().findOne({ mapId: new ObjectId(provisioned.mapId), kind: 'rect' })) as {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    } | null;
  const before = await geom();
  const x0 = before?.x ?? 0;
  const y0 = before?.y ?? 0;
  const w0 = before?.width ?? 0;
  const h0 = before?.height ?? 0;
  expect(w0).toBeGreaterThan(0);

  // Pointer tool: drag the shape itself (not a handle) to a new spot.
  await page.getByTestId('tool-pointer').click();
  const rect = page.getByTestId('map-drawing');
  await expect(rect).toBeVisible();
  const b = (await rect.boundingBox())!;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 180, cy + 130, { steps: 10 });
  await page.mouse.up();

  // It is selected and visibly moved…
  await expect(page.getByTestId('drawing-selection')).toBeVisible();
  await expect.poll(async () => (await rect.boundingBox())?.x ?? b.x).toBeGreaterThan(b.x + 40);

  // …the new position persisted, and the size is unchanged.
  await expect.poll(async () => (await geom())?.x ?? x0).toBeGreaterThan(x0 + 1);
  const after = await geom();
  expect(after?.y ?? y0).toBeGreaterThan(y0 + 1);
  expect(Math.round(after?.width ?? 0)).toBe(Math.round(w0));
  expect(Math.round(after?.height ?? 0)).toBe(Math.round(h0));
});

test('a GM can drag a pencil stroke to a new spot', async ({ page }) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);
  await dragPath(page, [
    [0.4, 0.4],
    [0.5, 0.5],
    [0.6, 0.45],
  ]);
  await expect.poll(() => countDrawings({ kind: 'pencil' })).toBe(1);

  const pencilPoints = async () => {
    const doc = await drawings().findOne({
      mapId: new ObjectId(provisioned.mapId),
      kind: 'pencil',
    });
    return (doc as { points?: number[] } | null)?.points ?? [];
  };
  const pts = await pencilPoints();
  const before = pts[0] ?? 0;

  // Grab the stroke at a point guaranteed to be on the line (the midpoint of its
  // first segment), mapped from map-local pixels to DOM the same way the stage
  // renders it (fit-scale, centred, zoom 1). A thin line only responds where it
  // is actually drawn, so bounding-box centre is unreliable.
  await page.getByTestId('tool-pointer').click();
  const box = await stageBox(page);
  const fit = Math.min(box.width / 1024, box.height / 1024);
  const offX = box.x + (box.width - 1024 * fit) / 2;
  const offY = box.y + (box.height - 1024 * fit) / 2;
  const mx = (pts[0]! + pts[2]!) / 2;
  const my = (pts[1]! + pts[3]!) / 2;
  const gx = offX + mx * fit;
  const gy = offY + my * fit;
  // Ensure the committed stroke is rendered before grabbing it (a miss would
  // start a pan instead of a move).
  await expect(page.getByTestId('map-drawing')).toHaveCount(1);
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 150, gy + 90, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByTestId('drawing-selection')).toBeVisible();
  await expect.poll(async () => (await pencilPoints())[0] ?? before).toBeGreaterThan(before + 1);
});

test("a GM can delete another user's drawing", async ({ page }) => {
  const now = new Date();
  await drawings().insertOne({
    mapId: new ObjectId(provisioned.mapId),
    campaignId: new ObjectId(provisioned.campaignId),
    kind: 'rect',
    color: '#9b59b6',
    strokeWidth: 4,
    filled: true,
    points: [],
    x: 300,
    y: 300,
    width: 200,
    height: 160,
    createdBy: new ObjectId(provisioned.otherUserId),
    createdAt: now,
    updatedAt: now,
  });

  await gotoTabletop(page);
  await page.getByTestId('tool-pointer').click();

  const rect = page.getByTestId('map-drawing');
  await expect(rect).toBeVisible({ timeout: 20000 });
  await rect.click();
  await expect(page.getByTestId('drawing-selection')).toBeVisible();
  await page.keyboard.press('Delete');

  await expect(page.getByTestId('map-drawing')).toHaveCount(0);
  await expect.poll(() => countDrawings()).toBe(0);
});

test('the show/hide-drawings toggle hides and shows the layer', async ({ page }) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);
  await page.getByTestId('drawing-settings-panel').getByTestId('draw-shape-square').click();
  await dragPath(page, [
    [0.4, 0.4],
    [0.6, 0.6],
  ]);
  await expect(page.getByTestId('map-drawing')).toHaveCount(1);

  // Hide → no drawings rendered.
  await page.getByTestId('map-drawings-toggle').click();
  await expect(page.getByTestId('map-drawing')).toHaveCount(0);

  // Show → it returns.
  await page.getByTestId('map-drawings-toggle').click();
  await expect(page.getByTestId('map-drawing')).toHaveCount(1);
});

test('the Layers panel eye toggle hides and shows the Spell FX / Drawing layer', async ({
  page,
}) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);
  await page.getByTestId('drawing-settings-panel').getByTestId('draw-shape-square').click();
  await dragPath(page, [
    [0.4, 0.4],
    [0.6, 0.6],
  ]);
  await expect(page.getByTestId('map-drawing')).toHaveCount(1);
  await expect.poll(() => countDrawings()).toBe(1);

  // Open the GM Layers panel and hide the Spell FX / Drawing layer via its eye.
  await page.getByTestId('tool-layer').click();
  const panel = page.getByTestId('layers-panel');
  await expect(panel).toBeVisible();
  const eye = panel.getByTestId('layer-visibility-spell-fx');
  await expect(eye).toHaveAttribute('aria-pressed', 'true'); // currently visible
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'false'); // now hidden

  // The whole drawing layer is hidden (not just one shape) — but nothing is
  // deleted: it's a per-viewer visibility toggle.
  await expect(page.getByTestId('map-drawing')).toHaveCount(0);
  await expect(page.getByTestId('map-drawing-layer')).toHaveCount(0);
  await expect.poll(() => countDrawings()).toBe(1);

  // Toggling the eye back shows the layer + drawings again.
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('map-drawing-layer')).toHaveCount(1);
  await expect(page.getByTestId('map-drawing')).toHaveCount(1);
});

test('the GM clear-all button empties the map', async ({ page }) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);

  const panel = page.getByTestId('drawing-settings-panel');
  await panel.getByTestId('draw-shape-square').click();
  await dragPath(page, [
    [0.35, 0.35],
    [0.45, 0.45],
  ]);
  await panel.getByTestId('draw-shape-circle').click();
  await dragPath(page, [
    [0.55, 0.55],
    [0.7, 0.7],
  ]);
  await expect.poll(() => countDrawings()).toBe(2);

  await page.getByTestId('map-clear-drawings').click();
  await page.getByTestId('map-clear-drawings-confirm').click();

  await expect(page.getByTestId('map-drawing')).toHaveCount(0);
  await expect.poll(() => countDrawings()).toBe(0);
});

test('drawings persist across a reload', async ({ page }) => {
  await gotoTabletop(page);
  await selectDrawingTool(page);
  await page.getByTestId('drawing-settings-panel').getByTestId('draw-shape-square').click();
  await dragPath(page, [
    [0.4, 0.4],
    [0.6, 0.6],
  ]);
  await expect.poll(() => countDrawings()).toBe(1);

  await page.reload();
  await expect(page.getByTestId('active-map-stage')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('map-drawing')).toHaveCount(1);
});
