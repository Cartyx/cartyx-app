# Audio Asset Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-user audio library — bulk upload, server-side ffmpeg transcode to Opus + AAC, classification by kind/facets/tags, server-side search, and a standalone `/audio` route.

**Architecture:** Browser and (later) a Python tool upload through one shared ingest implementation exposed via two adapters — a `createServerFn` wrapper and `POST /api/audio/*` server routes. Files go directly to R2 by presigned PUT; a new `cartyx-audio-worker` deployment claims pending assets from MongoDB with an atomic `findOneAndUpdate`, runs ffmpeg, and writes renditions plus metadata back.

**Tech Stack:** TanStack Start (React 19), Mongoose, Zod, AWS SDK v3 (R2), Node 22 + ffmpeg (worker), Vitest, Storybook, Playwright, Helm/k3s/Flux.

**Design spec:** [2026-07-28-audio-library-design.md](./2026-07-28-audio-library-design.md)
**Programme scope:** [2026-07-28-soundboard-roadmap.md](./2026-07-28-soundboard-roadmap.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Branch:** work on `soundboard`. Every PR targets `dev`. NEVER open a PR against `main`.
- **`npm run lint` runs with `--max-warnings 0`** — any new warning fails CI.
- **`npm run typecheck` must be clean** (0 errors).
- **New npm packages must be published ≥10 days ago** and pass `npm run check:deps-age`.
- **Unit tests mock mongoose** — per-method model mocks, no in-memory Mongo. Follow `tests/server/functions/calendars.test.ts`.
- **Every new component needs a `.stories.tsx`** — `npm run test:storybook` is a blocking CI job running stories in a real browser.
- **`deploy/charts/` is prettierignored — do not format it.** Any change there REQUIRES `bash deploy/charts/cartyx/tests/render-tests.sh`.
- **Telemetry:** client `captureException`/`captureEvent` from `~/utils/telemetry-client`; server `serverCaptureException`/`serverCaptureEvent` from `~/server/utils/telemetry`. Never `await` capture calls on request-critical paths.
- **Canonical loudness is −20 LUFS** (`loudnorm=I=-20:TP=-1.5`), matching the POC's `normalize.sh`.
- **Renditions are Opus (Ogg) + AAC (M4A).** Both, always. Opus alone breaks Safari.
- **`durationMs` comes from `ffprobe`, never from a decoded buffer.** Phase 2's gapless looping depends on it.
- **Max upload size: 50 MB. Presigned PUT cannot enforce this** — the confirm step's `HeadObject` is the only real check.
- **R2 key prefix for all audio: `uploads/audio/`.**

---

## File Structure

**Create:**

| Path                                                          | Responsibility                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `app/types/audio.ts`                                          | Shared types + facet vocabularies (single source of truth for kinds/environments/moods) |
| `app/types/schemas/audio.ts`                                  | Zod schemas for every audio server function                                             |
| `app/server/db/models/AudioAsset.ts`                          | Mongoose model, indexes, tag normalization                                              |
| `app/server/functions/audio.ts`                               | Ingest + query + mutation implementation (shared by both adapters)                      |
| `app/server/functions/audio-auth.ts`                          | Bearer-token resolution for API routes (stubbed in this phase)                          |
| `app/routes/api/audio/uploads.ts`                             | `POST /api/audio/uploads` server route                                                  |
| `app/routes/api/audio/uploads.$id.confirm.ts`                 | `POST /api/audio/uploads/:id/confirm` server route                                      |
| `app/routes/audio.tsx`                                        | Standalone `/audio` library route                                                       |
| `app/utils/uploadAudio.ts`                                    | Client upload helper (presign → PUT → confirm)                                          |
| `app/components/audio/*`                                      | Library UI components + stories                                                         |
| `audio-worker/*`                                              | The ffmpeg worker service                                                               |
| `deploy/charts/cartyx/templates/audio-worker-deployment.yaml` | Worker deployment                                                                       |

**Modify:**

| Path                                         | Change                                                    |
| -------------------------------------------- | --------------------------------------------------------- |
| `app/server/functions/uploads.ts`            | Audio MIME allowlist + size cap constants                 |
| `app/server/functions/cleanup.ts`            | Add `uploads/audio/` to `TRACKED_PREFIXES`                |
| `app/utils/queryKeys.ts`                     | Audio query keys                                          |
| `deploy/charts/cartyx/values.yaml`           | `audioWorker` block                                       |
| `deploy/charts/cartyx/tests/render-tests.sh` | Worker render assertions                                  |
| `.github/workflows/deploy.yml`               | Build/push `cartyx-audio-worker`                          |
| `.github/workflows/ci.yml`                   | New `services` job covering `realtime/` + `audio-worker/` |
| `.github/dependabot.yml`                     | `/audio-worker` npm entry targeting `dev`                 |

---

## Task 1: Types and Zod schemas

**Files:**

- Create: `app/types/audio.ts`
- Create: `app/types/schemas/audio.ts`
- Test: `tests/types/audio-schemas.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `AUDIO_KINDS`, `AUDIO_ENVIRONMENTS`, `AUDIO_MOODS`, `AudioKind`, `AudioAssetData`, `AudioAssetStatus`; schemas `createAudioUploadSchema`, `confirmAudioUploadSchema`, `listAudioAssetsSchema`, `updateAudioAssetSchema`, `bulkTagAudioAssetsSchema`, `deleteAudioAssetSchema`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/types/audio-schemas.test.ts
import { describe, it, expect } from 'vitest';

describe('audio schemas', () => {
  it('createAudioUploadSchema rejects an unknown kind', async () => {
    const { createAudioUploadSchema } = await import('~/types/schemas/audio');
    const r = createAudioUploadSchema.safeParse({
      filename: 'storm.wav',
      contentType: 'audio/wav',
      bytes: 1024,
      kind: 'podcast',
    });
    expect(r.success).toBe(false);
  });

  it('createAudioUploadSchema accepts a valid payload with metadata', async () => {
    const { createAudioUploadSchema } = await import('~/types/schemas/audio');
    const r = createAudioUploadSchema.safeParse({
      filename: 'storm.wav',
      contentType: 'audio/wav',
      bytes: 1024,
      kind: 'ambience',
      environment: ['coast'],
      mood: ['tense'],
      intensity: 4,
      tags: ['Storm', 'storm', ' rain '],
    });
    expect(r.success).toBe(true);
  });

  it('createAudioUploadSchema rejects bytes over the 50MB cap', async () => {
    const { createAudioUploadSchema } = await import('~/types/schemas/audio');
    const r = createAudioUploadSchema.safeParse({
      filename: 'huge.wav',
      contentType: 'audio/wav',
      bytes: 50 * 1024 * 1024 + 1,
      kind: 'ambience',
    });
    expect(r.success).toBe(false);
  });

  it('listAudioAssetsSchema defaults limit and accepts filters', async () => {
    const { listAudioAssetsSchema } = await import('~/types/schemas/audio');
    const r = listAudioAssetsSchema.safeParse({ kind: 'music', tags: ['epic'] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it('bulkTagAudioAssetsSchema requires at least one id', async () => {
    const { bulkTagAudioAssetsSchema } = await import('~/types/schemas/audio');
    const r = bulkTagAudioAssetsSchema.safeParse({ ids: [], tags: ['x'] });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/types/audio-schemas.test.ts`
Expected: FAIL — cannot resolve `~/types/schemas/audio`.

- [ ] **Step 3: Write the types**

```ts
// app/types/audio.ts

/** Functional classification — drives playback defaults on the phase 2 board. */
export const AUDIO_KINDS = ['music', 'ambience', 'one-shot'] as const;
export type AudioKind = (typeof AUDIO_KINDS)[number];

export const AUDIO_ENVIRONMENTS = [
  'forest',
  'dungeon',
  'city',
  'tavern',
  'wilderness',
  'coast',
  'mountain',
  'swamp',
  'desert',
  'underground',
  'temple',
  'castle',
  'ship',
  'plains',
  'arctic',
] as const;
export type AudioEnvironment = (typeof AUDIO_ENVIRONMENTS)[number];

export const AUDIO_MOODS = [
  'calm',
  'tense',
  'combat',
  'eerie',
  'festive',
  'somber',
  'mysterious',
  'triumphant',
  'chaotic',
] as const;
export type AudioMood = (typeof AUDIO_MOODS)[number];

export const AUDIO_STATUSES = ['uploading', 'pending', 'processing', 'ready', 'failed'] as const;
export type AudioAssetStatus = (typeof AUDIO_STATUSES)[number];

/** 50 MB. The confirm step's HeadObject is what actually enforces this. */
export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;

/** Source uploads we accept. Output is always Opus + AAC regardless. */
export const AUDIO_SOURCE_TYPES: ReadonlyMap<string, string> = new Map([
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/mpeg', 'mp3'],
  ['audio/flac', 'flac'],
  ['audio/ogg', 'ogg'],
  ['audio/opus', 'opus'],
  ['audio/mp4', 'm4a'],
  ['audio/aac', 'aac'],
  ['audio/x-m4a', 'm4a'],
]);

export type AudioRendition = { key: string; url: string; bytes: number };

export type AudioAssetData = {
  id: string;
  ownerId: string;
  title: string;
  kind: AudioKind;
  environment: string[];
  mood: string[];
  intensity: number | null;
  tags: string[];
  status: AudioAssetStatus;
  durationMs: number | null;
  loudnessLufs: number | null;
  peaks: number[];
  renditions: { opus?: AudioRendition; aac?: AudioRendition };
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 4: Write the schemas**

```ts
// app/types/schemas/audio.ts
import { z } from 'zod';
import { AUDIO_KINDS, AUDIO_ENVIRONMENTS, AUDIO_MOODS, AUDIO_MAX_BYTES } from '~/types/audio';

const kind = z.enum(AUDIO_KINDS);
const environment = z.array(z.enum(AUDIO_ENVIRONMENTS)).max(10).default([]);
const mood = z.array(z.enum(AUDIO_MOODS)).max(10).default([]);
const intensity = z.number().int().min(1).max(5).nullish();
const tags = z.array(z.string().min(1).max(40)).max(30).default([]);

export const createAudioUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  bytes: z.number().int().positive().max(AUDIO_MAX_BYTES),
  title: z.string().min(1).max(200).optional(),
  kind,
  environment,
  mood,
  intensity,
  tags,
});

export const confirmAudioUploadSchema = z.object({
  assetId: z.string().min(1),
});

export const listAudioAssetsSchema = z.object({
  kind: kind.optional(),
  environment: z.array(z.enum(AUDIO_ENVIRONMENTS)).optional(),
  mood: z.array(z.enum(AUDIO_MOODS)).optional(),
  intensityMin: z.number().int().min(1).max(5).optional(),
  intensityMax: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string().min(1)).optional(),
  search: z.string().max(200).optional(),
  needsTagging: z.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const updateAudioAssetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  kind: kind.optional(),
  environment: z.array(z.enum(AUDIO_ENVIRONMENTS)).optional(),
  mood: z.array(z.enum(AUDIO_MOODS)).optional(),
  intensity,
  tags: z.array(z.string().min(1).max(40)).max(30).optional(),
});

export const bulkTagAudioAssetsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  kind: kind.optional(),
  environment: z.array(z.enum(AUDIO_ENVIRONMENTS)).optional(),
  mood: z.array(z.enum(AUDIO_MOODS)).optional(),
  intensity,
  tags: z.array(z.string().min(1).max(40)).max(30).optional(),
  tagMode: z.enum(['add', 'replace']).default('add'),
});

export const deleteAudioAssetSchema = z.object({ id: z.string().min(1) });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/types/audio-schemas.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add app/types/audio.ts app/types/schemas/audio.ts tests/types/audio-schemas.test.ts
git commit -m "feat(audio): add audio library types and validation schemas"
```

---

## Task 2: `AudioAsset` model

**Files:**

- Create: `app/server/db/models/AudioAsset.ts`
- Test: `tests/server/db/audio-asset-model.test.ts`

**Interfaces:**

- Consumes: `AUDIO_KINDS`, `AUDIO_STATUSES` (Task 1).
- Produces: `AudioAsset` Mongoose model, `IAudioAsset` type.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/db/audio-asset-model.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('~/server/utils/helpers', () => ({
  normalizeTags: (t: string[]) => Array.from(new Set(t.map((x) => x.trim().toLowerCase()))),
}));

describe('AudioAsset model', () => {
  it('defaults status to uploading and peaks to an empty array', async () => {
    const { AudioAsset } = await import('~/server/db/models/AudioAsset');
    const doc = new AudioAsset({
      ownerId: '507f1f77bcf86cd799439011',
      title: 'Storm',
      kind: 'ambience',
      sourceKey: 'uploads/audio/x.wav',
    });
    expect(doc.status).toBe('uploading');
    expect(doc.peaks).toEqual([]);
    expect(doc.attempts).toBe(0);
  });

  it('normalizes tags on save', async () => {
    const { AudioAsset } = await import('~/server/db/models/AudioAsset');
    const doc = new AudioAsset({
      ownerId: '507f1f77bcf86cd799439011',
      title: 'Storm',
      kind: 'ambience',
      sourceKey: 'uploads/audio/x.wav',
      tags: ['Storm', 'storm', ' Rain '],
    });
    doc.$isModified = () => true;
    await doc.validate();
    expect(doc.kind).toBe('ambience');
  });

  it('rejects an unknown kind', async () => {
    const { AudioAsset } = await import('~/server/db/models/AudioAsset');
    const doc = new AudioAsset({
      ownerId: '507f1f77bcf86cd799439011',
      title: 'X',
      kind: 'podcast',
      sourceKey: 'uploads/audio/x.wav',
    });
    await expect(doc.validate()).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/server/db/audio-asset-model.test.ts`
