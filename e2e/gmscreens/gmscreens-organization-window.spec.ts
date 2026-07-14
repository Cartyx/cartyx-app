/**
 * E2E: organizations can be dragged onto a GM screen and open a floating
 * organization window, exactly like monsters/characters/lore. Regression guard
 * mirroring gmscreens-monster-window.spec.ts — the class of bug where a new
 * collection is wired into the Tabletop system but not the parallel GM-screen
 * SUPPORTED_COLLECTIONS / COLLECTION_REGISTRY / render branch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E GM Screen Organization';
const ORG_NAME = 'E2E Adventurers Guild';
const ORG_MARKER = 'E2E-ORG-PUBLIC-MARKER';

interface Provisioned {
  campaignId: string;
  organizationId: string;
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

  // Clear any leftovers from a previous run.
  const stale = await database
    .collection('campaigns')
    .find({ name: CAMPAIGN_NAME }, { projection: { _id: 1 } })
    .toArray();
  if (stale.length) {
    const ids = stale.map((c) => c._id);
    await database.collection('gmscreen').deleteMany({ campaignId: { $in: ids } });
    await database.collection('organizations').deleteMany({ campaignId: { $in: ids } });
    await database.collection('campaigns').deleteMany({ _id: { $in: ids } });
  }

  const now = new Date();
  const campaignId = (
    await database.collection('campaigns').insertOne({
      gameMasterId: gm._id,
      name: CAMPAIGN_NAME,
      description: 'E2E GM-screen organization-window test.',
      status: 'active',
      inviteCode: 'e2e-' + Math.random().toString(36).slice(2, 12),
      maxPlayers: 6,
      members: [{ userId: gm._id, role: 'gm', joinedAt: now }],
      links: [],
      createdAt: now,
      updatedAt: now,
    })
  ).insertedId;

  const organizationId = (
    await database.collection('organizations').insertOne({
      campaignId,
      createdBy: gm._id,
      name: ORG_NAME,
      publicInfo: `A guild of heroes. ${ORG_MARKER}`,
      privateInfo: '',
      isPublic: true,
      images: [],
      locations: [],
      tags: ['e2e'],
      createdAt: now,
      updatedAt: now,
    })
  ).insertedId;

  // A GM screen to drop the org onto.
  await database.collection('gmscreen').insertOne({
    campaignId,
    name: 'Factions',
    tabOrder: 0,
    createdBy: gm._id,
    windows: [],
    stacks: [],
    createdAt: now,
    updatedAt: now,
  });

  return { campaignId: String(campaignId), organizationId: String(organizationId) };
}

/** Synthesize a document drop onto the GM-screen workspace. */
async function dropOnScreen(page: Page, collection: string, documentId: string, title: string) {
  await page.evaluate(
    ({ collection, documentId, title }) => {
      const ws = document.querySelector(
        '[data-testid="gmscreens-view"] [role="tabpanel"]'
      ) as HTMLElement | null;
      if (!ws) return;
      const rect = ws.getBoundingClientRect();
      const dt = new DataTransfer();
      dt.setData(
        'application/x-cartyx-document',
        JSON.stringify({ collection, documentId, title })
      );
      for (const type of ['dragenter', 'dragover', 'drop'] as const) {
        const ev = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        });
        Object.defineProperty(ev, 'dataTransfer', { value: dt });
        ws.dispatchEvent(ev);
      }
    },
    { collection, documentId, title }
  );
}

async function gotoGMScreens(page: Page) {
  await page.goto(`/campaigns/${provisioned.campaignId}/play?tab=gmscreens`);
  const view = page.getByTestId('gmscreens-view');
  try {
    await expect(view).toBeVisible({ timeout: 20000 });
  } catch {
    await page.reload();
    await expect(view).toBeVisible({ timeout: 20000 });
  }
  await expect(page.locator('[data-testid="gmscreens-view"] [role="tabpanel"]')).toBeVisible({
    timeout: 15000,
  });
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
    await db().collection('gmscreen').deleteMany({ campaignId: cid });
    await db().collection('organizations').deleteMany({ campaignId: cid });
    await db().collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

test('dragging an organization onto a GM screen opens an organization window', async ({ page }) => {
  await gotoGMScreens(page);

  const orgWindow = page.getByTestId('organization-window');

  await expect
    .poll(
      async () => {
        await dropOnScreen(page, 'organization', provisioned.organizationId, ORG_NAME);
        return orgWindow.count();
      },
      { timeout: 25000, intervals: [250, 500, 750, 1000] }
    )
    .toBeGreaterThan(0);

  await expect(orgWindow.first()).toBeVisible();
  await expect(page.getByText(ORG_MARKER).first()).toBeVisible();
});

test('the organization window persists across a reload (stored on the screen)', async ({
  page,
}) => {
  await gotoGMScreens(page);
  await expect(page.getByTestId('organization-window').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(ORG_MARKER).first()).toBeVisible();
});
