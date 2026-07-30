/**
 * E2E: sound packages (`/audio/packages`) and the in-campaign GM board
 * (`/campaigns/$campaignId/soundboard`).
 *
 * WHY THIS FILE MATTERS MORE THAN A NORMAL SPEC. `CLAUDE.md` states it
 * outright: the unit suite mocks mongoose, so a mock returns whatever it was
 * told regardless of what the query actually asked for. Identity-resolution
 * and query-shape bugs are invisible to it — phase 1's `ownerId` bug was green
 * across the entire unit suite and was caught only by an E2E hitting a real
 * seeded row. Three things in phase 2a are otherwise proven only against
 * mocks, and all three are exercised here against real documents:
 *
 * 1. `packageVisibilityFilter` — both halves. A system package (`ownerId:
 *    null`) IS visible and cloneable; another user's package is NOT visible in
 *    the list and NOT readable by id.
 * 2. `listPackageAssets`' second gate — a package may reference another user's
 *    private asset, and that asset must not come back. Visible end to end as a
 *    pad in the board's "Unavailable" group.
 * 3. `SoundboardState` — the whole collection is write-only and unverified
 *    without the reload step below. Task 17 implements hydration and nothing
 *    else in the phase exercises it end to end.
 *
 * Every assertion runs against fixtures `globalSetup.ts` actually seeds (see
 * `seedSoundboardFixtures`). There are deliberately NO `if (await x.count())`
 * guards: with no seed data that condition is always false and the spec would
 * report coverage it does not have.
 *
 * NOT covered, and why:
 *
 * - **Sound.** `enableAudio()` resumes an `AudioContext`; headless Chromium
 *   has no output device to assert on, and the seeded renditions point at
 *   `https://cdn.example.com/...`, which does not resolve. Every assertion
 *   here is on state the UI reports — a pad's `aria-pressed`, the active mood,
 *   the playing count, the persisted board — never on audio output.
 * - **The pads going "unavailable" once audio is enabled.** That is the
 *   expected consequence of the fake rendition URLs: the engine reports a load
 *   failure and `BoardPad` disables its own transport. The board's STATE is
 *   unaffected (`playing` stays true, the count stays right), which is the
 *   design's governing rule — the engine owns sound, the server is a mirror —
 *   and is what this spec asserts. Every slider the spec drives is therefore
 *   driven BEFORE the gesture or from `MasterBar`, which is never disabled.
 */
import { test, expect, type Locator, type Page, type Response } from '@playwright/test';
import { AUDIO_FIXTURE_TITLES } from './fixtures/audio-fixtures';
import { SOUNDBOARD_FIXTURES, readSoundboardSeed } from './fixtures/soundboard-fixtures';

/** The asset the spec adds to its package. `ready`, so the board can resolve it. */
const AMBIENCE = AUDIO_FIXTURE_TITLES.ambienceReady;

/**
 * Values the reload assertion compares against. Both differ from what a fresh
 * board produces (`initialBoardState`: `moodId: null`, `masterVolume:
 * DEFAULT_VOLUME` = 1 → "100%"), so "the board hydrated" cannot be confused
 * with "a default happened to match".
 */
const MASTER_VOLUME = 0.4;
const MASTER_VOLUME_LABEL = '40%';

/** How long the board's writes must be quiet before we call them settled. `SAVE_SETTLE_MS` is 800. */
const SAVE_QUIET_MS = 1_500;

/**
 * Sets an `<input type="range">` with real key events.
 *
 * NOT `fill()`. Playwright sets `range`/`color`/`date` inputs by assigning
 * `.value` and dispatching `input` — which React's value tracker has already
 * recorded by the time the event fires, so `onChange` never runs and the
 * control silently does not move. (`audio-library.spec.ts` hit the same class
 * of problem with `type="search"` and switched to `pressSequentially`.) `Home`
 * takes the slider to its minimum and each `ArrowRight` advances one `step`,
 * which is 0.01 across every 0–1 slider in the soundboard UI.
 */
async function setSlider(slider: Locator, value: number): Promise<void> {
  await slider.focus();
  await slider.press('Home');
  for (let i = 0; i < Math.round(value * 100); i += 1) await slider.press('ArrowRight');
}