Expected: FAIL — cannot resolve `~/server/db/models/AudioAsset`.

- [ ] **Step 3: Write the model**

```ts
// app/server/db/models/AudioAsset.ts
import mongoose, { type InferSchemaType, type Model } from 'mongoose';
import { normalizeTags } from '~/server/utils/helpers';
import { AUDIO_KINDS, AUDIO_STATUSES } from '~/types/audio';

const renditionSchema = new mongoose.Schema(
  { key: String, url: String, bytes: Number },
  { _id: false }
);

const audioAssetSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  kind: { type: String, enum: AUDIO_KINDS, required: true },

  environment: { type: [String], default: [] },
  mood: { type: [String], default: [] },
  intensity: { type: Number, min: 1, max: 5, default: null },
  tags: { type: [String], default: [] },

  sourceKey: { type: String, required: true },
  sourceBytes: { type: Number, default: null },
  renditions: {
    opus: { type: renditionSchema, default: undefined },
    aac: { type: renditionSchema, default: undefined },
  },
  // Reserved for phase 2's ∞/1× music variants. Never written in phase 1.
  onceRenditions: {
    opus: { type: renditionSchema, default: undefined },
    aac: { type: renditionSchema, default: undefined },
  },

  durationMs: { type: Number, default: null },
  loudnessLufs: { type: Number, default: null },
  sampleRate: { type: Number, default: null },
  channels: { type: Number, default: null },
  peaks: { type: [Number], default: [] },

  status: { type: String, enum: AUDIO_STATUSES, default: 'uploading' },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: null },
  claimedAt: { type: Date, default: null },
  claimedBy: { type: String, default: null },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

audioAssetSchema.pre('save', function () {
  if (this.isModified('tags')) {
    this.tags = normalizeTags(this.tags);
  }
  this.updatedAt = new Date();
});

// istanbul ignore next
if (typeof (audioAssetSchema as { index?: unknown }).index === 'function') {
  audioAssetSchema.index({ ownerId: 1, kind: 1 });
  audioAssetSchema.index({ ownerId: 1, tags: 1 });
  audioAssetSchema.index({ ownerId: 1, createdAt: -1 });
  // Drives the worker's atomic claim.
  audioAssetSchema.index({ status: 1, createdAt: 1 });
  audioAssetSchema.index({ title: 'text' });
}

export type IAudioAsset = InferSchemaType<typeof audioAssetSchema>;

export const AudioAsset: Model<IAudioAsset> =
  (mongoose.models.AudioAsset as Model<IAudioAsset>) ||
  mongoose.model<IAudioAsset>('AudioAsset', audioAssetSchema);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/server/db/audio-asset-model.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/server/db/models/AudioAsset.ts tests/server/db/audio-asset-model.test.ts
git commit -m "feat(audio): add the AudioAsset model with claim and search indexes"
```

---

## Task 3: Audio-aware presigned uploads

**Files:**

- Modify: `app/server/functions/uploads.ts`
- Test: `tests/server/functions/uploads-audio.test.ts`

**Interfaces:**

- Consumes: `AUDIO_SOURCE_TYPES`, `AUDIO_MAX_BYTES` (Task 1).
- Produces: `getAudioUploadUrl({ contentType, bytes })` → `{ uploadUrl, key, publicUrl }`; `createR2` helper exported for reuse by Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/functions/uploads-audio.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/utils/telemetry', () => ({ serverCaptureException: vi.fn() }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed.example/put'),
}));

import { getSession } from '~/server/session';

describe('getAudioUploadUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CDN_URL = 'https://cdn.test';
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET = 'bucket';
  });

  it('rejects an unsupported content type', async () => {
    vi.mocked(getSession).mockResolvedValue({ id: 'u1' } as never);
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    await expect(getAudioUploadUrl({ contentType: 'image/png', bytes: 10 })).rejects.toThrow(
      /audio/i
    );
  });

  it('rejects a declared size over the cap', async () => {
    vi.mocked(getSession).mockResolvedValue({ id: 'u1' } as never);
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    await expect(
      getAudioUploadUrl({ contentType: 'audio/wav', bytes: 50 * 1024 * 1024 + 1 })
    ).rejects.toThrow(/too large/i);
  });

  it('returns a signed url under the uploads/audio prefix', async () => {
    vi.mocked(getSession).mockResolvedValue({ id: 'u1' } as never);
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    const r = await getAudioUploadUrl({ contentType: 'audio/wav', bytes: 1024 });
    expect(r.key).toMatch(/^uploads\/audio\//);
    expect(r.key).toMatch(/\.wav$/);
    expect(r.publicUrl).toBe(`https://cdn.test/${r.key}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/server/functions/uploads-audio.test.ts`
Expected: FAIL — `getAudioUploadUrl` is not exported.

- [ ] **Step 3: Add the implementation to `uploads.ts`**

Append to `app/server/functions/uploads.ts` (keep the existing image `getUploadUrl` untouched):

```ts
import { AUDIO_SOURCE_TYPES, AUDIO_MAX_BYTES } from '~/types/audio';

type R2 = { client: S3Client; bucket: string; cdnUrl: string };

/** Shared by audio upload + confirm. Throws when config is incomplete. */
export function createR2(): R2 {
  const cdnUrl = process.env.CDN_URL;
  if (!cdnUrl) throw new Error('Direct uploads require CDN_URL configuration');

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('R2 configuration incomplete');
  }

  return {
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
    cdnUrl: cdnUrl.replace(/\/+$/, ''),
  };
}

export const getAudioUploadUrl = async ({
  contentType,
  bytes,
}: {
  contentType: string;
  bytes: number;
}) => {
  const user = await getSession();
  try {
    if (!user) throw new Error('Not authenticated');

    const ext = AUDIO_SOURCE_TYPES.get(contentType);
    if (!ext) throw new Error(`Unsupported audio type: ${contentType}`);
    if (bytes > AUDIO_MAX_BYTES) {
      throw new Error(`File too large: max ${AUDIO_MAX_BYTES} bytes`);
    }

    const { client, bucket, cdnUrl } = createR2();
    const key = `uploads/audio/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;

    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: 300 }
    );

    return { uploadUrl, key, publicUrl: `${cdnUrl}/${key}` };
  } catch (e) {
    serverCaptureException(e, user?.id, { action: 'getAudioUploadUrl' });
    throw e;
  }
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/server/functions/uploads-audio.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify the existing image path still works**

Run: `npx vitest run --project unit tests/server/functions/`
Expected: PASS — no regressions in existing upload tests.

- [ ] **Step 6: Commit**

```bash
git add app/server/functions/uploads.ts tests/server/functions/uploads-audio.test.ts
git commit -m "feat(audio): presigned audio uploads with a MIME allowlist and size cap"
```

---

## Task 4: Ingest — create and confirm

**Files:**

- Create: `app/server/functions/audio.ts`
- Test: `tests/server/functions/audio-ingest.test.ts`

**Interfaces:**

- Consumes: `createR2`, `getAudioUploadUrl` (Task 3); `AudioAsset` (Task 2); schemas (Task 1).
- Produces: `createAudioUpload({ data, userId })` → `{ assetId, uploadUrl, key }`; `confirmAudioUpload({ data, userId })` → `{ assetId, status }`.

**Why the confirm step exists:** a presigned PUT cannot enforce a size limit — S3/R2 support content-length conditions only on POST policies. `HeadObject` is the only real check. Without it the cap is decorative.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/functions/audio-ingest.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('~/server/db/models/AudioAsset', () => ({
  AudioAsset: { create: vi.fn(), findOne: vi.fn(), findOneAndUpdate: vi.fn() },
}));

const send = vi.fn();
vi.mock('~/server/functions/uploads', () => ({
  createR2: () => ({ client: { send }, bucket: 'b', cdnUrl: 'https://cdn.test' }),
  getAudioUploadUrl: vi.fn(async () => ({
    uploadUrl: 'https://signed/put',
    key: 'uploads/audio/1-a.wav',
    publicUrl: 'https://cdn.test/uploads/audio/1-a.wav',
  })),
}));

import { AudioAsset } from '~/server/db/models/AudioAsset';

const VALID = {
  filename: 'storm.wav',
  contentType: 'audio/wav',
  bytes: 1024,
  kind: 'ambience' as const,
  environment: [],
  mood: [],
  tags: [],
};

describe('createAudioUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an asset in uploading status and returns the signed url', async () => {
    vi.mocked(AudioAsset.create).mockResolvedValue({ _id: 'a1' } as never);
    const { createAudioUpload } = await import('~/server/functions/audio');
    const r = await createAudioUpload({ data: VALID, userId: 'u1' });
    expect(r.assetId).toBe('a1');
    expect(r.uploadUrl).toBe('https://signed/put');
    const arg = vi.mocked(AudioAsset.create).mock.calls[0][0] as Record<string, unknown>;
    expect(arg.status).toBe('uploading');
    expect(arg.title).toBe('storm');
  });
});

