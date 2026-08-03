/**
 * E2E: the audio storage quota (phase 1.5, Task 12).
 *
 * `globalSetup.ts` (`seedStorageQuotaFixtures`) upserts three real
 * `AudioAsset` rows owned by the seeded GM whose byte fields sum past
 * `AUDIO_USER_QUOTA_BYTES`, so the user this suite signs in as is genuinely
 * over quota before the first line below runs. Nothing here is guarded behind
 * `if (await x.count())`: with no seed those conditions are always false and
 * the spec would report coverage it does not have. Remove the seed and these
 * tests fail — that was verified, not assumed.
 *
 * WHY THE REFUSAL ASSERTION IS ALSO AN ASSERTION ABOUT WHERE THE CHECK LIVES.
 * This suite runs against deliberately fake R2 credentials (see `ci.yml`'s e2e
 * job). Anything that reaches the presigned PUT therefore fails — but it fails
 * as a transport error at `uploadAudioFile`'s `fetch` ("R2 upload failed: …",
 * or a `TypeError` from an unresolvable host), not as a quota refusal. The
 * three assertions below distinguish those two outcomes on purpose:
 *
 *  1. the message is the quota refusal `assertUnderStorageQuota`
 *     (`app/server/functions/audio.ts`) raises, byte figures and all;
 *  2. the browser issues NO `PUT` at all — the presigned upload is the only
 *     `PUT` this page can make, so its absence means no upload URL was ever
 *     handed back;
 *  3. no `uploading` row appears in the library for the refused file —
 *     `createAudioUpload` creates that row AFTER `resolveAudioStoragePrefix`
 *     and `getAudioUploadUrl`, so a row here would mean the quota check ran
 *     too late even if the request still ended in a refusal.
 *
 * Together those pin the ordering Task 4 was built for: the quota check
 * precedes the storage-prefix resolution, the presign, and the row insert.
 *
 * NOT covered here: the once-variant upload path (`createOnceVariantUpload`
 * runs the identical `assertUnderStorageQuota` call — same helper, same
 * placement before the presign — and driving it needs a `ready` `music` asset
 * plus the edit modal, for a second copy of the assertion above), and the
 * rate limiters and pending-job cap (Tasks 1/2/6), whose refusals are
 * time-and-queue-shaped rather than state-shaped and would need either a
 * hundred-request loop or a running worker to reach honestly.
 */
import { test, expect } from '@playwright/test';
import { formatBytes } from '../app/utils/format-bytes';
import { AUDIO_QUOTA_FIXTURE } from './fixtures/audio-fixtures';

/** The exact refusal `assertUnderStorageQuota` throws, with both figures captured. */
const QUOTA_REFUSAL = /Storage quota exceeded: (\d+) of (\d+) bytes used/;

/** What `seedStorageQuotaFixtures` puts in Mongo, summed the way the server should. */
const SEEDED_FILLER_BYTES =
  AUDIO_QUOTA_FIXTURE.count *
  Object.values(AUDIO_QUOTA_FIXTURE.bytes).reduce((sum, n) => sum + n, 0);

/** Uploaded by the refusal test. Never lands anywhere — the upload is refused before it can. */
const REFUSED_FILE = {
  name: 'e2e-quota-refusal.wav',
  mimeType: 'audio/wav',
  // A 44-byte RIFF/WAVE header. Content is irrelevant (nothing reads it), but
  // the size must be > 0: `createAudioUploadSchema` requires a positive
  // `bytes`, and a zero-length file would be refused by validation rather than
  // by the quota — the exact "passes for the wrong reason" shape this spec
  // must avoid.
  buffer: Buffer.alloc(44),
};

/**
 * `titleFromFilename` (`app/server/functions/audio.ts`) strips the extension,
 * so this is the row that must NOT appear. Addressed through its select
 * checkbox's `aria-label` rather than by text: a text locator that silently
 * stopped matching would make the assertion vacuous, and this exact accessible
 * name was observed in the library during the seed-removal run — i.e. it is
 * known to resolve when the row IS created, which is what makes its absence
 * mean something.
 */
