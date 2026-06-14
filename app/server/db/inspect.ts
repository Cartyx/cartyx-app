import type mongoose from 'mongoose';
import type { IndexSeverity } from './governance';
import { getSeverity, keySignature } from './governance';
import { Campaign } from './models/Campaign';
import { GMScreen } from './models/GMScreen';
import { Player } from './models/Player';
import { Session } from './models/Session';
import { Note } from './models/Note';
import { Race } from './models/Race';
import { User } from './models/User';
import { Map as MapModel } from './models/Map';
import { MapToken } from './models/MapToken';
import { Monster } from './models/Monster';

/** All Mongoose models the app declares. Order does not matter. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mongoose models have different document types
export const ALL_MODELS: mongoose.Model<any>[] = [
  User,
  Campaign,
  Player,
  Session,
  GMScreen,
  Note,
  Race,
  MapModel,
  MapToken,
  Monster,
];

/** Describes one expected-vs-actual index comparison for a single model. */
export interface IndexDiff {
  /** Mongoose model name (e.g. "User"). */
  model: string;
  /** MongoDB collection name (e.g. "users"). */
  collection: string;
  /** Indexes declared in the schema but missing from the database. */
  missing: IndexSpec[];
  /** Indexes present in the database but not in the schema (excluding _id). */
  extra: IndexSpec[];
  /** Indexes whose keys match but whose options differ (unique, sparse, etc.). */
  optionMismatches: OptionMismatch[];
}

export interface IndexSpec {
  key: Record<string, unknown>;
  options?: Record<string, unknown>;
  /** Governance severity — `undefined` if the index is not in the registry. */
  severity?: IndexSeverity;
}

export interface OptionMismatch {
  key: Record<string, unknown>;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  /** Governance severity — `undefined` if the index is not in the registry. */
  severity?: IndexSeverity;
}

export interface InspectResult {
  /** Per-model diff reports. */
  diffs: IndexDiff[];
  /** true when there is no drift: no missing, no extra, and no option mismatches. */
  ok: boolean;
  /** true when any critical-severity index is missing or has an option mismatch. */
  hasCriticalDrift: boolean;
}

/** Index options that affect query behaviour and are worth comparing. */
const COMPARABLE_OPTIONS = ['unique', 'sparse', 'expireAfterSeconds'] as const;

/**
 * Extract only the options we care about for drift comparison.
 * Mongoose schema options and MongoDB listIndexes output use different shapes,
 * so we normalise to a plain object with only the meaningful keys present.
 */
function normalizeOptions(opts: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of COMPARABLE_OPTIONS) {
    if (key in opts) result[key] = opts[key];
  }
  return result;
}

/** Shallow-compare two normalised option objects. */
function optionsMatch(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => a[k] === b[k]);
}

/**
 * Compare schema-declared indexes against actual indexes in the database
 * for every model in ALL_MODELS.
 *
 * Does NOT mutate the database — safe to call in CI, pre-deploy, or
 * production as a read-only health check.
 *
 * Each missing index and option mismatch is annotated with its governance
 * severity (`critical` or `optional`) from the governance registry.
 */
export async function inspectIndexes(): Promise<InspectResult> {
  const diffs: IndexDiff[] = [];

  for (const Model of ALL_MODELS) {
    const modelName = Model.modelName;
    const collectionName = Model.collection.collectionName;

    // Schema-declared indexes (compound + field-level).
    // schema.indexes() returns [keyPattern, options] tuples.
    const schemaIndexes: Array<[Record<string, unknown>, Record<string, unknown>]> =
      Model.schema.indexes() as Array<[Record<string, unknown>, Record<string, unknown>]>;

    // Actual indexes currently in MongoDB.
    let dbIndexes: Array<{ key: Record<string, unknown>; [k: string]: unknown }> = [];
    try {
      dbIndexes = await Model.listIndexes();
    } catch (err: unknown) {
      // MongoDB error code 26 (NamespaceNotFound) means the collection
      // doesn't exist yet — treat as zero indexes. Rethrow anything else.
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? (err as { code: unknown }).code
          : undefined;
      if (code !== 26) throw err;
    }

    // Build maps of key signatures for comparison.
    const schemaKeys = new Map<string, IndexSpec>();
    for (const [key, opts] of schemaIndexes) {
      const sig = keySignature(key);
      schemaKeys.set(sig, { key, options: opts });
    }

    const dbKeyMap = new Map<string, Record<string, unknown>>();
    for (const idx of dbIndexes) {
      // Skip the default _id index — it always exists.
      if (keySignature(idx.key) === '_id:1') continue;
      const { key, ...rest } = idx;
      dbKeyMap.set(keySignature(key), rest);
    }

    const missing: IndexSpec[] = [];
    const optionMismatches: OptionMismatch[] = [];

    for (const [sig, spec] of schemaKeys) {
      const severity = getSeverity(modelName, spec.key);
      if (!dbKeyMap.has(sig)) {
        missing.push({ ...spec, severity });
      } else {
        // Key exists — check whether meaningful options match.
        const expected = normalizeOptions(spec.options ?? {});
        const actual = normalizeOptions(dbKeyMap.get(sig)!);
        if (!optionsMatch(expected, actual)) {
          optionMismatches.push({ key: spec.key, expected, actual, severity });
        }
      }
    }

    const extra: IndexSpec[] = [];
    for (const sig of dbKeyMap.keys()) {
      if (!schemaKeys.has(sig)) {
        const dbIdx = dbIndexes.find((i) => keySignature(i.key) === sig);
        if (dbIdx) extra.push({ key: dbIdx.key });
      }
    }

    diffs.push({ model: modelName, collection: collectionName, missing, extra, optionMismatches });
  }

  const ok = diffs.every(
    (d) => d.missing.length === 0 && d.extra.length === 0 && d.optionMismatches.length === 0
  );

  const hasCriticalDrift = diffs.some(
    (d) =>
      d.missing.some((m) => m.severity === 'critical') ||
      d.optionMismatches.some((m) => m.severity === 'critical')
  );

  return { diffs, ok, hasCriticalDrift };
}

/**
 * Ensure all collections exist. Idempotent — safe to call on every startup
 * in any environment, including production.
 */
export async function ensureCollections(): Promise<void> {
  await Promise.all(ALL_MODELS.map((M) => M.createCollection()));
}

/**
 * Create any missing collections and sync (create) missing indexes.
 * This is the explicit, operator-controlled path used by `npm run db:sync`
 * and by non-production startup bootstrap. In production, operators should
 * run `npm run db:sync` instead.
 */
export async function syncCollectionsAndIndexes(): Promise<void> {
  await ensureCollections();
  await Promise.all(ALL_MODELS.map((M) => M.createIndexes()));
}