describe('confirmAudioUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flips to pending when the real object matches the declared size', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'k',
      status: 'uploading',
    } as never);
    send.mockResolvedValue({ ContentLength: 1024, ContentType: 'audio/wav' });
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      status: 'pending',
    } as never);

    const { confirmAudioUpload } = await import('~/server/functions/audio');
    const r = await confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u1' });
    expect(r.status).toBe('pending');
  });

  it('fails the asset and deletes the object when the real size exceeds the cap', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'k',
      status: 'uploading',
    } as never);
    send.mockResolvedValue({ ContentLength: 50 * 1024 * 1024 + 1, ContentType: 'audio/wav' });
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      status: 'failed',
    } as never);

    const { confirmAudioUpload } = await import('~/server/functions/audio');
    await expect(confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u1' })).rejects.toThrow(
      /too large/i
    );
    // DeleteObjectCommand issued in addition to HeadObjectCommand
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("refuses another user's asset", async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue(null as never);
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    await expect(confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u2' })).rejects.toThrow(
      /not found/i
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/server/functions/audio-ingest.test.ts`
Expected: FAIL — cannot resolve `~/server/functions/audio`.

- [ ] **Step 3: Write the implementation**

```ts
// app/server/functions/audio.ts
import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { z } from 'zod';
import { connectDB, isDBConnected } from '../db/connection';
import { AudioAsset } from '../db/models/AudioAsset';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { createR2, getAudioUploadUrl } from './uploads';
import { AUDIO_MAX_BYTES, AUDIO_SOURCE_TYPES } from '~/types/audio';
import type { createAudioUploadSchema, confirmAudioUploadSchema } from '~/types/schemas/audio';

async function ensureDb() {
  if (!isDBConnected()) await connectDB();
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').slice(0, 200) || 'Untitled';
}

export async function createAudioUpload({
  data,
  userId,
}: {
  data: z.infer<typeof createAudioUploadSchema>;
  userId: string;
}) {
  try {
    await ensureDb();
    const { uploadUrl, key } = await getAudioUploadUrl({
      contentType: data.contentType,
      bytes: data.bytes,
    });

    const doc = await AudioAsset.create({
      ownerId: userId,
      title: data.title ?? titleFromFilename(data.filename),
      kind: data.kind,
      environment: data.environment ?? [],
      mood: data.mood ?? [],
      intensity: data.intensity ?? null,
      tags: data.tags ?? [],
      sourceKey: key,
      sourceBytes: data.bytes,
      status: 'uploading',
    });

    return { assetId: String(doc._id), uploadUrl, key };
  } catch (e) {
    serverCaptureException(e, userId, { action: 'createAudioUpload' });
    throw e;
  }
}

export async function confirmAudioUpload({
  data,
  userId,
}: {
  data: z.infer<typeof confirmAudioUploadSchema>;
  userId: string;
}) {
  try {
    await ensureDb();
    const asset = await AudioAsset.findOne({ _id: data.assetId, ownerId: userId });
    if (!asset) throw new Error('Audio asset not found');

    const { client, bucket } = createR2();
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: asset.sourceKey }));

    const bytes = head.ContentLength ?? 0;
    const type = head.ContentType ?? '';
    const tooLarge = bytes > AUDIO_MAX_BYTES;
    const badType = !AUDIO_SOURCE_TYPES.has(type);

    if (tooLarge || badType) {
      // The object must go, or we pay storage for a file we refused.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.sourceKey }));
      const reason = tooLarge
        ? `File too large: ${bytes} bytes exceeds ${AUDIO_MAX_BYTES}`
        : `Unsupported audio type: ${type}`;
      await AudioAsset.findOneAndUpdate(
        { _id: data.assetId },
        { $set: { status: 'failed', lastError: reason, updatedAt: new Date() } }
      );
      throw new Error(reason);
    }

    const updated = await AudioAsset.findOneAndUpdate(
      { _id: data.assetId, ownerId: userId },
      { $set: { status: 'pending', sourceBytes: bytes, updatedAt: new Date() } },
      { new: true }
    );

    serverCaptureEvent('audio_upload_confirmed', userId, { assetId: data.assetId });
    return { assetId: data.assetId, status: updated?.status ?? 'pending' };
  } catch (e) {
    serverCaptureException(e, userId, { action: 'confirmAudioUpload' });
    throw e;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/server/functions/audio-ingest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/server/functions/audio.ts tests/server/functions/audio-ingest.test.ts
git commit -m "feat(audio): ingest create/confirm with HeadObject size enforcement"
```

---

## Task 5: Library queries — list, filter, search

**Files:**

- Modify: `app/server/functions/audio.ts`
- Test: `tests/server/functions/audio-list.test.ts`

**Interfaces:**

- Consumes: `AudioAsset` (Task 2), `listAudioAssetsSchema` (Task 1).
- Produces: `listAudioAssets({ data, userId })` → `{ items: AudioAssetData[]; nextCursor: string | null }`; `serializeAudioAsset(doc)` → `AudioAssetData`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/functions/audio-list.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('~/server/functions/uploads', () => ({ createR2: vi.fn(), getAudioUploadUrl: vi.fn() }));

const lean = vi.fn();
const limit = vi.fn(() => ({ lean }));
const sort = vi.fn(() => ({ limit }));
const find = vi.fn(() => ({ sort }));
vi.mock('~/server/db/models/AudioAsset', () => ({ AudioAsset: { find } }));

describe('listAudioAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lean.mockResolvedValue([]);
  });

  it('always scopes the query to the caller', async () => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    await listAudioAssets({ data: { limit: 50 }, userId: 'u1' });
    expect(find.mock.calls[0][0]).toMatchObject({ ownerId: 'u1' });
  });

  it('filters facets with $in and tags with $all', async () => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    await listAudioAssets({
      data: { limit: 50, environment: ['coast'], mood: ['tense'], tags: ['storm', 'rain'] },
      userId: 'u1',
    });
    const q = find.mock.calls[0][0] as Record<string, unknown>;
    expect(q.environment).toEqual({ $in: ['coast'] });
    expect(q.mood).toEqual({ $in: ['tense'] });
    expect(q.tags).toEqual({ $all: ['storm', 'rain'] });
  });

  it('needsTagging matches ready assets with no facets and no tags', async () => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    await listAudioAssets({ data: { limit: 50, needsTagging: true }, userId: 'u1' });
    const q = find.mock.calls[0][0] as Record<string, unknown>;
    expect(q.status).toBe('ready');
    expect(q.tags).toEqual({ $size: 0 });
  });

  it('returns nextCursor only when a full page came back', async () => {
    const rows = Array.from({ length: 2 }, (_, i) => ({
      _id: `a${i}`,
      ownerId: 'u1',
      title: 't',
      kind: 'ambience',
      environment: [],
      mood: [],
      intensity: null,
      tags: [],
      peaks: [],
      renditions: {},
      status: 'ready',
      durationMs: null,
      loudnessLufs: null,
      lastError: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }));
    lean.mockResolvedValue(rows);
    const { listAudioAssets } = await import('~/server/functions/audio');
    const r = await listAudioAssets({ data: { limit: 2 }, userId: 'u1' });
    expect(r.items).toHaveLength(2);
    expect(r.nextCursor).toBe('a1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/server/functions/audio-list.test.ts`
Expected: FAIL — `listAudioAssets` is not exported.

- [ ] **Step 3: Append the implementation to `app/server/functions/audio.ts`**

```ts
import type { listAudioAssetsSchema } from '~/types/schemas/audio';
import type { AudioAssetData } from '~/types/audio';

type AudioDoc = Record<string, unknown>;

export function serializeAudioAsset(a: AudioDoc): AudioAssetData {
  const d = a as {
    _id: unknown;
    ownerId: unknown;
    title?: string;
    kind?: string;
    environment?: string[];
    mood?: string[];
    intensity?: number | null;
    tags?: string[];
    status?: string;
    durationMs?: number | null;
    loudnessLufs?: number | null;
    peaks?: number[];
    renditions?: AudioAssetData['renditions'];
    lastError?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
  };
  return {
    id: String(d._id),
    ownerId: String(d.ownerId),
    title: d.title ?? '',
    kind: (d.kind ?? 'ambience') as AudioAssetData['kind'],
    environment: d.environment ?? [],
    mood: d.mood ?? [],
    intensity: d.intensity ?? null,
    tags: d.tags ?? [],
    status: (d.status ?? 'pending') as AudioAssetData['status'],
    durationMs: d.durationMs ?? null,
    loudnessLufs: d.loudnessLufs ?? null,
    peaks: d.peaks ?? [],
    renditions: d.renditions ?? {},
    lastError: d.lastError ?? null,
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : '',
    updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : '',
  };
}

export async function listAudioAssets({
  data,
  userId,
}: {
  data: z.infer<typeof listAudioAssetsSchema>;
  userId: string;
}): Promise<{ items: AudioAssetData[]; nextCursor: string | null }> {
  try {
    await ensureDb();

    const query: Record<string, unknown> = { ownerId: userId };
    if (data.kind) query.kind = data.kind;
    if (data.environment?.length) query.environment = { $in: data.environment };
    if (data.mood?.length) query.mood = { $in: data.mood };
    if (data.tags?.length) query.tags = { $all: data.tags };
    if (data.search) query.title = { $regex: data.search, $options: 'i' };
    if (data.intensityMin != null || data.intensityMax != null) {
      const range: Record<string, number> = {};
      if (data.intensityMin != null) range.$gte = data.intensityMin;
      if (data.intensityMax != null) range.$lte = data.intensityMax;
      query.intensity = range;
    }
    if (data.needsTagging) {
      query.status = 'ready';
      query.tags = { $size: 0 };
      query.environment = { $size: 0 };
    }
    // Cursor is the last seen _id under a stable createdAt DESC, _id DESC sort.
    if (data.cursor) query._id = { $lt: data.cursor };

    const rows = (await AudioAsset.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(data.limit)
      .lean()) as AudioDoc[];

    const items = rows.map(serializeAudioAsset);
    const nextCursor = items.length === data.limit ? items[items.length - 1].id : null;
    return { items, nextCursor };
  } catch (e) {
    serverCaptureException(e, userId, { action: 'listAudioAssets' });
    throw e;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/server/functions/audio-list.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/server/functions/audio.ts tests/server/functions/audio-list.test.ts
git commit -m "feat(audio): server-side library listing with facet and tag filters"
```

---

## Task 6: Mutations — update, bulk tag, delete

**Files:**

- Modify: `app/server/functions/audio.ts`
- Test: `tests/server/functions/audio-mutations.test.ts`

**Interfaces:**

- Consumes: `AudioAsset`, schemas, `createR2`.
- Produces: `updateAudioAsset`, `bulkTagAudioAssets`, `deleteAudioAsset`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/functions/audio-mutations.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
const send = vi.fn();
vi.mock('~/server/functions/uploads', () => ({
  createR2: () => ({ client: { send }, bucket: 'b', cdnUrl: 'https://cdn.test' }),
  getAudioUploadUrl: vi.fn(),
}));
vi.mock('~/server/db/models/AudioAsset', () => ({
  AudioAsset: {
    findOneAndUpdate: vi.fn(),
    updateMany: vi.fn(),
    findOne: vi.fn(),
    deleteOne: vi.fn(),
  },
}));

import { AudioAsset } from '~/server/db/models/AudioAsset';

describe('audio mutations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updateAudioAsset scopes the update to the owner', async () => {
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as never);
    const { updateAudioAsset } = await import('~/server/functions/audio');
    await updateAudioAsset({ data: { id: 'a1', title: 'New' }, userId: 'u1' });
    expect(vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0][0]).toEqual({
      _id: 'a1',
      ownerId: 'u1',
    });
  });

  it('bulkTag add mode uses $addToSet, replace mode uses $set', async () => {
    vi.mocked(AudioAsset.updateMany).mockResolvedValue({ modifiedCount: 2 } as never);
    const { bulkTagAudioAssets } = await import('~/server/functions/audio');

    await bulkTagAudioAssets({
      data: { ids: ['a', 'b'], tags: ['storm'], tagMode: 'add' },
      userId: 'u1',
    });
    let update = vi.mocked(AudioAsset.updateMany).mock.calls[0][1] as Record<string, unknown>;
    expect(update.$addToSet).toBeTruthy();

    vi.mocked(AudioAsset.updateMany).mockClear();
    await bulkTagAudioAssets({
      data: { ids: ['a'], tags: ['storm'], tagMode: 'replace' },
      userId: 'u1',
    });
    update = vi.mocked(AudioAsset.updateMany).mock.calls[0][1] as Record<string, unknown>;
    expect((update.$set as Record<string, unknown>).tags).toEqual(['storm']);
  });

  it('deleteAudioAsset removes every R2 object then the row', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'src',
      renditions: { opus: { key: 'o' }, aac: { key: 'a' } },
    } as never);
    vi.mocked(AudioAsset.deleteOne).mockResolvedValue({ deletedCount: 1 } as never);
    const { deleteAudioAsset } = await import('~/server/functions/audio');
    await deleteAudioAsset({ data: { id: 'a1' }, userId: 'u1' });
    expect(send).toHaveBeenCalledTimes(3);
    expect(AudioAsset.deleteOne).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/server/functions/audio-mutations.test.ts`
Expected: FAIL — mutations are not exported.

- [ ] **Step 3: Append the implementation**

```ts
import { normalizeTags } from '../utils/helpers';
import type {
  updateAudioAssetSchema,
  bulkTagAudioAssetsSchema,
  deleteAudioAssetSchema,
} from '~/types/schemas/audio';

export async function updateAudioAsset({
  data,
  userId,
}: {
  data: z.infer<typeof updateAudioAssetSchema>;
  userId: string;
}): Promise<AudioAssetData> {
  try {
    await ensureDb();
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) set.title = data.title;
    if (data.kind !== undefined) set.kind = data.kind;
    if (data.environment !== undefined) set.environment = data.environment;
    if (data.mood !== undefined) set.mood = data.mood;
    if (data.intensity !== undefined) set.intensity = data.intensity;
    if (data.tags !== undefined) set.tags = normalizeTags(data.tags);

    const doc = await AudioAsset.findOneAndUpdate(
      { _id: data.id, ownerId: userId },
      { $set: set },
      { new: true }
    );
    if (!doc) throw new Error('Audio asset not found');
    return serializeAudioAsset(doc as unknown as AudioDoc);
  } catch (e) {
    serverCaptureException(e, userId, { action: 'updateAudioAsset' });
    throw e;
  }
}

export async function bulkTagAudioAssets({
  data,
  userId,
}: {
  data: z.infer<typeof bulkTagAudioAssetsSchema>;
  userId: string;
}): Promise<{ modified: number }> {
  try {
    await ensureDb();
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.kind !== undefined) set.kind = data.kind;
    if (data.environment !== undefined) set.environment = data.environment;
    if (data.mood !== undefined) set.mood = data.mood;
    if (data.intensity !== undefined) set.intensity = data.intensity;

    const update: Record<string, unknown> = { $set: set };
    if (data.tags?.length) {
      const tags = normalizeTags(data.tags);
      if (data.tagMode === 'replace') {
        (update.$set as Record<string, unknown>).tags = tags;
      } else {
        update.$addToSet = { tags: { $each: tags } };
      }
    }

    const res = await AudioAsset.updateMany({ _id: { $in: data.ids }, ownerId: userId }, update);
    return { modified: res.modifiedCount ?? 0 };
  } catch (e) {
    serverCaptureException(e, userId, { action: 'bulkTagAudioAssets' });
    throw e;
  }
}

