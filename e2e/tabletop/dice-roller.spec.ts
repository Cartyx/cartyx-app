// e2e/tabletop/dice-roller.spec.ts
/**
 * E2E: the toolbar dice tool opens the dice roller window; rolls show a
 * per-die breakdown; public rolls appear in the Inspector Dice tab.
 *
 * The PartyKit `main` party is mocked with routeWebSocket (the e2e web server
 * only runs `npm run dev`): we act as the server — HISTORY on connect, echo
 * DICE messages back with a server-assigned seq.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';
import { mockPostHog } from '../fixtures/network-mocks';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Dice Roller';

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
    await db.collection('tabletopscreen').deleteMany({ campaignId: { $in: ids } });
    await db.collection('sessions').deleteMany({ campaignId: { $in: ids } });
    await db.collection('dicerolls').deleteMany({ campaignId: { $in: ids } });
    await db.collection('campaigns').deleteMany({ _id: { $in: ids } });
  }

  const now = new Date();
  const cid = (
    await db.collection('campaigns').insertOne({
      gameMasterId: gm._id,
      name: CAMPAIGN_NAME,
      description: 'E2E dice roller test.',
      status: 'active',
      inviteCode: 'e2e-' + Math.random().toString(36).slice(2, 12),
      maxPlayers: 6,
      members: [{ userId: gm._id, role: 'gm', joinedAt: now }],
      links: [],
      createdAt: now,
      updatedAt: now,
    })
  ).insertedId;

  // An ACTIVE session — the sidebar only opens a socket when one exists.
  await db.collection('sessions').insertOne({
    campaignId: cid,
    name: 'Dice Session',
    gm: gm._id,
    number: 1,
    startDate: now,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });

  // A tab with no active map keeps the workspace simple.
  await db.collection('tabletopscreen').insertOne({
    campaignId: cid,
    name: 'Main',
    tabOrder: 0,
    createdBy: gm._id,
    mode: 'grid',
    gridStyle: 'dark',
    gridSize: 50,
    gridVisible: true,
    gridScale: 5,
    locationId: null,
    battleMapImage: null,
    activeMapId: null,
    windows: [],
    createdAt: now,
    updatedAt: now,
  });

  return String(cid);
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
    await db.collection('tabletopscreen').deleteMany({ campaignId: cid });
    await db.collection('sessions').deleteMany({ campaignId: cid });
    await db.collection('dicerolls').deleteMany({ campaignId: cid });
    await db.collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

/** Mock the PartyKit `main` party: HISTORY on connect, echo DICE with a seq. */
async function mockMainParty(page: Page): Promise<void> {
  let seq = 0;
  await page.routeWebSocket(
    (url) => /\/parties\/main\//.test(url.href),
    (ws) => {
      ws.send(JSON.stringify({ type: 'HISTORY', messages: [] }));
      ws.onMessage((message) => {
        const msg = JSON.parse(message as string) as { type?: string };
        if (msg.type === 'DICE') {
          seq += 1;
          ws.send(JSON.stringify({ ...msg, seq }));
        }
      });
    }
  );
}

async function openRoller(page: Page): Promise<void> {
  await mockPostHog(page);
  await mockMainParty(page);
  await page.goto(`/campaigns/${campaignId}/play?tab=tabletop`);
  await expect(page.getByTestId('tabletop-workspace')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('tool-dice').click();
  await expect(page.getByTestId('dice-roller-panel')).toBeVisible();
}

test('private roll shows a verifiable per-die breakdown and stays out of the feed', async ({
  page,
}) => {
  await openRoller(page);

  await page.getByTestId('dice-roller-privacy-private').click();
  for (let i = 0; i < 3; i++) await page.getByTestId('dice-roller-die-6').click();
  for (let i = 0; i < 4; i++) await page.getByTestId('dice-roller-modifier-inc').click();
  await page.getByTestId('dice-roller-roll').click();

  const result = page.getByTestId('dice-roller-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('3d6 + 4');

  // Verify the math the way a suspicious player would: dice sum + modifier = total.
  const text = (await result.textContent()) ?? '';
  const breakdown = text.match(/\((\d+) \+ (\d+) \+ (\d+)\)\s*\+\s*4\s*=\s*(\d+)/);
  expect(breakdown, `no per-die breakdown in: ${text}`).not.toBeNull();
  const [, a, b, c, total] = breakdown!.map(Number) as unknown as number[];
  for (const die of [a!, b!, c!]) {
    expect(die).toBeGreaterThanOrEqual(1);
    expect(die).toBeLessThanOrEqual(6);
  }
  expect(a! + b! + c! + 4).toBe(total);

  // Private: the Dice tab feed stays empty.
  await page.getByTestId('inspector-tab-dice').click();
  await expect(page.getByTestId('inspector-panel')).not.toContainText('3d6 + 4');
});

test('public roll appears in the Dice tab feed like a Beyond20 card', async ({ page }) => {
  await openRoller(page);

  await page.getByTestId('dice-roller-die-20').click();
  // Public is the default. On a cold CI dev server the PartyKit socket
  // (server-fn token fetch + connect) can still be handshaking when we roll,
  // which surfaces the "not connected" notice and keeps the roll local.
  // Re-roll until one is delivered — refused attempts broadcast nothing, so
  // exactly one card reaches the feed regardless of how many tries this takes.
  await page.getByTestId('dice-roller-roll').click();
  await expect(page.getByTestId('dice-roller-result')).toBeVisible();
  await expect
    .poll(
      async () => {
        if ((await page.getByTestId('dice-roller-notice').count()) === 0) return 0;
        await page.getByTestId('dice-roller-roll').click();
        return page.getByTestId('dice-roller-notice').count();
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] }
    )
    .toBe(0);

  await page.getByTestId('inspector-tab-dice').click();
  const feed = page.getByTestId('inspector-panel');
  await expect(feed).toContainText('1d20');
  await expect(feed).toContainText('Result');
});

test('advantage rolls twice and strikes through the discarded set', async ({ page }) => {
  await openRoller(page);

  await page.getByTestId('dice-roller-die-20').click();
  await page.getByTestId('dice-roller-mode-advantage').click();
  await page.getByTestId('dice-roller-privacy-private').click();
  await page.getByTestId('dice-roller-roll').click();

  const result = page.getByTestId('dice-roller-result');
  await expect(result).toContainText('Mode: Advantage');
  await expect(result.locator('.line-through')).toHaveCount(1);
});
