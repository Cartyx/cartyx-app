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
 * 5. Idempotently upserts the audio-library E2E fixtures (`e2e/fixtures/audio-
 *    fixtures.ts`) owned by that GM user, so `audio-library.spec.ts` has real
 *    rows — including `ready` ones — without depending on the transcode
 *    worker, which does not run in E2E.
 * 6. Writes the cookie to `e2e/.auth/storageState.json` so every test starts authed.
 * 7. Writes campaign/location/screen ids to `e2e/.auth/seed-data.json` for fixtures.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import mongoose from 'mongoose';
import { AUDIO_FIXTURE_TITLES } from './fixtures/audio-fixtures';

// Image titled to be stable across runs — the lightbox spec asserts on this alt text.
const E2E_IMAGE_TITLE = 'E2E Lightbox Fixture';
const E2E_SCREEN_NAME = 'E2E Test Screen';

const AUTH_DIR = join(process.cwd(), 'e2e', '.auth');
const STORAGE_STATE_PATH = join(AUTH_DIR, 'storageState.json');
const SEED_DATA_PATH = join(AUTH_DIR, 'seed-data.json');

/** A fake but well-formed rendition — enough for `pickPlaybackSources` (app/routes/audio.tsx)
 *  to treat the asset as playable, without any real transcoded bytes existing in R2. */
function fakeRendition(sourceKey: string, ext: 'opus' | 'aac') {
  return {
    key: `${sourceKey}.${ext}`,
    url: `https://cdn.example.com/${sourceKey}.${ext}`,
    bytes: 123_456,
  };
}

/** Deterministic 0..1 peak buckets — shape doesn't matter, only that peaks.length > 0 so AudioWaveform renders bars instead of its "no peaks yet" placeholder. */
function fakePeaks(count = 40): number[] {
  return Array.from(
    { length: count },
    (_, i) => Math.round(((Math.sin(i / 3) + 1) / 2) * 100) / 100
  );
}

type AudioFixtureDef = {
  title: string;
  kind: 'music' | 'ambience' | 'one-shot';
  status: 'ready' | 'processing';
  environment?: string[];
  mood?: string[];
  tags?: string[];
  intensity?: number | null;
};

/**
 * Idempotently upserts one `AudioAsset` document per `e2e/fixtures/audio-
 * fixtures.ts` entry, owned by `ownerId`, matched on a stable `sourceKey`
 * (not `title` — the edit-modal spec renames its fixture, so title can't be
 * the natural key or a rename would orphan the original doc from future
 * upserts). Every mutable field is reset via `$set` on every run so a
 * previous run's edits/bulk-tags don't leak into the next; `createdAt` is
 * preserved via `$setOnInsert` so list ordering stays stable across runs.
 * Talks to `audioassets` via the raw driver (matching this file's existing
 * location/screen seeding), not the Mongoose model, so globalSetup doesn't
 * need to import application server code.
 */
async function seedAudioFixtures(
  db: NonNullable<typeof mongoose.connection.db>,
  ownerId: unknown
): Promise<void> {
  const defs: AudioFixtureDef[] = [
    {
      title: AUDIO_FIXTURE_TITLES.ambienceReady,
      kind: 'ambience',
      status: 'ready',
      environment: ['forest'],
      mood: ['calm'],
      tags: ['storm'],
      intensity: 3,
    },
    {
      title: AUDIO_FIXTURE_TITLES.musicUntagged,
      kind: 'music',
      status: 'ready',
      environment: [],
      mood: [],
      tags: [],
      intensity: null,
    },
    {
      title: AUDIO_FIXTURE_TITLES.oneShotProcessing,
      kind: 'one-shot',
      status: 'processing',
    },
    {
      title: AUDIO_FIXTURE_TITLES.editMe,
      kind: 'ambience',
      status: 'ready',
    },
    {
      title: AUDIO_FIXTURE_TITLES.deleteMe,
      kind: 'one-shot',
      status: 'ready',
    },
  ];

  for (const def of defs) {
    const sourceKey = `e2e/fixtures/audio/${def.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.wav`;
    const isReady = def.status === 'ready';

    const set: Record<string, unknown> = {
      ownerId,
      title: def.title,
      kind: def.kind,
      environment: def.environment ?? [],
      mood: def.mood ?? [],
      intensity: def.intensity ?? null,
      tags: def.tags ?? [],
      sourceKey,
      sourceBytes: 654_321,
      status: def.status,
      attempts: isReady ? 1 : 0,
      lastError: null,
      claimedAt: null,
      claimedBy: null,
      durationMs: isReady ? 42_000 : null,
      loudnessTargetLufs: isReady ? -20 : null,
      sampleRate: isReady ? 48_000 : null,
      channels: isReady ? 2 : null,
      peaks: isReady ? fakePeaks() : [],
      updatedAt: new Date(),
    };
    if (isReady) {
      set.renditions = {
        opus: fakeRendition(sourceKey, 'opus'),
        aac: fakeRendition(sourceKey, 'aac'),
      };
    } else {
      set.renditions = {};
    }

    await db
      .collection('audioassets')
      .findOneAndUpdate(
        { ownerId, sourceKey },
        { $set: set, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
  }
}

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
  // without hitting R2 — and it's a recognizable colored SVG (not a 1×1
  // transparent PNG) so manual testers can actually see it in the gallery.
  const fixtureImageKey = 'e2e/lightbox-fixture.svg';
  const fixturePublicUrl =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<rect width="64" height="64" fill="#4A90E2"/>' +
        '<text x="32" y="38" text-anchor="middle" fill="white" font-family="sans-serif" font-size="14" font-weight="bold">E2E</text>' +
        '</svg>'
    );
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

  await seedAudioFixtures(db, user._id);

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