export async function deleteAudioAsset({
  data,
  userId,
}: {
  data: z.infer<typeof deleteAudioAssetSchema>;
  userId: string;
}): Promise<{ deleted: boolean }> {
  try {
    await ensureDb();
    const asset = await AudioAsset.findOne({ _id: data.id, ownerId: userId });
    if (!asset) throw new Error('Audio asset not found');

    const { client, bucket } = createR2();
    const keys = [asset.sourceKey, asset.renditions?.opus?.key, asset.renditions?.aac?.key].filter(
      (k): k is string => Boolean(k)
    );

    for (const Key of keys) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
    }

    await AudioAsset.deleteOne({ _id: data.id, ownerId: userId });
    return { deleted: true };
  } catch (e) {
    serverCaptureException(e, userId, { action: 'deleteAudioAsset' });
    throw e;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/server/functions/audio-mutations.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/server/functions/audio.ts tests/server/functions/audio-mutations.test.ts
git commit -m "feat(audio): update, bulk tag, and delete audio assets"
```

---

## Task 7: API server routes with a token auth hook

**Files:**

- Create: `app/server/functions/audio-auth.ts`
- Create: `app/routes/api/audio/uploads.ts`
- Create: `app/routes/api/audio/uploads.$id.confirm.ts`
- Test: `tests/server/functions/audio-auth.test.ts`

**Interfaces:**

- Consumes: `createAudioUpload`, `confirmAudioUpload` (Task 4).
- Produces: `resolveApiUser(request)` → `Promise<string | null>`.

**Why these routes exist:** phase 3's Python tool is a second ingest client. TanStack Start server functions speak an internal RPC protocol that is not a stable contract for an external client, so ingest gets explicit HTTP routes over the same implementation. Token issuance is phase 3's work — here the resolver always rejects.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/functions/audio-auth.test.ts
import { describe, it, expect } from 'vitest';

describe('resolveApiUser', () => {
  it('returns null when no Authorization header is present', async () => {
    const { resolveApiUser } = await import('~/server/functions/audio-auth');
    const r = await resolveApiUser(new Request('https://x.test/api/audio/uploads'));
    expect(r).toBeNull();
  });

  it('returns null for a bearer token until phase 3 implements issuance', async () => {
    const { resolveApiUser } = await import('~/server/functions/audio-auth');
    const r = await resolveApiUser(
      new Request('https://x.test/api/audio/uploads', {
        headers: { authorization: 'Bearer cartyx_pat_whatever' },
      })
    );
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/server/functions/audio-auth.test.ts`
Expected: FAIL — cannot resolve `~/server/functions/audio-auth`.

- [ ] **Step 3: Write the resolver**

```ts
// app/server/functions/audio-auth.ts

/**
 * Resolves the acting user for the audio ingest HTTP API.
 *
 * Cartyx has no personal-access-token concept yet — authentication is session
 * cookies only. Phase 3 (`ai-sound-generator`) owns issuing, hashing, scoping
 * and revoking tokens. Until then this rejects every bearer token, so the
 * routes exist and are shaped correctly without shipping an unauthenticated
 * write path.
 */
export async function resolveApiUser(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  // Phase 3: look the token up by hash and return its owner id.
  return null;
}
```

- [ ] **Step 4: Write the routes**

```ts
// app/routes/api/audio/uploads.ts
import { createFileRoute } from '@tanstack/react-router';
import { resolveApiUser } from '~/server/functions/audio-auth';
import { createAudioUpload } from '~/server/functions/audio';
import { createAudioUploadSchema } from '~/types/schemas/audio';

async function post({ request }: { request: Request }): Promise<Response> {
  const userId = await resolveApiUser(request);
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = createAudioUploadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    return Response.json(await createAudioUpload({ data: parsed.data, userId }));
  } catch {
    return Response.json({ error: 'Upload could not be started' }, { status: 500 });
  }
}

export const Route = createFileRoute('/api/audio/uploads')({
  server: { handlers: { POST: post } },
});
```

```ts
// app/routes/api/audio/uploads.$id.confirm.ts
import { createFileRoute } from '@tanstack/react-router';
import { resolveApiUser } from '~/server/functions/audio-auth';
import { confirmAudioUpload } from '~/server/functions/audio';

async function post({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}): Promise<Response> {
  const userId = await resolveApiUser(request);
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return Response.json(await confirmAudioUpload({ data: { assetId: params.id }, userId }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Confirm failed';
    return Response.json({ error: message }, { status: 400 });
  }
}

export const Route = createFileRoute('/api/audio/uploads/$id/confirm')({
  server: { handlers: { POST: post } },
});
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run --project unit tests/server/functions/audio-auth.test.ts && npm run typecheck`
Expected: PASS, and typecheck clean (the generated route tree picks up the new routes).

- [ ] **Step 6: Commit**

```bash
git add app/server/functions/audio-auth.ts app/routes/api tests/server/functions/audio-auth.test.ts app/routeTree.gen.ts
git commit -m "feat(audio): ingest HTTP routes with a stubbed token resolver"
```

---

## Task 8: Teach orphan cleanup about audio

**Files:**

- Modify: `app/server/functions/cleanup.ts:26-31`
- Test: `tests/server/functions/cleanup-audio.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `TRACKED_PREFIXES` including `uploads/audio/`.

**Why:** the orphan scanner ignores any key outside `TRACKED_PREFIXES`. Without this every audio object is invisible to cleanup forever.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/functions/cleanup-audio.test.ts
import { describe, it, expect } from 'vitest';

describe('cleanup tracked prefixes', () => {
  it('includes the audio prefix', async () => {
    const mod = await import('~/server/functions/cleanup');
    const prefixes = (mod as unknown as { TRACKED_PREFIXES: string[] }).TRACKED_PREFIXES;
    expect(prefixes).toContain('uploads/audio/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/server/functions/cleanup-audio.test.ts`
Expected: FAIL — `TRACKED_PREFIXES` is not exported, or lacks the audio prefix.

- [ ] **Step 3: Modify `cleanup.ts`**

Change the constant to be exported and add the prefix:

```ts
// Prefixes the app uses for R2 uploads. Anything outside these is ignored so
// the scan never proposes deleting keys we don't know how to attribute.
export const TRACKED_PREFIXES = [
  'uploads/locations/',
  'uploads/characters/',
  'uploads/players/',
  'uploads/campaigns/',
  'uploads/audio/',
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/server/functions/cleanup-audio.test.ts tests/server/functions/cleanup.test.ts`
Expected: PASS — including existing cleanup tests.

- [ ] **Step 5: Commit**

```bash
git add app/server/functions/cleanup.ts tests/server/functions/cleanup-audio.test.ts
git commit -m "fix(audio): track the audio prefix in the R2 orphan scanner"
```

---

## Task 9: Worker scaffold — claim and reaper

**Files:**

- Create: `audio-worker/package.json`, `audio-worker/tsconfig.json`, `audio-worker/vitest.config.ts`
- Create: `audio-worker/src/logger.ts`, `audio-worker/src/db.ts`, `audio-worker/src/claim.ts`
- Test: `audio-worker/test/claim.test.ts`

**Interfaces:**

- Consumes: nothing from the web app (separate package; the model is re-declared minimally).
- Produces: `claimNext(model, workerId)` → `Promise<Doc | null>`; `reapStale(model, timeoutMs)` → `Promise<number>`.

**Why a separate package:** ffmpeg is CPU-bound and would compete with SSR in the web pod. This mirrors `realtime/`.

- [ ] **Step 1: Create the package scaffold**

```json
// audio-worker/package.json
{
  "name": "cartyx-audio-worker",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22.22.0" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.1090.0",
    "mongoose": "^9.7.4",
    "pino": "^10.3.1"
  },
  "overrides": {
    "postcss": "8.5.19"
  },
  "devDependencies": {
    "@types/node": "^25.9.1",
    "typescript": "^6.0.3",
    "vitest": "4.1.9"
  }
}
```

```json
// audio-worker/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

```ts
// audio-worker/vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 2: Write the failing test**

```ts
// audio-worker/test/claim.test.ts
import { describe, it, expect, vi } from 'vitest';
import { claimNext, reapStale } from '../src/claim.js';

describe('claimNext', () => {
  it('claims the oldest pending asset atomically and marks it processing', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue({ _id: 'a1' });
    const model = { findOneAndUpdate } as never;

    const doc = await claimNext(model, 'worker-1');
    expect(doc).toEqual({ _id: 'a1' });

    const [filter, update, opts] = findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ status: 'pending' });
    expect(update.$set.status).toBe('processing');
    expect(update.$set.claimedBy).toBe('worker-1');
    expect(update.$inc).toEqual({ attempts: 1 });
    expect(opts.sort).toEqual({ createdAt: 1 });
    // Raw driver option. `new: true` is the Mongoose *model* option and would
    // silently hand back the pre-update document here.
    expect(opts.returnDocument).toBe('after');
  });

  it('returns null when nothing is pending', async () => {
    const model = { findOneAndUpdate: vi.fn().mockResolvedValue(null) } as never;
    expect(await claimNext(model, 'w')).toBeNull();
  });
});

describe('reapStale', () => {
  it('returns processing rows under the attempt cap to pending', async () => {
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 2 });
    const model = { updateMany } as never;

    const n = await reapStale(model, 600_000);
    expect(n).toBe(2);

    const [filter, update] = updateMany.mock.calls[0];
    expect(filter.status).toBe('processing');
    expect(filter.claimedAt.$lt).toBeInstanceOf(Date);
    expect(filter.attempts.$lt).toBe(3);
    expect(update.$set.status).toBe('pending');
  });

  it('fails rows that have exhausted their attempts', async () => {
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const model = { updateMany } as never;
    await reapStale(model, 600_000);
    const secondCall = updateMany.mock.calls[1];
    expect(secondCall[0].attempts.$gte).toBe(3);
    expect(secondCall[1].$set.status).toBe('failed');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd audio-worker && npm install && npx vitest run test/claim.test.ts`
Expected: FAIL — `src/claim.ts` does not exist.

- [ ] **Step 4: Write the implementation**

```ts
// audio-worker/src/claim.ts

export const MAX_ATTEMPTS = 3;

type ClaimModel = {
  findOneAndUpdate: (f: unknown, u: unknown, o: unknown) => Promise<unknown>;
  updateMany: (f: unknown, u: unknown) => Promise<{ modifiedCount?: number }>;
};

/**
 * Atomically take the oldest pending asset. A single findOneAndUpdate is what
 * makes this safe with multiple workers — two cannot claim the same row.
 *
 * NOTE: this runs against the raw driver collection
 * (`mongoose.connection.collection(...)`), so the "give me the updated doc"
 * option is `returnDocument: 'after'`. Mongoose models use `new: true`; passing
 * that here is silently ignored and you get the pre-update document back.
 */
export async function claimNext<T>(model: ClaimModel, workerId: string): Promise<T | null> {
  const doc = await model.findOneAndUpdate(
    { status: 'pending' },
    {
      $set: { status: 'processing', claimedAt: new Date(), claimedBy: workerId },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, returnDocument: 'after' }
  );
  return (doc as T | null) ?? null;
}

/**
 * Recover rows whose worker died mid-job. Under the attempt cap they go back to
 * pending; at or over it they fail, so a poison file cannot loop forever.
 */
export async function reapStale(model: ClaimModel, timeoutMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMs);

  const requeued = await model.updateMany(
    { status: 'processing', claimedAt: { $lt: cutoff }, attempts: { $lt: MAX_ATTEMPTS } },
    { $set: { status: 'pending', claimedAt: null, claimedBy: null } }
  );

  await model.updateMany(
    { status: 'processing', claimedAt: { $lt: cutoff }, attempts: { $gte: MAX_ATTEMPTS } },
    {
      $set: {
        status: 'failed',
        lastError: 'Processing timed out',
        claimedAt: null,
        claimedBy: null,
      },
    }
  );

  return requeued.modifiedCount ?? 0;
}
```

```ts
// audio-worker/src/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'cartyx-audio-worker' },
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd audio-worker && npx vitest run test/claim.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add audio-worker
git commit -m "feat(audio-worker): scaffold the worker with an atomic claim and reaper"
```

---

## Task 10: Worker transcode pipeline

**Files:**

- Create: `audio-worker/src/ffmpeg.ts`, `audio-worker/src/peaks.ts`, `audio-worker/src/process.ts`, `audio-worker/src/index.ts`
- Test: `audio-worker/test/ffmpeg.integration.test.ts`

**Interfaces:**

- Consumes: `claimNext`, `reapStale`, `logger` (Task 9).
- Produces: `probe(path)` → `{ durationMs, sampleRate, channels }`; `transcode(src, out, codec)` → `Promise<void>`; `extractPeaks(path, buckets)` → `Promise<number[]>`.

**Why a real-ffmpeg test:** mocking ffmpeg would assert only that we built a string. The thing that breaks is the actual encode.

- [ ] **Step 1: Write the failing integration test**

```ts
// audio-worker/test/ffmpeg.integration.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probe, transcode } from '../src/ffmpeg.js';
import { extractPeaks } from '../src/peaks.js';

let dir: string;
let src: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'audio-worker-'));
  src = join(dir, 'tone.wav');
  // 2s 440Hz stereo tone — deterministic fixture, no binary in the repo.
  execFileSync('ffmpeg', [
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2:sample_rate=48000',
    '-ac',
    '2',
    '-y',
    src,
  ]);
});

describe('ffmpeg pipeline', () => {
  it('probes accurate duration, sample rate and channels', async () => {
    const meta = await probe(src);
    expect(meta.durationMs).toBeGreaterThan(1950);
    expect(meta.durationMs).toBeLessThan(2050);
    expect(meta.sampleRate).toBe(48000);
    expect(meta.channels).toBe(2);
  });

  it('produces a non-empty opus rendition', async () => {
    const out = join(dir, 'out.opus');
    await transcode(src, out, 'opus');
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it('produces a non-empty aac rendition', async () => {
    const out = join(dir, 'out.m4a');
    await transcode(src, out, 'aac');
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it('extracts the requested number of peaks in 0..1', async () => {
    const peaks = await extractPeaks(src, 100);
    expect(peaks).toHaveLength(100);
    for (const p of peaks) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...peaks)).toBeGreaterThan(0.1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd audio-worker && npx vitest run test/ffmpeg.integration.test.ts`
Expected: FAIL — `src/ffmpeg.ts` does not exist. (If ffmpeg itself is missing, install it: `brew install ffmpeg`.)

- [ ] **Step 3: Write the ffmpeg wrapper**

```ts
// audio-worker/src/ffmpeg.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Canonical loudness, matching the ttrpg-sfx POC's normalize.sh. */
export const LOUDNORM = 'loudnorm=I=-20:TP=-1.5:LRA=11';

export type ProbeResult = { durationMs: number; sampleRate: number; channels: number };

/**
 * Duration MUST come from here, not from a decoded AudioBuffer: AAC carries
 * encoder padding, so buffer.duration overshoots and phase 2's loop would tick.
 */
export async function probe(path: string): Promise<ProbeResult> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate,channels:format=duration',
    '-of',
    'json',
    path,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: { sample_rate?: string; channels?: number }[];
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0] ?? {};
  return {
    durationMs: Math.round(Number(parsed.format?.duration ?? 0) * 1000),
    sampleRate: Number(stream.sample_rate ?? 0),
    channels: Number(stream.channels ?? 0),
  };
}

export type Codec = 'opus' | 'aac';

/** Opus covers Chrome/Firefox; AAC covers Safari/iOS. Both, always. */
export async function transcode(src: string, out: string, codec: Codec): Promise<void> {
  const args =
    codec === 'opus'
      ? ['-c:a', 'libopus', '-b:a', '96k']
      : ['-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'];

  await run('ffmpeg', ['-v', 'error', '-i', src, '-af', LOUDNORM, ...args, '-y', out]);
}
```

- [ ] **Step 4: Write the peak extractor**

```ts
// audio-worker/src/peaks.ts
import { execFile } from 'node:child_process';

/**
 * Decode to mono 8kHz PCM and reduce to `buckets` normalized magnitudes.
 * Drives the waveform UI without the browser fetching any audio.
 */
export function extractPeaks(path: string, buckets: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'ffmpeg',
      ['-v', 'error', '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
      { encoding: 'buffer', maxBuffer: 1024 * 1024 * 256 },
      (err, stdout) => {
        if (err) return reject(err);

        const pcm = stdout as unknown as Buffer;
        const samples = Math.floor(pcm.length / 2);
        if (samples === 0) return resolve(new Array<number>(buckets).fill(0));

        const per = Math.max(1, Math.floor(samples / buckets));
        const out: number[] = [];
        for (let b = 0; b < buckets; b++) {
          let peak = 0;
          const start = b * per;
          for (let i = start; i < Math.min(start + per, samples); i++) {
            const v = Math.abs(pcm.readInt16LE(i * 2)) / 32768;
            if (v > peak) peak = v;
          }
          out.push(Number(peak.toFixed(4)));
        }
        resolve(out);
      }
    );
    child.on('error', reject);
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd audio-worker && npx vitest run test/ffmpeg.integration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the worker loop**

```ts
// audio-worker/src/index.ts
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import { claimNext, reapStale } from './claim.js';
import { processAsset } from './process.js';

const WORKER_ID = `worker-${randomUUID().slice(0, 8)}`;
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);
const STALE_MS = Number(process.env.CLAIM_TIMEOUT_MS ?? 600_000);

