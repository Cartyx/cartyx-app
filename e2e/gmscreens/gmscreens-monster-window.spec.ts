/**
 * E2E: monsters can be dragged onto a GM screen and open a floating monster
 * window, exactly like characters and players. Regression guard for the bug
 * where 'monster' was missing from the GM-screen SUPPORTED_COLLECTIONS /
 * COLLECTION_REGISTRY (it had only been wired into the parallel Tabletop system).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E GM Screen Monster';

interface Provisioned {
  campaignId: string;
  monsterId: string;
  characterId: string;
}

let client: MongoClient;
let provisioned: Provisioned;

const ability = () => ({ score: 10, mod: 0, save: 0 });

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
    await database.collection('monsters').deleteMany({ campaignId: { $in: ids } });
    await database.collection('characters').deleteMany({ campaignId: { $in: ids } });
    await database.collection('campaigns').deleteMany({ _id: { $in: ids } });
  }

  const now = new Date();
  const campaignId = (
    await database.collection('campaigns').insertOne({
      gameMasterId: gm._id,
      name: CAMPAIGN_NAME,
      description: 'E2E GM-screen monster-window test.',
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
    await database.collection('monsters').insertOne({
      campaignId,
      createdBy: gm._id,
      name: 'E2E Owlbear',
      size: 'large',
      type: 'monstrosity',
      subtype: '',
      alignment: 'unaligned',
      cr: { value: 3, xp: 700, proficiencyBonus: 2 },
      armorClass: 13,
      armorClassNote: 'natural armor',
      hitPoints: { average: 59, formula: '7d10+21' },
      initiativeMod: 1,
      initiativePassive: 11,
      speeds: [{ kind: 'walk', feet: 40, notes: '' }],
      abilities: {
        str: { score: 20, mod: 5, save: 5 },
        dex: { score: 12, mod: 1, save: 1 },
        con: { score: 17, mod: 3, save: 3 },
        int: ability(),
        wis: { score: 12, mod: 1, save: 1 },
        cha: ability(),
      },
      skills: [{ name: 'Perception', modifier: 3 }],
      resistances: [],
      immunities: [],
      vulnerabilities: [],
      conditionImmunities: [],
      senses: [{ name: 'darkvision', range: 60 }],
      passivePerception: 13,
      languages: [],
      features: [
        {
          section: 'Actions',
          name: 'Multiattack',
          description: 'The owlbear makes two attacks: one with its beak and one with its claws.',
        },
      ],
      picture: '',
      pictureCrop: null,
      color: '#a855f7',
      tags: [],
      notes: '',
      gmNotes: 'Aggressive; attacks on sight.',
      createdAt: now,
      updatedAt: now,
    })
  ).insertedId;

  const characterId = (
    await database.collection('characters').insertOne({
      campaignId,
      createdBy: gm._id,
      firstName: 'E2E',
      lastName: 'Bard',
      notes: 'A travelling musician.',
      isPublic: false,
      picture: '',
      createdAt: now,
      updatedAt: now,
    })
  ).insertedId;

  // A GM screen to drop documents onto.
  await database.collection('gmscreen').insertOne({
    campaignId,
    name: 'Encounters',
    tabOrder: 0,
    createdBy: gm._id,
    windows: [],
    stacks: [],
    createdAt: now,
    updatedAt: now,
  });

  return {
    campaignId: String(campaignId),
    monsterId: String(monsterId),
    characterId: String(characterId),
  };
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
  // Wait for the (auto-selected) screen workspace to be ready.
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
    await db().collection('monsters').deleteMany({ campaignId: cid });
    await db().collection('characters').deleteMany({ campaignId: cid });
    await db().collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

test('dragging a monster onto a GM screen opens a monster window', async ({ page }) => {
  await gotoGMScreens(page);

  const monsterWindow = page.getByTestId('monster-window');

  // Re-dropping is idempotent (windows dedupe by collection+id), so poll-drop
  // to absorb the screen-detail load.
  await expect
    .poll(
      async () => {
        await dropOnScreen(page, 'monster', provisioned.monsterId, 'E2E Owlbear');
        return monsterWindow.count();
      },
      { timeout: 25000, intervals: [250, 500, 750, 1000] }
    )
    .toBeGreaterThan(0);

  await expect(monsterWindow.first()).toBeVisible();
  await expect(monsterWindow.getByText('E2E Owlbear').first()).toBeVisible();
  await expect(monsterWindow.getByText('Multiattack')).toBeVisible();
});

test('the monster window persists across a reload (stored on the screen)', async ({ page }) => {
  await gotoGMScreens(page);
  // The previous test opened the monster window; it should rehydrate from the DB.
  await expect(page.getByTestId('monster-window').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('monster-window').getByText('E2E Owlbear').first()).toBeVisible();
});

test('characters still open alongside monsters (no regression)', async ({ page }) => {
  await gotoGMScreens(page);

  await expect
    .poll(
      async () => {
        await dropOnScreen(page, 'character', provisioned.characterId, 'E2E Bard');
        return page.getByText('E2E Bard').count();
      },
      { timeout: 25000, intervals: [250, 500, 750, 1000] }
    )
    .toBeGreaterThan(0);

  // Both the monster (from earlier) and the character are present.
  await expect(page.getByTestId('monster-window').first()).toBeVisible();
  await expect(page.getByText('E2E Bard').first()).toBeVisible();
});