/**
 * Whether a response is a `saveBoardStateFn` round trip.
 *
 * The naive `url().includes('saveBoardState')` does NOT work: TanStack Start's
 * dev server addresses server functions as `/_serverFn/<base64url of
 * {"file":…,"export":"saveBoardStateFn_createServerFn_handler"}>`, so the
 * function's name never appears literally in the URL. Verified by logging
 * every POST during a run. Both forms are accepted here — the plain one
 * because the built server uses readable ids, and a spec that only worked
 * against the dev server would rot the moment `E2E_BASE_URL` points at the
 * containerized stack.
 */
function isBoardSave(res: Response): boolean {
  const url = res.url();
  if (!url.includes('/_serverFn/')) return false;
  if (url.includes('saveBoardState')) return true;
  const id = decodeURIComponent(url.split('/_serverFn/')[1]?.split('?')[0] ?? '');
  try {
    return Buffer.from(id, 'base64url').toString('utf8').includes('saveBoardState');
  } catch {
    return false;
  }
}

/**
 * Tracks `saveBoardState` round trips so the spec can reload at a moment when
 * the server has actually caught up, rather than after a hopeful sleep.
 *
 * Install BEFORE the first board interaction — a listener attached afterwards
 * misses the write the package pick itself arms. "Settled" means a NEW write
 * has landed since the previous `settle()` and none has landed for
 * `SAVE_QUIET_MS`, which is longer than the hook's own `SAVE_SETTLE_MS`
 * debounce, so a coalesced burst of slider moves cannot be mistaken for the
 * end of the burst.
 *
 * The `seen` watermark is what makes the SECOND `settle()` mean anything. A
 * plain "at least one write, then quiet" check returns immediately the second
 * time — the earlier writes still satisfy it and `lastAt` is already old — so
 * the spec would reload before Stop All had persisted and assert against the
 * pre-Stop-All row, passing whether or not the write ever happened.
 */
function trackBoardSaves(page: Page) {
  let lastAt = 0;
  let count = 0;
  let seen = 0;
  const onResponse = (res: Response) => {
    if (isBoardSave(res)) {
      lastAt = Date.now();
      count += 1;
    }
  };
  page.on('response', onResponse);
  return {
    async settle(): Promise<void> {
      await expect
        .poll(() => (count > seen && Date.now() - lastAt > SAVE_QUIET_MS ? 'settled' : 'pending'), {
          timeout: 30_000,
          intervals: [250],
          message: 'the board never persisted a saveBoardState write',
        })
        .toBe('settled');
      seen = count;
    },
    dispose(): void {
      page.off('response', onResponse);
    },
  };
}

