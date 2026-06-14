/**
 * E2E: the active map is scoped to its tab (TabletopScreen), not the whole
 * campaign. Activating a map on one tab must NOT show it on other tabs.
 *
 * Provisions an isolated campaign with one map and two tabs — the map is active
 * on "Map Tab" only — then asserts the map renders when viewing that tab and
 * disappears when switching to the other tab.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Active Map Per-Tab';
const DATA_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#234"/></svg>'
  );

interface Provisioned {
  campaignId: string;
  mapTabId: string;
  emptyTabId: string;
}

let client: MongoClient;
let provisioned: Provisioned;

function screenDoc(extra: Record<string, unknown>) {
  return {
    mode: 'grid',
    gridStyle: 'dark',
    gridSize: 50,
    gridVisible: true,
    gridScale: 5,
    locationId: null,
    battleMapImage: null,
    windows: [],
    ...extra,
  };
}

async function provision(db: Db): Promise<Provisioned> {
  const storage = JSON.parse(
    readFileSync(join(process.cwd(), 'e2e', '.auth', 'storageState.json'), 'utf-8')
  ) as { cookies: Array<{ name: string; value: string }> };
  const cookie = storage.cookies.find((c) => c.name === 'cartyx_session');
  if (!cookie) throw new Error('No cartyx_session cookie — globalSetup did not run?');
  const providerId = (decodeJwt(cookie.value) as { user?: { id?: string } }).user?.id;
  const gm = await db.collection('users').findOne({ providerId });
  if (!gm?._id) throw new Error('Session GM user not found');

  // Nuke any prior run of this campaign.
  const stale = await db
    .collection('campaigns')
    .find({ name: CAMPAIGN_NAME }, { projection: { _id: 1 } })
    .toArray();
  if (stale.length) {
    const ids = stale.map((c) => c._id);
    await db.collection('tabletopscreen').deleteMany({ campaignId: { $in: ids } });
    await db.collection('map').deleteMany({ campaignId: { $in: ids } });
    await db.collection('campaigns').deleteMany({ _id: { $in: ids } });
  }

  const now = new Date();
  const campaignId = (
    await db.collection('campaigns').insertOne({
      gameMasterId: gm._id,
      name: CAMPAIGN_NAME,
      description: 'E2E per-tab active map test.',
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
      campaignId,
      createdBy: gm._id,
      name: 'E2E Map',
      tags: [],
      imageKey: 'e2e/per-tab-map.svg',
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

  const mapTabId = (
    await db.collection('tabletopscreen').insertOne(
      screenDoc({
        campaignId,
        name: 'Map Tab',
        tabOrder: 0,
        createdBy: gm._id,
        activeMapId: mapId, // map active on THIS tab only
        createdAt: now,
        updatedAt: now,
      })
    )
  ).insertedId;

  const emptyTabId = (
    await db.collection('tabletopscreen').insertOne(
      screenDoc({
        campaignId,
        name: 'Empty Tab',
        tabOrder: 1,
        createdBy: gm._id,
        activeMapId: null, // no map here
        createdAt: now,
        updatedAt: now,
      })
    )
  ).insertedId;

  return {
    campaignId: String(campaignId),
    mapTabId: String(mapTabId),
    emptyTabId: String(emptyTabId),
  };
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
  provisioned = await provision(db);
});

test.afterAll(async () => {
  if (!client) return;
  if (provisioned?.campaignId) {
    const db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
    const cid = new ObjectId(provisioned.campaignId);
    await db.collection('tabletopscreen').deleteMany({ campaignId: cid });
    await db.collection('map').deleteMany({ campaignId: cid });
    await db.collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

test('an activated map shows only on its own tab', async ({ page }) => {
  await page.goto(`/campaigns/${provisioned.campaignId}/play?tab=tabletop`);
  await expect(page.getByTestId('tabletop-tab-bar')).toBeVisible({ timeout: 30000 });

  const mapTab = page.getByTestId(`tabletop-tab-${provisioned.mapTabId}`);
  const emptyTab = page.getByTestId(`tabletop-tab-${provisioned.emptyTabId}`);
  const stage = page.getByTestId('active-map-stage');

  // Viewing the tab that has the map active → the map renders.
  await mapTab.click();
  await expect(stage).toBeVisible({ timeout: 15000 });

  // Switching to the other tab → the map is NOT shown there.
  await emptyTab.click();
  await expect(stage).toHaveCount(0, { timeout: 15000 });

  // Back to the map tab → it renders again (still scoped to this tab).
  await mapTab.click();
  await expect(stage).toBeVisible({ timeout: 15000 });
});