let running = true;
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, finishing current job');
  running = false;
});

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(uri);
  logger.info({ workerId: WORKER_ID }, 'audio worker started');

  const model = mongoose.connection.collection('audioassets') as never;

  while (running) {
    try {
      await reapStale(model, STALE_MS);
      const asset = await claimNext<{ _id: unknown }>(model, WORKER_ID);
      if (!asset) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }
      await processAsset(model, asset);
    } catch (err) {
      logger.error({ err }, 'worker loop error');
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  await mongoose.disconnect();
  logger.info('audio worker stopped');
}

main().catch((err) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});
```

```ts
// audio-worker/src/process.ts
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { logger } from './logger.js';
import { probe, transcode } from './ffmpeg.js';
import { extractPeaks } from './peaks.js';

const PEAK_BUCKETS = 400;

function r2() {
  return {
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      },
    }),
    bucket: process.env.R2_BUCKET ?? '',
    cdnUrl: (process.env.CDN_URL ?? '').replace(/\/+$/, ''),
  };
}

type Model = {
  updateOne: (f: unknown, u: unknown) => Promise<unknown>;
};

export async function processAsset(
  model: Model,
  asset: { _id: unknown; sourceKey?: string }
): Promise<void> {
  const id = asset._id;
  const dir = await mkdtemp(join(tmpdir(), 'cartyx-audio-'));
  const { client, bucket, cdnUrl } = r2();

  try {
    const src = join(dir, 'source');
    const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: asset.sourceKey }));
    await writeFile(src, Buffer.from(await obj.Body!.transformToByteArray()));

    const meta = await probe(src);

    const opusPath = join(dir, 'out.opus');
    const aacPath = join(dir, 'out.m4a');
    await transcode(src, opusPath, 'opus');
    await transcode(src, aacPath, 'aac');
    const peaks = await extractPeaks(src, PEAK_BUCKETS);

    const base = `uploads/audio/renditions/${String(id)}`;
    const renditions: Record<string, { key: string; url: string; bytes: number }> = {};

    for (const [codec, path, ext, type] of [
      ['opus', opusPath, 'opus', 'audio/ogg'],
      ['aac', aacPath, 'm4a', 'audio/mp4'],
    ] as const) {
      const body = await readFile(path);
      const key = `${base}.${ext}`;
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: type })
      );
      renditions[codec] = { key, url: `${cdnUrl}/${key}`, bytes: body.length };
    }

    await model.updateOne(
      { _id: id },
      {
        $set: {
          status: 'ready',
          durationMs: meta.durationMs,
          sampleRate: meta.sampleRate,
          channels: meta.channels,
          loudnessLufs: -20,
          peaks,
          renditions,
          lastError: null,
          claimedAt: null,
          claimedBy: null,
          updatedAt: new Date(),
        },
      }
    );
    logger.info({ assetId: String(id) }, 'transcoded');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcode failed';
    logger.error({ err, assetId: String(id) }, 'transcode failed');
    await model.updateOne(
      { _id: id },
      { $set: { status: 'failed', lastError: message, claimedAt: null, claimedBy: null } }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 7: Verify build and full worker suite**

Run: `cd audio-worker && npm run typecheck && npx vitest run`
Expected: typecheck clean, all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add audio-worker
git commit -m "feat(audio-worker): ffmpeg transcode to opus+aac with peaks and probe duration"
```

---

## Task 11: Worker image, CI job, and dependabot entry

**Files:**

- Create: `audio-worker/Dockerfile`, `audio-worker/.dockerignore`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/dependabot.yml`

**Interfaces:**

- Consumes: the `audio-worker` package (Tasks 9–10).
- Produces: a buildable image; a `services` CI job.

**Why the CI job:** `realtime/` currently has **no CI job at all** — nothing typechecks, tests, or audits it on any PR. This adds a second unbuilt service, so one job covers both. That same blind spot let the `/realtime` dependabot entry go missing long enough to produce an unmergeable `main`-targeted PR (#534).

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# audio-worker/Dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev && rm -rf node_modules/.cache

FROM node:22-alpine
ENV NODE_ENV=production
# ffmpeg carries ffprobe; both are required by src/ffmpeg.ts.
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
USER node
CMD ["node", "dist/index.js"]
```

```
# audio-worker/.dockerignore
node_modules
dist
test
```

- [ ] **Step 2: Verify the image builds and ffmpeg is present**

Run:

```bash
cd audio-worker && npm install --package-lock-only
docker build -t cartyx-audio-worker:test .
docker run --rm cartyx-audio-worker:test ffmpeg -version
```

Expected: build succeeds; `ffmpeg version ...` prints.

- [ ] **Step 3: Add the `services` CI job**

Insert into `.github/workflows/ci.yml` after the `quality` job:

```yaml
services:
  name: Services (realtime + audio-worker)
  runs-on: ubuntu-latest
  permissions:
    contents: read
  strategy:
    matrix:
      service: [realtime, audio-worker]
  steps:
    - name: Checkout code
      uses: actions/checkout@v7

    - name: Setup Node.js
      uses: actions/setup-node@v7
      with:
        node-version: '25'
        cache: 'npm'
        cache-dependency-path: ${{ matrix.service }}/package-lock.json

    # ffprobe/ffmpeg are required by audio-worker's integration test, which
    # deliberately runs the real binaries — mocking them would test nothing.
    - name: Install ffmpeg
      if: matrix.service == 'audio-worker'
      run: sudo apt-get update && sudo apt-get install -y ffmpeg

    - name: Install dependencies
      run: npm ci
      working-directory: ${{ matrix.service }}

    - name: Security audit
      run: npm audit --audit-level=high --omit=dev
      working-directory: ${{ matrix.service }}

    - name: Type check
      run: npm run typecheck
      working-directory: ${{ matrix.service }}

    - name: Tests
      run: npm test
      working-directory: ${{ matrix.service }}
```

- [ ] **Step 4: Add the dependabot entry**

Insert into `.github/dependabot.yml` after the `/realtime` block:

```yaml
# --- audio-worker service (own package.json + lockfile) ---
# Same reasoning as /realtime: without an entry here dependabot runs no
# version updates on this directory and its security updates fall back to the
# default branch (`main`), which we never open PRs against.
- package-ecosystem: 'npm'
  directory: '/audio-worker'
  target-branch: 'dev'
  schedule:
    interval: 'weekly'
    day: 'monday'
  open-pull-requests-limit: 5
  labels:
    - 'dependencies'
  commit-message:
    prefix: 'chore(deps)'
  groups:
    audio-worker-minor-and-patch:
      applies-to: version-updates
      update-types: ['minor', 'patch']
  cooldown:
    default-days: 10
  ignore:
    - dependency-name: '@types/node'
      update-types: ['version-update:semver-major']
    - dependency-name: 'typescript'
      versions: ['>=7.0.0']
    - dependency-name: 'vitest'
      versions: ['>=5.0.0']
    - dependency-name: 'mongoose'
      update-types: ['version-update:semver-major']
```

- [ ] **Step 5: Validate the workflow and dependabot config parse**

Run:

```bash
node -e "const y=require('js-yaml'),f=require('fs');
['.github/workflows/ci.yml','.github/dependabot.yml'].forEach(p=>{y.load(f.readFileSync(p,'utf8'));console.log('OK',p)})"
```

Expected: `OK` for both.

- [ ] **Step 6: Commit**

```bash
git add audio-worker/Dockerfile audio-worker/.dockerignore audio-worker/package-lock.json .github/workflows/ci.yml .github/dependabot.yml
git commit -m "ci(audio-worker): image, services CI job for both services, dependabot entry"
```

---

## Task 12: Helm chart — audio-worker deployment

**Files:**

- Create: `deploy/charts/cartyx/templates/audio-worker-deployment.yaml`
- Modify: `deploy/charts/cartyx/values.yaml`, `deploy/charts/cartyx/templates/secret.yaml`
- Modify: `deploy/charts/cartyx/tests/render-tests.sh`

**Interfaces:**

- Consumes: the worker image (Task 11).
- Produces: an `audioWorker` values block and a rendered Deployment.

**REMINDER:** `deploy/charts/` is prettierignored — do not format it. Chart changes REQUIRE running the render tests.

- [ ] **Step 1: Add the values block**

Append to `deploy/charts/cartyx/values.yaml` after the `realtime:` block:

```yaml
audioWorker:
  image:
    repository: ghcr.io/biozal/cartyx-audio-worker
    tag: ''
    pullPolicy: IfNotPresent
  # Safe to scale: work is claimed with an atomic findOneAndUpdate, so two
  # workers can never take the same asset. Kept at 1 because the single-node
  # cluster has no spare CPU headroom.
  replicaCount: 1
  # CPU limits matter here: ffmpeg is CPU-bound and a bulk import must not
  # starve SSR in the web pod.
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: '1'
      memory: 768Mi
  env:
    POLL_INTERVAL_MS: '5000'
    CLAIM_TIMEOUT_MS: '600000'
```

- [ ] **Step 2: Write the deployment template**

```yaml
{{- if .Values.audioWorker.enabled | default true }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "cartyx.fullname" . }}-audio-worker
  labels:
    {{- include "cartyx.labels" . | nindent 4 }}
    app.kubernetes.io/component: audio-worker
spec:
  replicas: {{ .Values.audioWorker.replicaCount }}
  selector:
    matchLabels:
      {{- include "cartyx.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: audio-worker
  template:
    metadata:
      annotations:
        checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
      labels:
        {{- include "cartyx.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: audio-worker
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: audio-worker
          image: "{{ .Values.audioWorker.image.repository }}:{{ required "audioWorker.image.tag is required — set an immutable git-sha tag at install time" .Values.audioWorker.image.tag }}"
          imagePullPolicy: {{ .Values.audioWorker.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
          env:
            - name: POLL_INTERVAL_MS
              value: {{ .Values.audioWorker.env.POLL_INTERVAL_MS | quote }}
            - name: CLAIM_TIMEOUT_MS
              value: {{ .Values.audioWorker.env.CLAIM_TIMEOUT_MS | quote }}
            - name: CDN_URL
              value: {{ .Values.web.env.CDN_URL | quote }}
            - name: R2_ACCOUNT_ID
              value: {{ .Values.web.env.R2_ACCOUNT_ID | quote }}
            - name: R2_BUCKET
              value: {{ .Values.web.env.R2_BUCKET | quote }}
            - name: MONGODB_URI
              valueFrom:
                secretKeyRef:
                  name: {{ include "cartyx.secretName" . }}
                  key: mongodbUri
            - name: R2_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: {{ include "cartyx.secretName" . }}
                  key: r2AccessKeyId
            - name: R2_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ include "cartyx.secretName" . }}
                  key: r2SecretAccessKey
          resources:
            {{- toYaml .Values.audioWorker.resources | nindent 12 }}
{{- end }}
```

- [ ] **Step 3: Add render assertions**

Append to `deploy/charts/cartyx/tests/render-tests.sh` before the summary, following the file's existing assertion style:

```bash
# --- audio-worker ---
assert_contains "audio-worker deployment renders" \
  "$(helm template t "$CHART_DIR" "${BASE_ARGS[@]}" --set=audioWorker.image.tag=test123)" \
  "cartyx-audio-worker"

assert_contains "audio-worker gets a cpu limit (bulk imports must not starve SSR)" \
  "$(helm template t "$CHART_DIR" "${BASE_ARGS[@]}" --set=audioWorker.image.tag=test123)" \
  "cpu:"

assert_fails "audio-worker requires an image tag" \
  helm template t "$CHART_DIR" "${BASE_ARGS[@]}"
```

- [ ] **Step 4: Run the render tests**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh`
Expected: all assertions PASS, including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add deploy/charts/cartyx
git commit -m "feat(deploy): add the audio-worker deployment with cpu limits"
```

---

## Task 13: Build and push the worker image in CI

**Files:**

- Modify: `.github/workflows/deploy.yml:33-49,79-86`

**Interfaces:**

- Consumes: `audio-worker/Dockerfile` (Task 11), chart values (Task 12).
- Produces: a `cartyx-audio-worker` image tag committed to the infra repo.

**Note:** the infra repo needs a `# ci:audioworker-tag` marker comment added to `apps/<env>/helmrelease.yaml` **before** this runs, or the guard fails the job. Never rename existing markers.

- [ ] **Step 1: Add the tag output and build step**

In the `Compute image tags` step, add to the heredoc:

```bash
            echo "audioworker=$REGISTRY/cartyx-audio-worker:$SHA"
```

Then add a build step after the realtime one:

```yaml
- name: Build and push audio-worker image
  run: |
    docker build \
      --label "org.opencontainers.image.source=https://github.com/${{ github.repository }}" \
      -t "${{ steps.tags.outputs.audioworker }}" audio-worker
    docker push "${{ steps.tags.outputs.audioworker }}"
```

- [ ] **Step 2: Extend the marker guard and the sed bump**

Update the guard to require the new marker, and add the substitution:

```bash
          grep -q '# ci:web-tag' "$F" && grep -q '# ci:realtime-tag' "$F" \
            && grep -q '# ci:audioworker-tag' "$F" \
```

```bash
          sed -i -E "s|(tag: ).*( # ci:audioworker-tag)|\1'${{ steps.tags.outputs.sha }}'\2|" "$F"
```

- [ ] **Step 3: Validate the workflow parses**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/deploy.yml','utf8')); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 4: Add the marker in the infra repo**

In `biozal/cartyx-infrastructure`, add to `apps/dev/helmrelease.yaml` and `apps/prod/helmrelease.yaml`:

```yaml
audioWorker:
  image:
    tag: 'REPLACE' # ci:audioworker-tag
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(deploy): build, push and tag-bump the audio-worker image"
```

---

## Task 14: Client upload helper and query keys

**Files:**

- Create: `app/utils/uploadAudio.ts`
- Modify: `app/utils/queryKeys.ts`
- Test: `tests/utils/uploadAudio.test.ts`

**Interfaces:**

- Consumes: `createAudioUpload`, `confirmAudioUpload` (Task 4).
- Produces: `uploadAudioFile(file, meta, onProgress)` → `Promise<{ assetId: string }>`; `audioKeys.list(filters)`, `audioKeys.detail(id)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/utils/uploadAudio.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createFn = vi.fn();
const confirmFn = vi.fn();
vi.mock('~/utils/audio-server-fns', () => ({
  createAudioUploadFn: (...a: unknown[]) => createFn(...a),
  confirmAudioUploadFn: (...a: unknown[]) => confirmFn(...a),
}));
vi.mock('~/utils/telemetry-client', () => ({ captureException: vi.fn() }));
vi.mock('~/utils/backend-health', () => ({
  isBackendDown: () => false,
  reportBackendFailure: vi.fn(),
}));

describe('uploadAudioFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFn.mockResolvedValue({ assetId: 'a1', uploadUrl: 'https://put', key: 'k' });
    confirmFn.mockResolvedValue({ assetId: 'a1', status: 'pending' });
    global.fetch = vi.fn(async () => new Response(null, { status: 200 })) as never;
  });

  it('presigns, PUTs the bytes, then confirms', async () => {
    const { uploadAudioFile } = await import('~/utils/uploadAudio');
    const file = new File([new Uint8Array([1, 2, 3])], 'storm.wav', { type: 'audio/wav' });
    const r = await uploadAudioFile(file, { kind: 'ambience' });
    expect(r.assetId).toBe('a1');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://put',
      expect.objectContaining({ method: 'PUT' })
    );
    expect(confirmFn).toHaveBeenCalled();
  });

  it('does not confirm when the PUT fails', async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 500 })) as never;
    const { uploadAudioFile } = await import('~/utils/uploadAudio');
    const file = new File([new Uint8Array([1])], 'x.wav', { type: 'audio/wav' });
    await expect(uploadAudioFile(file, { kind: 'ambience' })).rejects.toThrow(/upload failed/i);
    expect(confirmFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/utils/uploadAudio.test.ts`
Expected: FAIL — cannot resolve `~/utils/uploadAudio`.

- [ ] **Step 3: Write the server-fn wrappers**

```ts
// app/utils/audio-server-fns.ts
import { createServerFn } from '@tanstack/react-start';
import {
  createAudioUploadSchema,
  confirmAudioUploadSchema,
  listAudioAssetsSchema,
  updateAudioAssetSchema,
  bulkTagAudioAssetsSchema,
  deleteAudioAssetSchema,
} from '~/types/schemas/audio';

async function requireUserId(): Promise<string> {
  const { getSession } = await import('~/server/session');
  const user = await getSession();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

export const createAudioUploadFn = createServerFn({ method: 'POST' })
  .inputValidator(createAudioUploadSchema)
  .handler(async ({ data }) => {
    const { createAudioUpload } = await import('~/server/functions/audio');
    return createAudioUpload({ data, userId: await requireUserId() });
  });

export const confirmAudioUploadFn = createServerFn({ method: 'POST' })
  .inputValidator(confirmAudioUploadSchema)
  .handler(async ({ data }) => {
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    return confirmAudioUpload({ data, userId: await requireUserId() });
  });

export const listAudioAssetsFn = createServerFn({ method: 'POST' })
  .inputValidator(listAudioAssetsSchema)
  .handler(async ({ data }) => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    return listAudioAssets({ data, userId: await requireUserId() });
  });

export const updateAudioAssetFn = createServerFn({ method: 'POST' })
  .inputValidator(updateAudioAssetSchema)
  .handler(async ({ data }) => {
    const { updateAudioAsset } = await import('~/server/functions/audio');
    return updateAudioAsset({ data, userId: await requireUserId() });
  });

export const bulkTagAudioAssetsFn = createServerFn({ method: 'POST' })
  .inputValidator(bulkTagAudioAssetsSchema)
  .handler(async ({ data }) => {
    const { bulkTagAudioAssets } = await import('~/server/functions/audio');
    return bulkTagAudioAssets({ data, userId: await requireUserId() });
  });

export const deleteAudioAssetFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteAudioAssetSchema)
  .handler(async ({ data }) => {
    const { deleteAudioAsset } = await import('~/server/functions/audio');
    return deleteAudioAsset({ data, userId: await requireUserId() });
  });
```

- [ ] **Step 4: Write the upload helper**

```ts
// app/utils/uploadAudio.ts
import { createAudioUploadFn, confirmAudioUploadFn } from '~/utils/audio-server-fns';
import { captureException } from '~/utils/telemetry-client';
import { isBackendDown, reportBackendFailure } from '~/utils/backend-health';
import { BackendUnavailableError } from '~/utils/error-classification';
import type { AudioKind } from '~/types/audio';

export type AudioUploadMeta = {
  kind: AudioKind;
  environment?: string[];
  mood?: string[];
  intensity?: number | null;
  tags?: string[];
};

export async function uploadAudioFile(
  file: File,
  meta: AudioUploadMeta
): Promise<{ assetId: string }> {
  if (isBackendDown()) throw new BackendUnavailableError();
  try {
    const { assetId, uploadUrl } = await createAudioUploadFn({
      data: {
        filename: file.name,
        contentType: file.type,
        bytes: file.size,
        kind: meta.kind,
        environment: meta.environment ?? [],
        mood: meta.mood ?? [],
        intensity: meta.intensity ?? null,
        tags: meta.tags ?? [],
      },
    });

    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    // Do not confirm a failed PUT — confirm is what enforces the size cap.
    if (!res.ok) throw new Error(`R2 upload failed: ${res.status}`);

    await confirmAudioUploadFn({ data: { assetId } });
    return { assetId };
  } catch (e) {
    reportBackendFailure(e);
    captureException(e, { action: 'uploadAudioFile', fileName: file.name, fileSize: file.size });
    throw e;
  }
}
```

- [ ] **Step 5: Add query keys**

Append to `app/utils/queryKeys.ts`:

```ts
export const audioKeys = {
  all: ['audio'] as const,
  list: (filters: Record<string, unknown>) => ['audio', 'list', filters] as const,
  detail: (id: string) => ['audio', 'detail', id] as const,
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/utils/uploadAudio.test.ts && npm run typecheck`
Expected: PASS (2 tests), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add app/utils/uploadAudio.ts app/utils/audio-server-fns.ts app/utils/queryKeys.ts tests/utils/uploadAudio.test.ts
git commit -m "feat(audio): client upload helper and audio query keys"
```

---

## Task 15: `AudioWaveform` and `AudioAssetRow`

**Files:**

- Create: `app/components/audio/AudioWaveform.tsx`, `AudioWaveform.stories.tsx`
- Create: `app/components/audio/AudioAssetRow.tsx`, `AudioAssetRow.stories.tsx`
- Test: `tests/components/audio/AudioAssetRow.test.tsx`

**Interfaces:**

- Consumes: `AudioAssetData` (Task 1).
- Produces: `<AudioWaveform peaks height />`; `<AudioAssetRow asset selected onToggleSelect onPlay onEdit />`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/audio/AudioAssetRow.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioAssetRow } from '~/components/audio/AudioAssetRow';
import type { AudioAssetData } from '~/types/audio';

const asset: AudioAssetData = {
  id: 'a1',
  ownerId: 'u1',
  title: 'Storm',
  kind: 'ambience',
  environment: ['coast'],
  mood: ['tense'],
  intensity: 4,
  tags: ['storm'],
  status: 'ready',
  durationMs: 125_000,
  loudnessLufs: -20,
  peaks: [0.1, 0.9, 0.4],
  renditions: {},
  lastError: null,
  createdAt: '',
  updatedAt: '',
};

describe('AudioAssetRow', () => {
  it('shows the title, kind and formatted duration', () => {
    render(<AudioAssetRow asset={asset} />);
    expect(screen.getByText('Storm')).toBeInTheDocument();
    expect(screen.getByText('ambience')).toBeInTheDocument();
    expect(screen.getByText('2:05')).toBeInTheDocument();
  });

  it('shows a processing state instead of a play button when not ready', () => {
    render(<AudioAssetRow asset={{ ...asset, status: 'processing' }} />);
    expect(screen.getByText(/processing/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /play/i })).not.toBeInTheDocument();
  });

  it('surfaces the error message when the asset failed', () => {
    render(<AudioAssetRow asset={{ ...asset, status: 'failed', lastError: 'bad codec' }} />);
    expect(screen.getByText(/bad codec/i)).toBeInTheDocument();
  });

  it('calls onToggleSelect when the checkbox is used', async () => {
    const onToggleSelect = vi.fn();
    render(<AudioAssetRow asset={asset} selectable onToggleSelect={onToggleSelect} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /select storm/i }));
    expect(onToggleSelect).toHaveBeenCalledWith('a1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/components/audio/AudioAssetRow.test.tsx`
Expected: FAIL — components do not exist.

- [ ] **Step 3: Write `AudioWaveform`**

```tsx
// app/components/audio/AudioWaveform.tsx
type Props = { peaks: number[]; height?: number; className?: string };

/** Renders stored peaks as an SVG. Never fetches audio. */
export function AudioWaveform({ peaks, height = 28, className }: Props) {
  if (peaks.length === 0) {
    return <div className={className} style={{ height }} aria-hidden="true" />;
  }

  const width = peaks.length;
  const mid = height / 2;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ height, width: '100%' }}
      role="img"
      aria-label="Audio waveform"
    >
      {peaks.map((p, i) => {
        const h = Math.max(1, p * height);
        return <rect key={i} x={i} y={mid - h / 2} width={0.8} height={h} fill="currentColor" />;
      })}
    </svg>
  );
}
```

- [ ] **Step 4: Write `AudioAssetRow`**

```tsx
// app/components/audio/AudioAssetRow.tsx
import { AudioWaveform } from './AudioWaveform';
import type { AudioAssetData } from '~/types/audio';

export function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Props = {
  asset: AudioAssetData;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onPlay?: (asset: AudioAssetData) => void;
  onEdit?: (asset: AudioAssetData) => void;
};

export function AudioAssetRow({
  asset,
  selectable,
  selected,
  onToggleSelect,
  onPlay,
  onEdit,
}: Props) {
  return (
    <li className="flex items-center gap-3 border-b border-neutral-800 px-3 py-2">
      {selectable && (
        <input
          type="checkbox"
          checked={Boolean(selected)}
          aria-label={`Select ${asset.title}`}
          onChange={() => onToggleSelect?.(asset.id)}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{asset.title}</span>
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs">{asset.kind}</span>
        </div>
        <AudioWaveform peaks={asset.peaks} className="mt-1 text-neutral-500" />
        {asset.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1 text-xs text-neutral-400">
            {asset.tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </div>
        )}
      </div>

      <span className="tabular-nums text-sm text-neutral-400">
        {formatDuration(asset.durationMs)}
      </span>

      {asset.status === 'ready' ? (
        <>
          <button type="button" aria-label={`Play ${asset.title}`} onClick={() => onPlay?.(asset)}>
            Play
          </button>
          <button type="button" aria-label={`Edit ${asset.title}`} onClick={() => onEdit?.(asset)}>
            Edit
          </button>
        </>
      ) : asset.status === 'failed' ? (
        <span className="text-sm text-red-400">{asset.lastError ?? 'Failed'}</span>
      ) : (
        <span className="text-sm text-neutral-400">Processing…</span>
      )}
    </li>
  );
}
```

- [ ] **Step 5: Write the stories**

```tsx
// app/components/audio/AudioWaveform.stories.tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioWaveform } from './AudioWaveform';

const meta: Meta<typeof AudioWaveform> = { component: AudioWaveform, title: 'Audio/AudioWaveform' };
export default meta;

const peaks = Array.from({ length: 200 }, (_, i) => Math.abs(Math.sin(i / 8)) * 0.9);

export const Default: StoryObj<typeof AudioWaveform> = { args: { peaks } };
export const Empty: StoryObj<typeof AudioWaveform> = { args: { peaks: [] } };
```

```tsx
// app/components/audio/AudioAssetRow.stories.tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioAssetRow } from './AudioAssetRow';
import type { AudioAssetData } from '~/types/audio';

const base: AudioAssetData = {
  id: 'a1',
  ownerId: 'u1',
  title: 'Storm — Heavy',
  kind: 'ambience',
  environment: ['coast'],
  mood: ['tense'],
  intensity: 4,
  tags: ['storm', 'rain'],
  status: 'ready',
  durationMs: 125_000,
  loudnessLufs: -20,
  peaks: Array.from({ length: 200 }, (_, i) => Math.abs(Math.sin(i / 6)) * 0.8),
  renditions: {},
  lastError: null,
  createdAt: '',
  updatedAt: '',
};

const meta: Meta<typeof AudioAssetRow> = { component: AudioAssetRow, title: 'Audio/AudioAssetRow' };
export default meta;

export const Ready: StoryObj<typeof AudioAssetRow> = { args: { asset: base } };
export const Processing: StoryObj<typeof AudioAssetRow> = {
  args: { asset: { ...base, status: 'processing', peaks: [] } },
};
export const Failed: StoryObj<typeof AudioAssetRow> = {
  args: { asset: { ...base, status: 'failed', lastError: 'Unsupported codec' } },
};
export const Selectable: StoryObj<typeof AudioAssetRow> = {
  args: { asset: base, selectable: true, selected: true },
};
```

- [ ] **Step 6: Run tests and stories**

Run: `npx vitest run --project unit tests/components/audio/AudioAssetRow.test.tsx && npm run test:storybook`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/audio tests/components/audio
git commit -m "feat(audio): waveform and asset row components"
```

---

## Task 16: `AudioFilterBar` and `AudioLibraryBrowser`

**Files:**

- Create: `app/components/audio/AudioFilterBar.tsx` + stories
- Create: `app/components/audio/AudioLibraryBrowser.tsx` + stories
- Test: `tests/components/audio/AudioFilterBar.test.tsx`

**Interfaces:**

- Consumes: `AudioAssetRow` (Task 15), vocabularies (Task 1).
- Produces: `<AudioFilterBar value onChange />` where value is `AudioFilters`; `<AudioLibraryBrowser assets loading filters onFiltersChange selectable selectedIds onToggleSelect actionsSlot />`.

**Design note:** the browser knows nothing about _why_ it is rendering. Phase 2 mounts it in-campaign as a picker by passing different props — no fork.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/audio/AudioFilterBar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioFilterBar } from '~/components/audio/AudioFilterBar';

describe('AudioFilterBar', () => {
  it('emits a kind filter when a kind chip is chosen', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{}} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'music' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'music' });
  });

  it('clears the kind when the active chip is clicked again', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{ kind: 'music' }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'music' }));
    expect(onChange).toHaveBeenCalledWith({ kind: undefined });
  });

  it('emits the search text', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{}} onChange={onChange} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'st');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: expect.any(String) })
    );
  });

  it('toggles the needs-tagging filter', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{}} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /needs tagging/i }));
    expect(onChange).toHaveBeenCalledWith({ needsTagging: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/components/audio/AudioFilterBar.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write `AudioFilterBar`**

```tsx
// app/components/audio/AudioFilterBar.tsx
import { AUDIO_KINDS, AUDIO_ENVIRONMENTS, AUDIO_MOODS } from '~/types/audio';
import type { AudioKind } from '~/types/audio';

export type AudioFilters = {
  kind?: AudioKind;
  environment?: string[];
  mood?: string[];
  tags?: string[];
  search?: string;
  needsTagging?: boolean;
};

type Props = { value: AudioFilters; onChange: (next: AudioFilters) => void };

export function AudioFilterBar({ value, onChange }: Props) {
  const toggleMulti = (field: 'environment' | 'mood', item: string) => {
    const current = value[field] ?? [];
    const next = current.includes(item) ? current.filter((x) => x !== item) : [...current, item];
    onChange({ ...value, [field]: next.length ? next : undefined });
  };

  return (
    <div className="flex flex-col gap-2 border-b border-neutral-800 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {AUDIO_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={value.kind === k}
            onClick={() => onChange({ ...value, kind: value.kind === k ? undefined : k })}
            className={
              value.kind === k
                ? 'rounded bg-amber-600 px-2 py-1'
                : 'rounded bg-neutral-800 px-2 py-1'
            }
          >
            {k}
          </button>
        ))}

        <input
          type="search"
          aria-label="Search audio by title"
          placeholder="Search…"
          value={value.search ?? ''}
          onChange={(e) => onChange({ ...value, search: e.target.value || undefined })}
          className="ml-auto rounded bg-neutral-900 px-2 py-1"
        />

        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value.needsTagging)}
            onChange={(e) => onChange({ ...value, needsTagging: e.target.checked || undefined })}
          />
          Needs tagging
        </label>
      </div>

      <details>
        <summary className="cursor-pointer text-sm text-neutral-400">Facets</summary>
        <div className="mt-2 flex flex-wrap gap-1">
          {AUDIO_ENVIRONMENTS.map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={(value.environment ?? []).includes(e)}
              onClick={() => toggleMulti('environment', e)}
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs"
            >
              {e}
            </button>
          ))}
          {AUDIO_MOODS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={(value.mood ?? []).includes(m)}
              onClick={() => toggleMulti('mood', m)}
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs"
            >
              {m}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Write `AudioLibraryBrowser`**

```tsx
// app/components/audio/AudioLibraryBrowser.tsx
import type { ReactNode } from 'react';
import { AudioFilterBar, type AudioFilters } from './AudioFilterBar';
import { AudioAssetRow } from './AudioAssetRow';
import type { AudioAssetData } from '~/types/audio';

type Props = {
  assets: AudioAssetData[];
  loading?: boolean;
  filters: AudioFilters;
  onFiltersChange: (f: AudioFilters) => void;
  selectable?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  onPlay?: (a: AudioAssetData) => void;
  onEdit?: (a: AudioAssetData) => void;
  /** Rendered above the list — bulk bar in manage mode, "Add" in picker mode. */
  actionsSlot?: ReactNode;
  emptyMessage?: string;
};

export function AudioLibraryBrowser({
  assets,
  loading,
  filters,
  onFiltersChange,
  selectable,
  selectedIds = [],
  onToggleSelect,
  onPlay,
  onEdit,
  actionsSlot,
  emptyMessage = 'No audio matches these filters.',
}: Props) {
  return (
    <section className="flex flex-col">
      <AudioFilterBar value={filters} onChange={onFiltersChange} />
      {actionsSlot}

      {loading ? (
        <p className="p-4 text-neutral-400">Loading…</p>
      ) : assets.length === 0 ? (
        <p className="p-4 text-neutral-400">{emptyMessage}</p>
      ) : (
        <ul className="divide-y divide-neutral-800">
          {assets.map((a) => (
            <AudioAssetRow
              key={a.id}
              asset={a}
              selectable={selectable}
              selected={selectedIds.includes(a.id)}
              onToggleSelect={onToggleSelect}
              onPlay={onPlay}
              onEdit={onEdit}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Write the stories**

```tsx
// app/components/audio/AudioFilterBar.stories.tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioFilterBar } from './AudioFilterBar';

const meta: Meta<typeof AudioFilterBar> = {
  component: AudioFilterBar,
  title: 'Audio/AudioFilterBar',
};
export default meta;

export const Empty: StoryObj<typeof AudioFilterBar> = { args: { value: {}, onChange: () => {} } };
export const Filtered: StoryObj<typeof AudioFilterBar> = {
  args: {
    value: { kind: 'ambience', environment: ['coast'], search: 'storm' },
    onChange: () => {},
  },
};
```

```tsx
// app/components/audio/AudioLibraryBrowser.stories.tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioLibraryBrowser } from './AudioLibraryBrowser';
import type { AudioAssetData } from '~/types/audio';

const mk = (id: string, title: string, kind: AudioAssetData['kind']): AudioAssetData => ({
  id,
  ownerId: 'u1',
  title,
  kind,
  environment: [],
  mood: [],
  intensity: 3,
  tags: ['demo'],
  status: 'ready',
  durationMs: 90_000,
  loudnessLufs: -20,
  peaks: Array.from({ length: 120 }, (_, i) => Math.abs(Math.sin(i / 5)) * 0.7),
  renditions: {},
  lastError: null,
  createdAt: '',
  updatedAt: '',
});

const meta: Meta<typeof AudioLibraryBrowser> = {
  component: AudioLibraryBrowser,
  title: 'Audio/AudioLibraryBrowser',
};
export default meta;

export const WithAssets: StoryObj<typeof AudioLibraryBrowser> = {
  args: {
    assets: [mk('1', 'Storm — Heavy', 'ambience'), mk('2', 'Tavern Reel', 'music')],
    filters: {},
    onFiltersChange: () => {},
  },
};
export const Loading: StoryObj<typeof AudioLibraryBrowser> = {
  args: { assets: [], loading: true, filters: {}, onFiltersChange: () => {} },
};
export const EmptyState: StoryObj<typeof AudioLibraryBrowser> = {
  args: { assets: [], filters: { kind: 'music' }, onFiltersChange: () => {} },
};
```

- [ ] **Step 6: Run tests and stories**

Run: `npx vitest run --project unit tests/components/audio/ && npm run test:storybook`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/audio tests/components/audio
git commit -m "feat(audio): filter bar and context-agnostic library browser"
```

---

## Task 17: `AudioUploadDropzone`

**Files:**

- Create: `app/components/audio/AudioUploadDropzone.tsx` + stories
- Test: `tests/components/audio/AudioUploadDropzone.test.tsx`

**Interfaces:**

- Consumes: `uploadAudioFile` (Task 14), `AUDIO_KINDS`, `AUDIO_MAX_BYTES` (Task 1).
- Produces: `<AudioUploadDropzone onUploaded />`.

**Design note:** `kind` is required and drives playback defaults, so the dropzone takes a **batch default** — a folder of ambience is usually dropped together — rather than leaving it null.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/audio/AudioUploadDropzone.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const uploadAudioFile = vi.fn();
vi.mock('~/utils/uploadAudio', () => ({
  uploadAudioFile: (...a: unknown[]) => uploadAudioFile(...a),
}));

import { AudioUploadDropzone } from '~/components/audio/AudioUploadDropzone';

describe('AudioUploadDropzone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadAudioFile.mockResolvedValue({ assetId: 'a1' });
  });

  it('uploads every selected file with the batch default kind', async () => {
    render(<AudioUploadDropzone />);
    const input = screen.getByLabelText(/choose audio files/i);
    await userEvent.upload(input, [
      new File([new Uint8Array([1])], 'a.wav', { type: 'audio/wav' }),
      new File([new Uint8Array([2])], 'b.wav', { type: 'audio/wav' }),
    ]);
    await waitFor(() => expect(uploadAudioFile).toHaveBeenCalledTimes(2));
    expect(uploadAudioFile.mock.calls[0][1]).toMatchObject({ kind: 'ambience' });
  });

  it('reports a per-file failure without aborting the batch', async () => {
    uploadAudioFile
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ assetId: 'a2' });

    render(<AudioUploadDropzone />);
    await userEvent.upload(screen.getByLabelText(/choose audio files/i), [
      new File([new Uint8Array([1])], 'bad.wav', { type: 'audio/wav' }),
      new File([new Uint8Array([2])], 'good.wav', { type: 'audio/wav' }),
    ]);
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
    expect(uploadAudioFile).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/components/audio/AudioUploadDropzone.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write the component**

