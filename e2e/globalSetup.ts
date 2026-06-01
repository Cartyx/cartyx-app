/**
 * Playwright globalSetup — runs once before all specs.
 *
 * 1. Loads .env so SESSION_SECRET / MONGODB_URI are available.
 * 2. Finds the seeded GM user in Mongo (run `npm run dev:seed` first).
 * 3. Mints a `cartyx_session` JWT cookie matching the shape produced by
 *    `app/server/session.ts#setSession` — no production code paths exposed.
 * 4. Idempotently ensures lightbox prerequisites exist: the seeded location has
 *    at least one image and a tabletop screen exists with that location opened
 *    as a window. Lets the lightbox spec navigate straight to the Tabletop tab.
 * 5. Writes the cookie to `e2e/.auth/storageState.json` so every test starts authed.
 * 6. Writes campaign/location/screen ids to `e2e/.auth/seed-data.json` for fixtures.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import mongoose from 'mongoose';

// Image titled to be stable across runs — the lightbox spec asserts on this alt text.
const E2E_IMAGE_TITLE = 'E2E Lightbox Fixture';
const E2E_SCREEN_NAME = 'E2E Test Screen';

const AUTH_DIR = join(process.cwd(), 'e2e', '.auth');
const STORAGE_STATE_PATH = join(AUTH_DIR, 'storageState.json');
const SEED_DATA_PATH = join(AUTH_DIR, 'seed-data.json');

export default async function globalSetup(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env optional in CI when vars are set in the environment
  }

  const sessionSecret = process.env.SESSION_SECRET;
  const mongoUri = process.env.MONGODB_URI;
  if (!sessionSecret) throw new Error('SESSION_SECRET not set — needed to mint test JWT');
  if (!mongoUri) throw new Error('MONGODB_URI not set — needed to find seeded user');
  if (/prod/i.test(mongoUri)) throw new Error('Refusing to use a production-looking MONGODB_URI');

  await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB });
  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongo connection has no db handle');

  const user = await db.collection('users').findOne({ role: 'gm' });
  if (!user) {
    throw new Error(
      'No GM user found. Run `npm run dev:seed` (which requires a logged-in GM) before running E2E.'
    );
  }
  if (!user.providerId) throw new Error('GM user has no providerId — cannot mint session JWT');

  const campaign = await db
    .collection('campaigns')
    .findOne({ gameMasterId: user._id }, { sort: { createdAt: 1 } });
  if (!campaign) throw new Error('No seeded campaigns found for GM. Run `npm run dev:seed`.');

  const location = await db
    .collection('location')
    .findOne({ campaignId: campaign._id }, { sort: { createdAt: 1 } });
  if (!location) {
    throw new Error(
      'No seeded location found for campaign. Re-run `npm run dev:seed` after updating it.'
    );
  }

  // Ensure the location has the E2E fixture image so LocationGallery has a
  // thumbnail to click in the lightbox spec. Uses a stable imageKey for
  // idempotency. The publicUrl is a data: URL so the browser can render it
  // without hitting R2 — the lightbox just shows an <img src> regardless.
  const fixtureImageKey = 'e2e/lightbox-fixture.png';
  const fixturePublicUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const hasFixtureImage = (location.images ?? []).some(
    (img: { imageKey?: string }) => img.imageKey === fixtureImageKey
  );
  if (!hasFixtureImage) {
    await db.collection('location').updateOne(
      { _id: location._id },
      {
        $push: {
          images: {
            imageKey: fixtureImageKey,
            url: fixturePublicUrl,
            title: E2E_IMAGE_TITLE,
            uploadedAt: new Date(),
          },
        },
        $set: { updatedAt: new Date() },
      }
    );
  }

  // Ensure a tabletop screen exists with the location pre-opened as a window.
  // Use a stable name so re-running the suite reuses the same screen.
  const existingScreen = await db
    .collection('tabletopscreen')
    .findOne({ campaignId: campaign._id, name: E2E_SCREEN_NAME });

  let screenId: mongoose.Types.ObjectId;
  if (existingScreen) {
    screenId = existingScreen._id as mongoose.Types.ObjectId;
    const hasWindow = (existingScreen.windows ?? []).some(
      (w: { collection?: string; documentId?: unknown }) =>
        w.collection === 'location' && String(w.documentId) === String(location._id)
    );
    if (!hasWindow) {
      await db.collection('tabletopscreen').updateOne(
        { _id: screenId },
        {
          $push: {
            windows: {
              _id: new mongoose.Types.ObjectId(),
              collection: 'location',
              documentId: location._id,
              state: 'open',
              x: 100,
              y: 100,
              width: 480,
              height: 540,
              zIndex: 1,
            },
          },
          $set: { updatedAt: new Date() },
        }
      );
    }
  } else {
    // Pick a tabOrder that doesn't collide with existing screens for this campaign.
    const maxOrder = await db
      .collection('tabletopscreen')
      .find({ campaignId: campaign._id })
      .sort({ tabOrder: -1 })
      .limit(1)
      .toArray();
    const nextTabOrder = maxOrder.length > 0 ? (maxOrder[0]!.tabOrder ?? 0) + 1 : 0;

    const inserted = await db.collection('tabletopscreen').insertOne({
      campaignId: campaign._id,
      name: E2E_SCREEN_NAME,
      tabOrder: nextTabOrder,
      createdBy: user._id,
      mode: 'grid',
      gridStyle: 'dark',
      gridSize: 50,
      gridVisible: true,
      gridScale: 5,
      locationId: null,
      battleMapImage: null,
      windows: [
        {
          _id: new mongoose.Types.ObjectId(),
          collection: 'location',
          documentId: location._id,
          state: 'open',
          x: 100,
          y: 100,
          width: 480,
          height: 540,
          zIndex: 1,
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    screenId = inserted.insertedId;
  }

  // Mirror SessionUser shape from app/server/session.ts
  const sessionUser = {
    id: user.providerId,
    provider: user.provider ?? 'test',
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    email: user.email ?? null,
    avatar: user.avatarUrl ?? null,
    role: user.role ?? 'gm',
    accessToken: null,
    refreshToken: null,
    tokenIssuedAt: Math.floor(Date.now() / 1000),
  };

  const token = await new SignJWT({ user: sessionUser })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(new TextEncoder().encode(sessionSecret));

  mkdirSync(AUTH_DIR, { recursive: true });

  const storageState = {
    cookies: [
      {
        name: 'cartyx_session',
        value: token,
        domain: 'localhost',
        path: '/',
        // 24h from now — matches default setSession maxAge
        expires: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };
  writeFileSync(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2));

  const seedData = {
    campaignId: String(campaign._id),
    locationId: String(location._id),
    locationName: location.name,
    screenId: String(screenId),
    fixtureImageTitle: E2E_IMAGE_TITLE,
  };
  writeFileSync(SEED_DATA_PATH, JSON.stringify(seedData, null, 2));

  await mongoose.disconnect();
}
