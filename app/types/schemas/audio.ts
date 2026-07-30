import { z } from 'zod';
import { AUDIO_KINDS, AUDIO_ENVIRONMENTS, AUDIO_MOODS, AUDIO_MAX_BYTES } from '~/types/audio';

const kind = z.enum(AUDIO_KINDS);
const environment = z.array(z.enum(AUDIO_ENVIRONMENTS)).max(10).default([]);
const mood = z.array(z.enum(AUDIO_MOODS)).max(10).default([]);
const intensity = z.number().int().min(1).max(5).nullish();
const tags = z.array(z.string().min(1).max(40)).max(30).default([]);
/**
 * The same caps as `tags` above, minus the `.default([])` — a filter's absence
 * ("don't filter by tag") is not the same thing as an empty tag list, so this
 * one stays `undefined` when omitted. The caps themselves are NOT optional:
 * `listAudioAssets` feeds this array straight into `{ tags: { $all: [...] } }`,
 * so an uncapped field turns a ~1 MB request body into a `$all` carrying tens
 * of thousands of terms against a shared Atlas cluster.
 */
const tagFilter = z.array(z.string().min(1).max(40)).max(30);

/**
 * A 24-character hex Mongo ObjectId.
 *
 * Every id the audio functions accept is validated HERE, at the schema, rather
 * than inside the functions. Three reasons:
 *
 * - It is the one boundary both ingest adapters share (the browser server-fns
 *   in `~/utils/audio-server-fns.ts` and the phase-3 HTTP routes under
 *   `~/routes/api/audio/`), so the two can't drift.
 * - A malformed id never reaches Mongo, so it can't produce a `CastError`. That
 *   error escaped the server functions as an HTTP 500 *and* filed a GlitchTip
 *   event, for what is purely a client mistake — `"x"` as an id was a
 *   one-request way to manufacture an error report.
 * - A parse failure is a 400 with no telemetry, which is what a syntactically
 *   invalid id deserves. A *well-formed* id that matches nothing still reaches
 *   the function and still produces its "not found" error, unchanged.
 */
export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/**
 * `<createdAt epoch ms>_<ObjectId>` — the exact shape `encodeAudioCursor`
 * produces (see `~/server/functions/audio.ts`).
 *
 * The digit run is capped at 16 characters and then range-checked against
 * `MAX_TIMESTAMP_MS`, and BOTH steps matter. JS's maximum representable Date is
 * 8.64e15 ms; `Number.isFinite(1e20)` is `true` but `new Date(1e20)` is
 * `Invalid Date`, which Mongoose casts into a `CastError` — a guaranteed HTTP
 * 500 plus a GlitchTip event from a one-line request body. Validating the
 * number without validating the Date it builds is exactly the hole this closes.
 */
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;
const audioCursor = z
  .string()
  .regex(/^\d{1,16}_[0-9a-fA-F]{24}$/, 'Invalid cursor')
  .refine((c) => Number(c.slice(0, c.indexOf('_'))) <= MAX_TIMESTAMP_MS, 'Invalid cursor');

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
  assetId: objectId,
});

/**
 * Task 18: attach a `∞`/`1×` once-variant to an EXISTING `music` asset.
 * Deliberately mirrors `createAudioUploadSchema` minus the classification
 * fields (`kind`/`environment`/`mood`/`intensity`/`tags`/`title`) — those
 * describe the asset as a whole and the once-variant doesn't get its own
 * copy, only its own audio object.
 */
export const attachOnceVariantUploadSchema = z.object({
  assetId: objectId,
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  bytes: z.number().int().positive().max(AUDIO_MAX_BYTES),
});

export const confirmOnceVariantUploadSchema = z.object({
  assetId: objectId,
});

export const listAudioAssetsSchema = z.object({
  kind: kind.optional(),
  environment: z.array(z.enum(AUDIO_ENVIRONMENTS)).optional(),
  mood: z.array(z.enum(AUDIO_MOODS)).optional(),
  intensityMin: z.number().int().min(1).max(5).optional(),
  intensityMax: z.number().int().min(1).max(5).optional(),
  tags: tagFilter.optional(),
  search: z.string().max(200).optional(),
  needsTagging: z.boolean().optional(),
  cursor: audioCursor.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const updateAudioAssetSchema = z.object({
  id: objectId,
  title: z.string().min(1).max(200).optional(),
  kind: kind.optional(),
  environment: z.array(z.enum(AUDIO_ENVIRONMENTS)).optional(),
  mood: z.array(z.enum(AUDIO_MOODS)).optional(),
  intensity,
  tags: z.array(z.string().min(1).max(40)).max(30).optional(),
});

export const bulkTagAudioAssetsSchema = z.object({
  ids: z.array(objectId).min(1).max(200),
  kind: kind.optional(),
  environment: z.array(z.enum(AUDIO_ENVIRONMENTS)).optional(),
  mood: z.array(z.enum(AUDIO_MOODS)).optional(),
  intensity,
  tags: z.array(z.string().min(1).max(40)).max(30).optional(),
  tagMode: z.enum(['add', 'replace']).default('add'),
});

export const deleteAudioAssetSchema = z.object({ id: objectId });

export const retryAudioAssetSchema = z.object({ id: objectId });

// ---------------------------------------------------------------------------
// Owner-scoped audio orphan cleanup
// ---------------------------------------------------------------------------

/**
 * The scan takes no input at all: it is scoped entirely by the caller's own
 * identity, resolved server-side. There is deliberately nothing here for a
 * client to widen — no prefix, no campaign, no user id.
 */
export const scanOrphanAudioSchema = z.object({});

export const deleteOrphanAudioSchema = z.object({
  // Bounded because every key costs one R2 DeleteObject round trip. The scan
  // is bounded separately (see AUDIO_ORPHAN_SCAN_MAX_KEYS), so a scan that
  // finds more than this takes more than one delete pass — which the UI's
  // re-scan loop already handles.
  keys: z.array(z.string().min(1).max(1024)).min(1).max(500),
});

export interface OrphanAudioObject {
  key: string;
  sizeBytes: number;
  lastModified: string | null;
}

export interface ScanOrphanAudioResult {
  orphans: OrphanAudioObject[];
  /** How many stored objects in the caller's own namespace the scan inspected. */
  scannedObjectCount: number;
  /**
   * True when the caller's namespace holds more objects than one scan pass
   * covers, so the result is a PARTIAL view. Surfaced rather than swallowed:
   * the campaign image scanner's `MAX_PAGES` cap discarded `IsTruncated`
   * silently, which meant a large library quietly blinded the scan with no
   * signal at all.
   */
  truncated: boolean;
  /** True if R2 isn't configured for this environment (orphans is then empty). */
  r2Disabled: boolean;
}

export interface DeleteOrphanAudioResult {
  deleted: string[];
  failed: Array<{ key: string; error: string }>;
}
