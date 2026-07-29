/**
 * E2E: Audio asset library (`/audio`).
 *
 * There is no seeded audio data and the transcode worker does not run in
 * E2E, so nothing would ever reach `ready` on its own. `globalSetup.ts`
 * (see `seedAudioFixtures`) upserts five fixed `AudioAsset` documents owned
 * by the seeded GM user — `e2e/fixtures/audio-fixtures.ts` holds the titles
 * both files share. This gives every test in this file a genuine row to
 * assert against, instead of `if (await x.count())` guards that would pass
 * trivially against an empty library. Two fixtures (`editMe`, `deleteMe`)
 * are exclusively owned by the tests that mutate them; the rest are
 * read-only across tests so parallel execution can't race.
 *
 * NOT covered: the upload → presign → PUT → confirm → transcode pipeline
 * (Task 3/4/10's own tests cover ingest and the worker; driving real ffmpeg
 * through Playwright would be slow and flaky for little signal), and
 * playback of real audio (the seeded renditions point at fake URLs — this
 * suite verifies the player is *offered* only for `ready` rows and that
 * clicking Play mounts it, not that audio actually decodes).
 */
import { test, expect } from '@playwright/test';
import { AUDIO_FIXTURE_TITLES } from './fixtures/audio-fixtures';

test.describe('Audio library', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/audio');
    await expect(page.getByRole('heading', { name: /audio library/i })).toBeVisible();
    // The heading is server-rendered and appears before client hydration
    // finishes wiring up React's event handlers. Typing into a controlled
    // input (the search test) before hydration completes lands keystrokes
    // on a dead DOM node — no onChange fires, no request goes out, and the
    // test just times out waiting for a filter that was never applied.
    // Confirmed by instrumenting network traffic: without this wait, a
    // search test run showed zero `listAudioAssets` requests carrying a
    // `search` field, only the unfiltered poll. `networkidle` waits out the
    // client bundle's initial load/hydration.
    await page.waitForLoadState('networkidle');
  });

  test('loads for an authenticated GM past the beforeLoad guard', async ({ page }) => {
    // If `audioBeforeLoad` had rejected the session, we'd have been redirected to
    // `/` with `?reason=session_expired` instead of landing on `/audio`.
    await expect(page).toHaveURL(/\/audio$/);
    await expect(page.getByRole('group', { name: 'Audio file upload' })).toBeVisible();
    await expect(page.getByLabel('choose audio files')).toHaveCount(1);

    // Seeded rows are actually there — proves the route's query + list rendering work,
    // not just that the shell mounts.
    await expect(page.getByText(AUDIO_FIXTURE_TITLES.ambienceReady, { exact: true })).toBeVisible();
  });

  test('bulk tag bar stays hidden until a row is selected', async ({ page }) => {
    await expect(page.getByText(/\d+ selected/)).toHaveCount(0);
  });

  test('kind filter narrows the list to the selected kind', async ({ page }) => {
    const musicRow = page.getByText(AUDIO_FIXTURE_TITLES.musicUntagged, { exact: true });
    const ambienceRow = page.getByText(AUDIO_FIXTURE_TITLES.ambienceReady, { exact: true });

    await expect(musicRow).toBeVisible();
    await expect(ambienceRow).toBeVisible();

    const musicChip = page.getByRole('button', { name: 'music', exact: true });
    await musicChip.click();
    await expect(musicChip).toHaveAttribute('aria-pressed', 'true');

    await expect(musicRow).toBeVisible();
    await expect(ambienceRow).toHaveCount(0);

    // Toggling off restores the unfiltered list.
    await musicChip.click();
    await expect(musicChip).toHaveAttribute('aria-pressed', 'false');
    await expect(ambienceRow).toBeVisible();
  });

  test('search filters by title', async ({ page }) => {
    const searchBox = page.getByRole('searchbox', { name: 'Search by title' });
    // `.fill()` sets the value via a single native `input` event that this
    // `type="search"` element doesn't forward to React's onChange in
    // Chromium (confirmed by inspecting network traffic: `.fill()` never
    // produces a second `listAudioAssets` request, while character-by-
    // character typing does) — use `pressSequentially` so each keystroke
    // round-trips like a real user typing.
    await searchBox.pressSequentially('Ambience Ready', { delay: 10 });

    // Generous timeouts: each keystroke round-trips to the server (no
    // client-side debounce), so under a heavily parallel local run (this
    // spec's tests share one dev server process) the last request can take
    // longer than the default 5s to land.
    await expect(page.getByText(AUDIO_FIXTURE_TITLES.ambienceReady, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(AUDIO_FIXTURE_TITLES.musicUntagged, { exact: true })).toHaveCount(
      0,
      { timeout: 10_000 }
    );
  });

  test('needs-tagging filter narrows to ready, unclassified assets', async ({ page }) => {
    const toggle = page.getByRole('checkbox', { name: /needs tagging/i });
    await toggle.check();
    await expect(toggle).toBeChecked();

    // musicUntagged is ready with no tags/environment — must match.
    await expect(page.getByText(AUDIO_FIXTURE_TITLES.musicUntagged, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // ambienceReady is ready but already tagged/faceted — must NOT match.
    await expect(page.getByText(AUDIO_FIXTURE_TITLES.ambienceReady, { exact: true })).toHaveCount(
      0,
      { timeout: 10_000 }
    );
    // oneShotProcessing isn't ready at all — must NOT match regardless of tags.
    await expect(
      page.getByText(AUDIO_FIXTURE_TITLES.oneShotProcessing, { exact: true })
    ).toHaveCount(0, { timeout: 10_000 });
  });

  test('Play is offered only for a ready asset', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: `Play ${AUDIO_FIXTURE_TITLES.ambienceReady}` })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Play ${AUDIO_FIXTURE_TITLES.oneShotProcessing}` })
    ).toHaveCount(0);

    // The non-ready row still exposes Edit/Delete (reachable at every status).
    await expect(
      page.getByRole('button', { name: `Edit ${AUDIO_FIXTURE_TITLES.oneShotProcessing}` })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Delete ${AUDIO_FIXTURE_TITLES.oneShotProcessing}` })
    ).toBeVisible();

    await page.getByRole('button', { name: `Play ${AUDIO_FIXTURE_TITLES.ambienceReady}` }).click();
    await expect(
      page.getByText(`Now playing: ${AUDIO_FIXTURE_TITLES.ambienceReady}`)
    ).toBeVisible();
  });

  test('selecting a row and applying a bulk tag adds the tag and clears the selection', async ({
    page,
  }) => {
    const selectCheckbox = page.getByRole('checkbox', {
      name: `Select ${AUDIO_FIXTURE_TITLES.ambienceReady}`,
    });
    await selectCheckbox.check();
    await expect(page.getByText('1 selected')).toBeVisible();

    await page.getByRole('textbox', { name: /tags to apply/i }).fill('e2e-bulk-tag');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    // The bar disappears once the selection is cleared on success.
    await expect(page.getByText(/\d+ selected/)).toHaveCount(0);

    // The tag actually landed on the row (not just that the bar closed).
    const row = page.getByRole('listitem').filter({
      has: page.getByText(AUDIO_FIXTURE_TITLES.ambienceReady, { exact: true }),
    });
    await expect(row.getByText('#e2e-bulk-tag')).toBeVisible();
  });

  test('editing an asset updates its title in the list', async ({ page }) => {
    const editedTitle = `${AUDIO_FIXTURE_TITLES.editMe} (edited)`;

    await page.getByRole('button', { name: `Edit ${AUDIO_FIXTURE_TITLES.editMe}` }).click();

    const dialog = page.getByRole('dialog', { name: /edit audio asset/i });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Title', { exact: true }).fill(editedTitle);
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(editedTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(AUDIO_FIXTURE_TITLES.editMe, { exact: true })).toHaveCount(0);
  });

  test('deleting an asset removes it after confirmation', async ({ page }) => {
    const row = page.getByText(AUDIO_FIXTURE_TITLES.deleteMe, { exact: true });
    await expect(row).toBeVisible();

    await page.getByRole('button', { name: `Delete ${AUDIO_FIXTURE_TITLES.deleteMe}` }).click();

    const confirmDialog = page.getByRole('alertdialog', { name: 'Delete audio asset' });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(confirmDialog).toBeHidden({ timeout: 10_000 });
    await expect(row).toHaveCount(0, { timeout: 10_000 });
  });
});
