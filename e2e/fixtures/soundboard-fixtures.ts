/**
 * Shared identifiers for the soundboard (phase 2a) E2E fixtures, mirroring
 * `audio-fixtures.ts`: `globalSetup.ts` seeds one document per constant here
 * and `soundboard.spec.ts` selects on the same strings, so the two files
 * cannot drift.
 *
 * Why these particular rows exist:
 *
 * - **A system package** (`ownerId: null`). The shipped UI has NO "create
 *   package" affordance at all — `createPackageFn` exists but nothing calls
 *   it (see the Task 19 report). Cloning a system package is therefore the
 *   only path a user has to a package of their own, and it is what the spec's
 *   "create a package" step drives. It also exercises the `ownerId: null` half
 *   of `packageVisibilityFilter` against a real row.
 *
 * - **A foreign-owned package** (`ownerId` = a user that is not the E2E GM).
 *   Nothing else in the phase proves the *exclusion* half of
 *   `packageVisibilityFilter` against real data — the unit suite mocks
 *   mongoose, so a mock returns whatever it was told regardless of the filter
 *   the query actually carried.
 *
 * - **A foreign-owned audio asset, referenced by the system package's one
 *   item.** `listPackageAssets` (Task 21) is gated twice: the package must be
 *   visible, AND each asset must be owned by the caller or system-owned. A
 *   package referencing another user's private asset is explicitly allowed by
 *   the data model, so the second gate is the only thing keeping that asset
 *   out of the response. End to end, the proof is a pad that renders in the
 *   board's "Unavailable" group: the item is there, the asset is not.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const SOUNDBOARD_FIXTURES = {
  /**
   * `ownerId: null`. Cloneable by anyone, editable by no one. Its clone
   * inherits this name verbatim (`clonePackage` copies `name` when the caller
   * sends none, and `PackagesListPage` sends none), so the spec tells the two
   * apart by the `system-badge` testid, never by name.
   */
  systemPackageName: 'E2E System Package',
  /** Owned by `FOREIGN_OWNER_ID`. Must never appear in the E2E GM's package list. */
  foreignPackageName: 'E2E Foreign Package — must not be visible',
  /** The label on the system package's one item, whose asset the caller may not read. */
  foreignItemLabel: 'E2E Foreign Sound',
  /** Mood the spec creates first and leaves silent — the "switch away" half of the mood switch. */
  moodCalm: 'E2E Calm',
  /** Mood the spec creates second, with the ambience item playing. The one that must survive a reload. */
  moodStorm: 'E2E Storm',
} as const;

/**
 * A stable, obviously-fake ObjectId standing in for "some other user". Never
 * a real seeded user: the point is that no session in the suite can ever
 * resolve to it, so anything scoped to it is unreachable by construction.
 */
export const FOREIGN_OWNER_ID = 'e2e0e2e0e2e0e2e0e2e0e2e0';

/** Stable natural key for the foreign-owned asset, matching `seedAudioFixtures`' convention. */
export const FOREIGN_ASSET_SOURCE_KEY = 'e2e/fixtures/audio/foreign-owned.wav';

interface SoundboardSeedData {
  campaignId: string;
  soundboardSystemPackageId: string;
  soundboardForeignPackageId: string;
}

/** Same reader `tabletop-fixtures.ts` uses — globalSetup writes this file. */
export function readSoundboardSeed(): SoundboardSeedData {
  const path = join(process.cwd(), 'e2e', '.auth', 'seed-data.json');
  if (!existsSync(path)) {
    throw new Error(
      'e2e/.auth/seed-data.json missing — globalSetup did not run. Check playwright.config.ts.'
    );
  }
  const seed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<SoundboardSeedData>;
  if (!seed.soundboardSystemPackageId || !seed.soundboardForeignPackageId || !seed.campaignId) {
    throw new Error(
      'seed-data.json has no soundboard fixtures — globalSetup ran without seedSoundboardFixtures.'
    );
  }
  return seed as SoundboardSeedData;
}