const REFUSED_ROW_CHECKBOX = 'Select e2e-quota-refusal';

test.describe('Audio storage quota', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/audio');
    await expect(page.getByRole('heading', { name: /audio library/i })).toBeVisible();
    // Same reason as `audio-library.spec.ts`'s wait: the heading is
    // server-rendered, and the file input's onChange is dead until React has
    // hydrated. Selecting a file before then produces no request at all.
    await page.waitForLoadState('networkidle');
  });

  test('the quota bar reports the over-limit state before any upload is attempted', async ({
    page,
  }) => {
    const bar = page.getByRole('progressbar', { name: 'Storage used' });
    await expect(bar).toBeVisible();

    // Capped at 100 by AudioQuotaBar — the point is that it is not the
    // "healthy" reading a user would otherwise be surprised by a refusal from.
    await expect(bar).toHaveAttribute('aria-valuenow', '100');
    await expect(
      page.getByText(
        'Storage limit reached. New uploads will be refused until you delete an asset.'
      )
    ).toBeVisible();
  });

  test('an over-quota upload is refused before any R2 request, and the bar agrees with the refusal', async ({
    page,
  }) => {
    // The presigned upload is the only PUT `/audio` can issue (server fns are
    // POST/GET). Recording every PUT and asserting none happened is what
    // separates "refused before the presign" from "presigned, then died on
    // fake credentials".
    const putRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PUT') putRequests.push(req.url());
    });

    await page.locator('#audio-files').setInputFiles(REFUSED_FILE);

    const dropzone = page.getByTestId('audio-upload-dropzone');
    const refusal = dropzone.getByText(QUOTA_REFUSAL);
    // Generous: a server-fn round trip plus the usage aggregation, on a dev
    // server that may still be compiling the route chunk on a cold first run.
    await expect(refusal).toBeVisible({ timeout: 20_000 });

    expect(putRequests).toEqual([]);

    // The refused file never became a row. See this file's header for why that
    // is an ordering assertion, not a duplicate of the one above.
    await expect(page.getByRole('checkbox', { name: REFUSED_ROW_CHECKBOX })).toHaveCount(0);

    // --- the indicator reflects the same reality the refusal was decided on ---
    const message = (await refusal.textContent()) ?? '';
    const match = QUOTA_REFUSAL.exec(message);
    expect(match, `refusal message did not carry both figures: ${message}`).not.toBeNull();
    const usageBytes = Number(match![1]);
    const limitBytes = Number(match![2]);

    // The boundary `assertUnderStorageQuota` enforces (`usage.bytes >= limit`).
    expect(usageBytes).toBeGreaterThanOrEqual(limitBytes);

    // Every seeded byte was counted. `getUserStorageUsage` sums six fields
    // across every owned row; the fixtures put a value in all six of them on
    // each of three rows, so a dropped term or a missing row would land the
    // reported usage BELOW this figure while still (with 2.4 GB seeded against
    // a 2 GiB limit) leaving the refusal itself intact.
    //
    // NOTE this is only a TIGHT bound while the GM's other rows are tiny —
    // today the five `audio-library.spec.ts` fixtures contribute ~4.5 MB
    // against 2.4 GB of fillers. Against a database carrying substantial
    // pre-existing audio for the seeded GM, that slack grows and this
    // assertion loosens silently: a dropped aggregation term could hide inside
    // the real rows' bytes. If that ever becomes the situation, compare
    // against a usage figure computed in `globalSetup` rather than this
    // constant.
    expect(usageBytes).toBeGreaterThanOrEqual(SEEDED_FILLER_BYTES);

    // Task 5's claim is that the number shown and the number enforced cannot
    // diverge, because both come from one server response. This is that claim
    // stated as an assertion: the bar's own accessible text, formatted with
    // the app's `formatBytes`, must be exactly the figures the server just
    // refused on — no client-side limit constant, no second round trip.
    await expect(page.getByRole('progressbar', { name: 'Storage used' })).toHaveAttribute(
      'aria-valuetext',
      `${formatBytes(usageBytes)} of ${formatBytes(limitBytes)} used`
    );
  });
});
