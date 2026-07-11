import type { Page } from '@playwright/test';

/**
 * Stub the R2 PUT so the upload spec doesn't write real bytes to Cloudflare R2
 * on every run. We deliberately do NOT mock `getUploadUrl` — TanStack Start
 * server-fn responses use a custom wire format (`x-tss-serialized` headers
 * and framed bodies), and a hand-rolled `route.fulfill` doesn't satisfy the
 * client parser. Letting the server-fn run gives us a real presigned URL;
 * intercepting the PUT means R2 never actually receives the bytes.
 *
 * Side effect: the addLocationImage server-fn still records the real R2
 * imageKey + cdn-dev URL in MongoDB. The thumbnail's <img> source points at
 * a 404 in R2, but the element is still in the DOM so Playwright assertions
 * succeed. For manual exploratory testing, prefer uploading real images via
 * the UI.
 */
export async function mockR2DirectUpload(page: Page): Promise<void> {
  await page.route(/\.r2\.cloudflarestorage\.com\//, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, body: '' });
      return;
    }
    await route.continue();
  });
}

/**
 * Block PartyKit WebSocket connections so tests don't fail with noisy
 * net::ERR_CONNECTION_REFUSED errors when the PartyKit dev server isn't
 * running. Tests that don't exercise real-time sync don't need it up.
 */
export async function blockPartyKit(page: Page): Promise<void> {
  await page.route(/^wss?:\/\/.*(partykit|:1999)/i, async (route) => {
    await route.abort();
  });
}