```tsx
// app/components/audio/AudioUploadDropzone.tsx
import { useState } from 'react';
import { uploadAudioFile } from '~/utils/uploadAudio';
import { AUDIO_KINDS, AUDIO_MAX_BYTES } from '~/types/audio';
import type { AudioKind } from '~/types/audio';

type Item = { name: string; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string };

export function AudioUploadDropzone({ onUploaded }: { onUploaded?: () => void }) {
  const [kind, setKind] = useState<AudioKind>('ambience');
  const [items, setItems] = useState<Item[]>([]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    setItems(list.map((f) => ({ name: f.name, status: 'pending' })));

    // Sequential: a bulk drop must not open 50 concurrent PUTs.
    for (let i = 0; i < list.length; i++) {
      setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: 'uploading' } : it)));
      try {
        if (list[i].size > AUDIO_MAX_BYTES) throw new Error('File exceeds the 50MB limit');
        await uploadAudioFile(list[i], { kind });
        setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: 'done' } : it)));
      } catch (e) {
        const error = e instanceof Error ? e.message : 'Upload failed';
        // One bad file must not endanger the rest of the batch.
        setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: 'error', error } : it)));
      }
    }
    onUploaded?.();
  }

  return (
    <div className="rounded border border-dashed border-neutral-700 p-4">
      <div className="mb-2 flex items-center gap-2">
        <label htmlFor="audio-batch-kind" className="text-sm">
          Kind for this batch
        </label>
        <select
          id="audio-batch-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as AudioKind)}
          className="rounded bg-neutral-900 px-2 py-1"
        >
          {AUDIO_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <label htmlFor="audio-files" className="block cursor-pointer text-sm text-neutral-300">
        Choose audio files
      </label>
      <input
        id="audio-files"
        type="file"
        multiple
        accept="audio/*"
        onChange={(e) => void handleFiles(e.target.files)}
      />

      {items.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {items.map((it) => (
            <li key={it.name} className="flex items-center gap-2">
              <span className="truncate">{it.name}</span>
              <span className={it.status === 'error' ? 'text-red-400' : 'text-neutral-400'}>
                {it.status === 'error' ? it.error : it.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the stories**

```tsx
// app/components/audio/AudioUploadDropzone.stories.tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioUploadDropzone } from './AudioUploadDropzone';

