/**
 * Index governance — classifies every schema-declared index by operational
 * importance so that verification can distinguish hard failures (critical)
 * from advisory warnings (optional).
 *
 * ## Classification guidelines
 *
 * **critical** — the index enforces a correctness constraint (uniqueness,
 * TTL expiry) or is required for authentication / authorization lookups.
 * Missing a critical index can cause data corruption, duplicate records,
 * or broken auth flows. Verification exits non-zero when critical drift
 * is detected.
 *
 * **optional** — the index exists for query performance. Missing it
 * degrades response times but does not break correctness. Verification
 * surfaces optional drift as a warning.
 *
 * ## Adding a new index
 *
 * 1. Declare the index in the relevant Mongoose schema file
 *    (e.g. `app/server/db/models/MyModel.ts`).
 * 2. Add an entry to `INDEX_GOVERNANCE` below with the same key pattern
 *    and the appropriate severity.
 * 3. Run `npm run db:verify` locally to confirm the registry matches
 *    the schema — any unclassified index will be flagged.
 * 4. Run `npm run db:sync` in non-production to create the index.
 */

/** Severity level for an index declaration. */
export type IndexSeverity = 'critical' | 'optional';

export interface GovernanceEntry {
  /** Index key pattern — must match the schema declaration exactly. */
  key: Record<string, unknown>;
  /** Operational importance classification. */
  severity: IndexSeverity;
}

/**
 * Central registry mapping each model's indexes to a severity level.
 *
 * The key pattern in each entry must match the first element of the
 * corresponding `schema.index(key, options)` or field-level index
 * declaration. `inspectIndexes()` uses this to annotate drift results.
 */
export const INDEX_GOVERNANCE: Record<string, GovernanceEntry[]> = {
  User: [
    { key: { email: 1 }, severity: 'critical' },
    { key: { role: 1 }, severity: 'optional' },
    { key: { providerId: 1 }, severity: 'critical' },
  ],
  Campaign: [
    { key: { 'members.userId': 1 }, severity: 'optional' },
    { key: { inviteCode: 1 }, severity: 'critical' },
  ],
  Session: [
    { key: { campaignId: 1, number: -1 }, severity: 'optional' },
    { key: { campaignId: 1, startDate: -1 }, severity: 'optional' },
  ],
  Player: [
    { key: { campaignId: 1 }, severity: 'optional' },
    { key: { campaignId: 1, updatedAt: -1 }, severity: 'optional' },
    { key: { createdBy: 1 }, severity: 'optional' },
    { key: { 'status.value': 1 }, severity: 'optional' },
    { key: { _fts: 'text', _ftsx: 1 }, severity: 'optional' },
  ],
  GMScreen: [
    { key: { campaignId: 1, tabOrder: 1 }, severity: 'critical' },
    { key: { campaignId: 1, name: 1 }, severity: 'critical' },
  ],
  Character: [
    { key: { campaignId: 1 }, severity: 'optional' },
    { key: { campaignId: 1, updatedAt: -1 }, severity: 'optional' },
    { key: { sessionId: 1 }, severity: 'optional' },
    { key: { sessions: 1 }, severity: 'optional' },
    { key: { createdBy: 1 }, severity: 'optional' },
    { key: { tags: 1 }, severity: 'optional' },
    { key: { isPublic: 1 }, severity: 'optional' },
    { key: { _fts: 'text', _ftsx: 1 }, severity: 'optional' },
  ],
  Note: [
    { key: { sessionId: 1 }, severity: 'optional' },
    { key: { campaignId: 1 }, severity: 'optional' },
    { key: { campaignId: 1, updatedAt: -1 }, severity: 'optional' },
    { key: { createdBy: 1 }, severity: 'optional' },
    { key: { tags: 1 }, severity: 'optional' },
    { key: { isPublic: 1 }, severity: 'optional' },
    { key: { _fts: 'text', _ftsx: 1 }, severity: 'optional' },
  ],
  Map: [
    { key: { campaignId: 1, updatedAt: -1 }, severity: 'optional' },
    { key: { campaignId: 1, locationId: 1 }, severity: 'optional' },
    { key: { campaignId: 1, name: 1 }, severity: 'critical' },
  ],
};

/**
 * Normalise a text index key to the canonical form that MongoDB reports
 * via `listIndexes()`. Schema declarations use field names (e.g.
 * `{ title: 'text', note: 'text' }`) while MongoDB stores the internal
 * representation `{ _fts: 'text', _ftsx: 1 }`. This helper collapses
 * both forms to the canonical DB shape so comparisons are stable.
 */
export function normalizeIndexKey(key: Record<string, unknown>): Record<string, unknown> {
  const hasText = Object.values(key).some((v) => v === 'text');
  if (!hasText) return key;
  // Preserve non-text prefix fields (e.g. campaignId in a compound text index)
  // and collapse text fields to MongoDB's canonical { _fts: 'text', _ftsx: 1 }.
  const prefix: Record<string, unknown> = {};
  for (const [field, dir] of Object.entries(key)) {
    if (dir !== 'text' && field !== '_fts' && field !== '_ftsx') {
      prefix[field] = dir;
    }
  }
  return { ...prefix, _fts: 'text', _ftsx: 1 };
}

/**
 * Normalise an index key to a stable string for governance lookup.
 * Text indexes are first collapsed to the canonical MongoDB form so that
 * schema-declared keys and DB-reported keys produce identical signatures.
 */
export function keySignature(key: Record<string, unknown>): string {
  const normalized = normalizeIndexKey(key);
  return Object.entries(normalized)
    .map(([field, dir]) => `${field}:${typeof dir === 'string' ? dir : Number(dir)}`)
    .join(',');
}

/**
 * Look up the governance severity for a given model + index key.
 * Returns `undefined` if the index is not registered in the governance
 * registry (which itself is a reportable condition — unclassified indexes).
 */
export function getSeverity(
  modelName: string,
  key: Record<string, unknown>
): IndexSeverity | undefined {
  const entries = INDEX_GOVERNANCE[modelName];
  if (!entries) return undefined;
  const sig = keySignature(key);
  const entry = entries.find((e) => keySignature(e.key) === sig);
  return entry?.severity;
}
