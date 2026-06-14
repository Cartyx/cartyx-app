/**
 * E2E: on a tab with NO active map, dragging a monster opens a floating window
 * (like characters/players) instead of placing a token.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Monster Window';

interface Provisioned {
  campaignId: string;
  monsterId: string;
}

let client: MongoClient;
let provisioned: Provisioned;

const ability = () => ({ score: 10, mod: 0, save: 0 });

async function provision(db: Db): Promise<Provisioned> {
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
    await db.collection('monsters').deleteMany({ campaignId: { $in: ids } });
    await db.collection('campaigns').deleteMany({ _id: { $in: ids } });
  }

  const now = new Date();
  const campaignId = (
    await db.collection('campaigns').insertOne({
      gameMasterId: gm._id,
      name: CAMPAIGN_NAME,
      description: 'E2E monster-window test.',
      status: 'active',
      inviteCode: 'e2e-' + Math.random().toString(36).slice(2, 12),
      maxPlayers: 6,
      members: [{ userId: gm._id, role: 'gm', joinedAt: now }],
      links: [],
      createdAt: now,
      updatedAt: now,
    })
  ).insertedId;

  const monsterId = (
    await db.collection('monsters').insertOne({
      campaignId,
      createdBy: gm._id,
      name: 'E2E Goblin',
      size: 'small',
      type: 'humanoid',
      subtype: 'goblinoid',
      alignment: 'neutral evil',
      cr: { value: 0.25, xp: 50, proficiencyBonus: 2 },
      armorClass: 15,
      armorClassNote: 'leather armor',
      hitPoints: { average: 7, formula: '2d6' },
      initiativeMod: 2,
      initiativePassive: 12,
      speeds: [{ kind: 'walk', feet: 30, notes: '' }],
      abilities: {
        str: ability(),
        dex: { score: 14, mod: 2, save: 2 },
        con: ability(),
        int: ability(),
        wis: ability(),
        cha: ability(),
      },
      skills: [{ name: 'Stealth', modifier: 6 }],
      resistances: [],
      immunities: [],
      vulnerabilities: [],
      conditionImmunities: [],
      senses: [{ name: 'darkvision', range: 60 }],
      passivePerception: 9,
      languages: ['Common', 'Goblin'],
      features: [
        { section: 'Traits', name: 'Nimble Escape', description: 'Disengage as a bonus action.' },
      ],
      picture: '',
      pictureCrop: null,
      color: '#22c55e',
      tags: [],
      notes: '',
      gmNotes: 'Cowardly; flees when bloodied.',
      createdAt: now,
      updatedAt: now,
    })
  ).insertedId;

  // A tab with NO active map → drops open windows, not tokens.
  await db.collection('tabletopscreen').deleteMany({ campaignId });
  await db.collection('tabletopscreen').insertOne({
    campaignId,
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

  return { campaignId: String(campaignId), monsterId: String(monsterId) };
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
    await db.collection('monsters').deleteMany({ campaignId: cid });
    await db.collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

test('dragging a monster onto a no-map tab opens a monster window', async ({ page }) => {
  await page.goto(`/campaigns/${provisioned.campaignId}/play?tab=tabletop`);
  await expect(page.getByTestId('tabletop-workspace')).toBeVisible({ timeout: 30000 });
  // No active map on this tab.
  await expect(page.getByTestId('active-map-stage')).toHaveCount(0);

  const monsterWindow = page.getByTestId('monster-window');

  // Drop the monster onto the workspace. Re-dropping is idempotent (windows
  // dedupe by collection+id), so poll-drop to absorb the screen-detail load.
  await expect
    .poll(
      async () => {
        await page.evaluate((documentId) => {
          const ws = document.querySelector(
            '[data-testid="tabletop-workspace"]'
          ) as HTMLElement | null;
          if (!ws) return;
          const rect = ws.getBoundingClientRect();
          const dt = new DataTransfer();
          dt.setData(
            'application/x-cartyx-document',
            JSON.stringify({ collection: 'monster', documentId, title: 'E2E Goblin' })
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
        }, provisioned.monsterId);
        return monsterWindow.count();
      },
      { timeout: 25000, intervals: [250, 500, 750, 1000] }
    )
    .toBeGreaterThan(0);

  // The window shows the monster's stat block.
  await expect(monsterWindow.first()).toBeVisible();
  await expect(monsterWindow.getByText('E2E Goblin').first()).toBeVisible();
  await expect(monsterWindow.getByText('Nimble Escape')).toBeVisible();
});