test.describe('Sound packages and the GM board', () => {
  test('does not leak another user’s package — not in the list, not by id', async ({ page }) => {
    // Read lazily, not at module scope: `playwright test --list` loads this
    // file without running globalSetup, and seed-data.json would not exist.
    const seed = readSoundboardSeed();

    await page.goto('/audio/packages');
    await expect(page.getByRole('heading', { name: 'SOUND PACKAGES' })).toBeVisible();
    await page.waitForLoadState('networkidle');

    // The seeded system package IS there — so an empty/failed list cannot make
    // the negative assertion below pass vacuously.
    await expect(
      page
        .getByTestId('package-row')
        .filter({ hasText: SOUNDBOARD_FIXTURES.systemPackageName })
        .first()
    ).toBeVisible();

    // …and the foreign-owned one is not, though it sits in the same collection.
    await expect(page.getByText(SOUNDBOARD_FIXTURES.foreignPackageName)).toHaveCount(0);

    // Nor is it reachable by id. This is the assertion a mongoose mock cannot
    // make: `getPackage` filters on `{ _id, $or: [{ownerId: userId}, {ownerId: null}] }`
    // and only a real query against a real row can prove the `$or` was applied.
    await page.goto(`/audio/packages/${seed.soundboardForeignPackageId}`);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(/not found|failed to load/i);
    // The editor itself never renders — no item list, no save affordance.
    await expect(page.getByText(/^Items \(/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
  });

  test('create a package, add an asset, define two moods, run the board, and survive a reload', async ({
    page,
  }) => {
    // One long journey on purpose — every step depends on the one before it,
    // and splitting it would mean either re-driving the whole package build in
    // each test or sharing mutable state between parallel workers. It needs
    // more than the 30 s default: three page loads, two debounce settles and
    // two reloads.
    test.setTimeout(150_000);

    const seed = readSoundboardSeed();
    const boardUrl = `/campaigns/${seed.campaignId}/soundboard`;

    // ---------------------------------------------------------------- create
    // "Create" is a CLONE, because the shipped UI has no create affordance at
    // all — `createPackageFn` exists and nothing calls it. Cloning the system
    // package is the only path a real user has to a package of their own, and
    // it doubles as the `ownerId: null` half of the visibility rule.
    await page.goto('/audio/packages');
    await expect(page.getByRole('heading', { name: 'SOUND PACKAGES' })).toBeVisible();
    await page.waitForLoadState('networkidle');

    const rows = page.getByTestId('package-row');
    const named = rows.filter({ hasText: SOUNDBOARD_FIXTURES.systemPackageName });
    const systemRow = named.filter({ has: page.getByTestId('system-badge') });
    // The clone inherits the source's name verbatim, so the ONLY thing telling
    // the two rows apart is the badge.
    const cloneRow = named.filter({ hasNot: page.getByTestId('system-badge') });

    await expect(systemRow).toHaveCount(1);
    await expect(cloneRow).toHaveCount(0);

    await systemRow
      .getByRole('button', { name: `${SOUNDBOARD_FIXTURES.systemPackageName} actions` })
      .click();
    await systemRow.getByTestId('overflow-item-clone').click();

    await expect(cloneRow).toHaveCount(1);
    const packageId = await cloneRow.getAttribute('data-package-id');
    expect(packageId).toBeTruthy();
    // The clone copied the system package's single item byte-for-byte.
    await expect(cloneRow).toContainText('1 item');

    // ------------------------------------------------------------ add an asset
    await cloneRow
      .getByRole('button', { name: `${SOUNDBOARD_FIXTURES.systemPackageName} actions` })
      .click();
    await cloneRow.getByTestId('overflow-item-edit').click();
    await expect(page).toHaveURL(new RegExp(`/audio/packages/${packageId}$`));
    await expect(
      page.getByRole('heading', { name: SOUNDBOARD_FIXTURES.systemPackageName.toUpperCase() })
    ).toBeVisible();
    await page.waitForLoadState('networkidle');

    // The inherited item is here, and it is editable — the clone is the
    // caller's own package, not the immutable system one.
    await expect(page.getByText('Items (1/64)')).toBeVisible();
    await expect(page.getByTestId('package-item-row')).toHaveCount(1);

    await page.getByRole('checkbox', { name: `Select ${AMBIENCE}` }).check();
    await page.getByRole('button', { name: 'Add to package' }).click();
    await expect(page.getByText('Items (2/64)')).toBeVisible();
    await expect(page.getByTestId('package-item-row')).toHaveCount(2);

    // ------------------------------------------------------------- two moods
    // Mood one: nothing playing. It is what the board switches AWAY from, so a
    // mood switch has an observable before as well as an after.
    await page.getByRole('button', { name: '+ Add mood' }).click();
    await page.getByLabel('Mood name').fill(SOUNDBOARD_FIXTURES.moodCalm);
    await expect(
      page.getByRole('button', { name: `Select mood ${SOUNDBOARD_FIXTURES.moodCalm}` })
    ).toHaveAttribute('aria-pressed', 'true');

    // Mood two: the ambience item playing. Adding a mood selects it, so the
    // name field and the state rows below now belong to this one.
    await page.getByRole('button', { name: '+ Add mood' }).click();
    await page.getByLabel('Mood name').fill(SOUNDBOARD_FIXTURES.moodStorm);
    await page.getByRole('checkbox', { name: `Playing ${AMBIENCE} in this mood` }).check();
    await expect(page.getByText('Moods (2/32)')).toBeVisible();

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 15_000 });

    // A reload of the EDITOR proves the moods reached Mongo rather than merely
    // the local draft — the editor keeps `items`/`moods` in component state.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Moods (2/32)')).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Select mood ${SOUNDBOARD_FIXTURES.moodStorm}` })
    ).toBeVisible();

    // ------------------------------------------------------------- the board
    const saves = trackBoardSaves(page);
    try {
      await page.goto(boardUrl);
      await expect(page.getByRole('heading', { name: 'SOUNDBOARD' })).toBeVisible();
      await expect(page.getByTestId('master-bar')).toBeVisible({ timeout: 15_000 });

      await page.locator('#package-pick').selectOption(packageId as string);
      await expect(page.getByTestId('mood-bar')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('board-pad')).toHaveCount(2);

      // Task 21's second gate, end to end. The package references an asset
      // owned by somebody else; `listPackageAssets` refused to return it, so
      // the item has no asset to resolve and lands in its own group rather
      // than vanishing from the board.
      const unresolved = page.getByTestId('board-group-unresolved');
      await expect(unresolved).toBeVisible();
      await expect(unresolved).toContainText(SOUNDBOARD_FIXTURES.foreignItemLabel);
      await expect(unresolved.getByTestId('pad-unavailable-reason')).toContainText(
        /removed from your library/i
      );
      // The asset the caller DOES own resolved, in the same response.
      await expect(page.getByTestId('board-group-ambience')).toContainText(AMBIENCE);

      // ------------------------------------------------------------ enable audio
      const enableBanner = page.getByTestId('enable-audio');
      await expect(enableBanner).toBeVisible();
      const enableButton = page.getByRole('button', { name: 'Enable audio' });
      await expect(enableButton).toBeEnabled({ timeout: 15_000 });
      await enableButton.click();
      await expect(enableBanner).toHaveCount(0);
      await expect(page.getByTestId('audio-error')).toHaveCount(0);

      // ------------------------------------------------------------- switch mood
      const calm = page.getByRole('button', {
        name: `Set mood to ${SOUNDBOARD_FIXTURES.moodCalm}`,
      });
      const storm = page.getByRole('button', {
        name: `Set mood to ${SOUNDBOARD_FIXTURES.moodStorm}`,
      });

      await calm.click();
      await expect(calm).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('playing-count')).toHaveText('Nothing playing');

      await storm.click();
      await expect(storm).toHaveAttribute('aria-pressed', 'true');
      await expect(calm).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByRole('button', { name: `Stop ${AMBIENCE}` })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(page.getByTestId('playing-count')).toHaveText('1 playing');

      // A second distinguishable number to hydrate, and one whose control is
      // never disabled by a failed rendition load.
      await setSlider(page.getByRole('slider', { name: 'Master volume' }), MASTER_VOLUME);
      await expect(page.getByTestId('master-bar')).toContainText(MASTER_VOLUME_LABEL);

      // ----------------------------------------------------------- the reload
      await saves.settle();
      await page.reload();
      await expect(page.getByTestId('master-bar')).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState('networkidle');

      // Everything below is the persisted board coming back. None of it is a
      // default: a board that failed to hydrate shows no package, no mood,
      // nothing playing and 100% master.
      await expect(page.locator('#package-pick')).toHaveValue(packageId as string);
      await expect(
        page.getByRole('button', { name: `Set mood to ${SOUNDBOARD_FIXTURES.moodStorm}` })
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(
        page.getByRole('button', { name: `Set mood to ${SOUNDBOARD_FIXTURES.moodCalm}` })
      ).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('master-bar')).toContainText(MASTER_VOLUME_LABEL);
      await expect(page.getByRole('button', { name: `Stop ${AMBIENCE}` })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(page.getByTestId('playing-count')).toHaveText('1 playing');
      // Audio is off again, which is correct rather than lost state: a fresh
      // document needs a fresh gesture before any browser will make sound.
      await expect(page.getByTestId('enable-audio')).toBeVisible();

      // -------------------------------------------------------------- stop all
      await page.getByRole('button', { name: 'Stop all' }).click();
      await expect(page.getByTestId('playing-count')).toHaveText('Nothing playing');
      await expect(page.getByRole('button', { name: `Play ${AMBIENCE}` })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
      // Stop All silences without unloading: the package and the mood stay.
      await expect(
        page.getByRole('button', { name: `Set mood to ${SOUNDBOARD_FIXTURES.moodStorm}` })
      ).toHaveAttribute('aria-pressed', 'true');

      // And it persists — the same write path, in the other direction.
      await saves.settle();
      await page.reload();
      await expect(page.getByTestId('master-bar')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('playing-count')).toHaveText('Nothing playing');
      await expect(page.getByTestId('master-bar')).toContainText(MASTER_VOLUME_LABEL);
    } finally {
      saves.dispose();
    }
  });
});