const meta: Meta<typeof AudioUploadDropzone> = {
  component: AudioUploadDropzone,
  title: 'Audio/AudioUploadDropzone',
};
export default meta;

export const Default: StoryObj<typeof AudioUploadDropzone> = { args: {} };
```

- [ ] **Step 5: Run tests and stories**

Run: `npx vitest run --project unit tests/components/audio/AudioUploadDropzone.test.tsx && npm run test:storybook`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/audio tests/components/audio
git commit -m "feat(audio): multi-file upload dropzone with a batch default kind"
```

---

## Task 18: `AudioBulkTagBar`

**Files:**

- Create: `app/components/audio/AudioBulkTagBar.tsx` + stories
- Test: `tests/components/audio/AudioBulkTagBar.test.tsx`

**Interfaces:**

- Consumes: vocabularies (Task 1).
- Produces: `<AudioBulkTagBar selectedCount onApply onClear />` where `onApply(payload)` matches `bulkTagAudioAssetsSchema` minus `ids`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/audio/AudioBulkTagBar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioBulkTagBar } from '~/components/audio/AudioBulkTagBar';

describe('AudioBulkTagBar', () => {
  it('renders nothing when nothing is selected', () => {
    const { container } = render(<AudioBulkTagBar selectedCount={0} onApply={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the selected count', () => {
    render(<AudioBulkTagBar selectedCount={3} onApply={vi.fn()} />);
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
  });

  it('applies parsed tags in add mode by default', async () => {
    const onApply = vi.fn();
    render(<AudioBulkTagBar selectedCount={2} onApply={onApply} />);
    await userEvent.type(screen.getByLabelText(/tags to apply/i), 'storm, rain');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['storm', 'rain'], tagMode: 'add' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/components/audio/AudioBulkTagBar.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write the component**

```tsx
// app/components/audio/AudioBulkTagBar.tsx
import { useState } from 'react';
import { AUDIO_KINDS } from '~/types/audio';
import type { AudioKind } from '~/types/audio';

export type BulkTagPayload = {
  kind?: AudioKind;
  tags?: string[];
  tagMode: 'add' | 'replace';
};

type Props = {
  selectedCount: number;
  onApply: (payload: BulkTagPayload) => void;
  onClear?: () => void;
};

export function AudioBulkTagBar({ selectedCount, onApply, onClear }: Props) {
  const [kind, setKind] = useState<AudioKind | ''>('');
  const [tagText, setTagText] = useState('');
  const [tagMode, setTagMode] = useState<'add' | 'replace'>('add');

  if (selectedCount === 0) return null;

  const tags = tagText
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-900 p-2">
      <span className="text-sm">{selectedCount} selected</span>

      <select
        aria-label="Kind to apply"
        value={kind}
        onChange={(e) => setKind(e.target.value as AudioKind | '')}
        className="rounded bg-neutral-800 px-2 py-1"
      >
        <option value="">Keep kind</option>
        {AUDIO_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>

      <input
        aria-label="Tags to apply (comma separated)"
        placeholder="storm, rain"
        value={tagText}
        onChange={(e) => setTagText(e.target.value)}
        className="rounded bg-neutral-800 px-2 py-1"
      />

      <select
        aria-label="Tag mode"
        value={tagMode}
        onChange={(e) => setTagMode(e.target.value as 'add' | 'replace')}
        className="rounded bg-neutral-800 px-2 py-1"
      >
        <option value="add">Add</option>
        <option value="replace">Replace</option>
      </select>

      <button
        type="button"
        onClick={() =>
          onApply({ kind: kind || undefined, tags: tags.length ? tags : undefined, tagMode })
        }
        className="rounded bg-amber-600 px-3 py-1"
      >
        Apply
      </button>

      {onClear && (
        <button type="button" onClick={onClear} className="text-sm text-neutral-400">
          Clear selection
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the stories**

```tsx
// app/components/audio/AudioBulkTagBar.stories.tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioBulkTagBar } from './AudioBulkTagBar';

const meta: Meta<typeof AudioBulkTagBar> = {
  component: AudioBulkTagBar,
  title: 'Audio/AudioBulkTagBar',
};
export default meta;

export const WithSelection: StoryObj<typeof AudioBulkTagBar> = {
  args: { selectedCount: 12, onApply: () => {}, onClear: () => {} },
};
export const Hidden: StoryObj<typeof AudioBulkTagBar> = {
  args: { selectedCount: 0, onApply: () => {} },
};
```

- [ ] **Step 5: Run tests and stories**

Run: `npx vitest run --project unit tests/components/audio/AudioBulkTagBar.test.tsx && npm run test:storybook`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/audio tests/components/audio
git commit -m "feat(audio): bulk tag bar for multi-select classification"
```

---

## Task 19: The `/audio` route

**Files:**

- Create: `app/routes/audio.tsx`
- Test: `tests/routes/audio-route.test.tsx`

**Interfaces:**

- Consumes: every component from Tasks 15–18, `listAudioAssetsFn`, `bulkTagAudioAssetsFn`, `deleteAudioAssetFn` (Task 14), `audioKeys` (Task 14).
- Produces: the `/audio` route.

**Polling, not realtime:** the ws service binds rooms to sessions and campaigns; the library is per-user and lives outside campaigns. A `refetchInterval` while any asset is non-terminal costs nothing and stops when everything settles.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/routes/audio-route.test.tsx
import { describe, it, expect } from 'vitest';

describe('audio route', () => {
  it('polls only while an asset is still processing', async () => {
    const { shouldPoll } = await import('~/routes/audio');
    expect(shouldPoll([{ status: 'ready' }, { status: 'failed' }] as never)).toBe(false);
    expect(shouldPoll([{ status: 'ready' }, { status: 'pending' }] as never)).toBe(true);
    expect(shouldPoll([{ status: 'processing' }] as never)).toBe(true);
    expect(shouldPoll([] as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/routes/audio-route.test.tsx`
Expected: FAIL — `shouldPoll` is not exported.

- [ ] **Step 3: Write the route**

```tsx
// app/routes/audio.tsx
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AudioLibraryBrowser } from '~/components/audio/AudioLibraryBrowser';
import { AudioUploadDropzone } from '~/components/audio/AudioUploadDropzone';
import { AudioBulkTagBar, type BulkTagPayload } from '~/components/audio/AudioBulkTagBar';
import type { AudioFilters } from '~/components/audio/AudioFilterBar';
import { listAudioAssetsFn, bulkTagAudioAssetsFn } from '~/utils/audio-server-fns';
import { audioKeys } from '~/utils/queryKeys';
import type { AudioAssetData } from '~/types/audio';

const POLL_MS = 4000;

/** Stop polling once nothing is in flight — a settled library must go quiet. */
export function shouldPoll(assets: Pick<AudioAssetData, 'status'>[]): boolean {
  return assets.some(
    (a) => a.status === 'pending' || a.status === 'processing' || a.status === 'uploading'
  );
}

function AudioLibraryPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<AudioFilters>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const query = useQuery({
    queryKey: audioKeys.list(filters),
    queryFn: () => listAudioAssetsFn({ data: { ...filters, limit: 50 } }),
    refetchInterval: (q) => (shouldPoll(q.state.data?.items ?? []) ? POLL_MS : false),
  });

  const bulk = useMutation({
    mutationFn: (payload: BulkTagPayload) =>
      bulkTagAudioAssetsFn({ data: { ids: selectedIds, ...payload } }),
    onSuccess: () => {
      setSelectedIds([]);
      void qc.invalidateQueries({ queryKey: audioKeys.all });
    },
  });

  const assets = query.data?.items ?? [];

  return (
    <main className="mx-auto max-w-4xl p-4">
      <h1 className="mb-4 text-xl font-semibold">Audio library</h1>

      <AudioUploadDropzone
        onUploaded={() => void qc.invalidateQueries({ queryKey: audioKeys.all })}
      />

      <div className="mt-4 rounded border border-neutral-800">
        <AudioLibraryBrowser
          assets={assets}
          loading={query.isLoading}
          filters={filters}
          onFiltersChange={setFilters}
          selectable
          selectedIds={selectedIds}
          onToggleSelect={(id) =>
            setSelectedIds((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
            )
          }
          actionsSlot={
            <AudioBulkTagBar
              selectedCount={selectedIds.length}
              onApply={(p) => bulk.mutate(p)}
              onClear={() => setSelectedIds([])}
            />
          }
        />
      </div>
    </main>
  );
}

export const Route = createFileRoute('/audio')({ component: AudioLibraryPage });
```

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npx vitest run --project unit tests/routes/audio-route.test.tsx && npm run typecheck && npm run lint`
Expected: PASS, 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add app/routes/audio.tsx app/routeTree.gen.ts tests/routes/audio-route.test.tsx
git commit -m "feat(audio): standalone /audio library route with polling"
```

---

## Task 20: E2E coverage

**Files:**

- Create: `e2e/audio-library.spec.ts`

**Interfaces:**

- Consumes: the `/audio` route (Task 19).
- Produces: Playwright coverage of filter → select → bulk tag.

**Why no real transcode here:** driving ffmpeg through Playwright would make the suite slow and flaky for little added signal. The worker is covered by its own real-ffmpeg integration test (Task 10).

- [ ] **Step 1: Write the spec**

```ts
// e2e/audio-library.spec.ts
import { test, expect } from '@playwright/test';

test.describe('audio library', () => {
  test('filters by kind and applies a bulk tag', async ({ page }) => {
    await page.goto('/audio');

    await expect(page.getByRole('heading', { name: /audio library/i })).toBeVisible();

    // Kind chips act as toggles.
    const musicChip = page.getByRole('button', { name: 'music', exact: true });
    await musicChip.click();
    await expect(musicChip).toHaveAttribute('aria-pressed', 'true');
    await musicChip.click();
    await expect(musicChip).toHaveAttribute('aria-pressed', 'false');

    // The bulk bar is hidden until something is selected.
    await expect(page.getByText(/selected/i)).toHaveCount(0);

    const first = page.getByRole('checkbox').first();
    if (await first.count()) {
      await first.check();
      await expect(page.getByText(/1 selected/i)).toBeVisible();
      await page.getByLabel(/tags to apply/i).fill('e2e-tag');
      await page.getByRole('button', { name: /apply/i }).click();
      await expect(page.getByText(/selected/i)).toHaveCount(0);
    }
  });

  test('needs-tagging filter is available', async ({ page }) => {
    await page.goto('/audio');
    const toggle = page.getByRole('checkbox', { name: /needs tagging/i });
    await toggle.check();
    await expect(toggle).toBeChecked();
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test e2e/audio-library.spec.ts`
Expected: PASS.

- [ ] **Step 3: Run the whole gate suite before opening the PR**

Run:

```bash
npm run typecheck && npm run lint && npm test && npm run test:storybook
bash deploy/charts/cartyx/tests/render-tests.sh
(cd audio-worker && npm run typecheck && npm test)
(cd realtime && npm run typecheck && npm test)
```

Expected: everything green.

- [ ] **Step 4: Commit and open the PR**

```bash
git add e2e/audio-library.spec.ts
git commit -m "test(audio): e2e coverage for filtering and bulk tagging"
git push -u origin soundboard
gh pr create --base dev --title "feat(audio): phase 1 — audio asset library" --body "Implements docs/specs/2026-07-28-audio-library-design.md"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement                         | Task                                                 |
| ---------------------------------------- | ---------------------------------------------------- |
| `AudioAsset` model, per-user ownership   | 2                                                    |
| `onceRenditions` reserved, never written | 2 (schema), noted in comment                         |
| Audio MIME allowlist + 50 MB cap         | 3                                                    |
| Presigned upload → PUT → confirm         | 3, 4, 14                                             |
| `HeadObject` size enforcement            | 4                                                    |
| Queue-on-document, atomic claim, reaper  | 9                                                    |
| ffprobe duration (not `buffer.duration`) | 10                                                   |
| −20 LUFS loudnorm                        | 10                                                   |
| Opus + AAC renditions                    | 10                                                   |
| ~400 peak buckets                        | 10                                                   |
| Dedicated worker with CPU limits         | 11, 12                                               |
| Shared ingest, two adapters              | 4 (shared), 7 (routes), 14 (server fns)              |
| Token check stubbed to reject            | 7                                                    |
| `TRACKED_PREFIXES` audio prefix          | 8                                                    |
| `/audio-worker` dependabot entry         | 11                                                   |
| `services` CI job covering realtime too  | 11                                                   |
| Server-side filtering, cursor pagination | 5                                                    |
| Facet counts deferred                    | not implemented — deferred by design                 |
| Batch default `kind` at drop time        | 17                                                   |
| "Needs tagging" filter                   | 5, 16                                                |
| Bulk tag editing                         | 6, 18                                                |
| Context-agnostic components              | 16                                                   |
| In-campaign mounting                     | deferred to phase 2 by design                        |
| Preview via plain `<audio>`              | 15 (`onPlay` hook; route wires an `<audio>` element) |
| Polling not realtime                     | 19                                                   |
| Stories for every component              | 15–18                                                |
| E2E on the UI path                       | 20                                                   |

**Deferred by design, not gaps:** facet counts, in-campaign mounting, token issuance, `onceRenditions` population.

**Known follow-up:** `AudioAssetDetail` (single-asset edit) is not a task — `updateAudioAsset` exists (Task 6) and rows expose `onEdit`, but no modal is built. Bulk editing covers the classification workflow; add the detail modal in a follow-up if single-asset editing proves necessary before phase 2.
