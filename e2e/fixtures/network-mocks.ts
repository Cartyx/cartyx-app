import type { Page } from '@playwright/test';

/**
 * Stub PostHog endpoints so feature flags resolve to enabled and we never hit
 * the real service. Without this the InspectorSidebar tab list never resolves
 * (all tabs gated on PostHog feature flags) and tests hang on "Loading panels...".
 *
 * The matcher is anchored to cross-origin URLs containing "posthog" — local Vite
 * source files (PostHogProvider.tsx, posthog-client.ts) must NOT be intercepted.
 */
export async function mockPostHog(page: Page): Promise<void> {
  const flagNames = [
    'inspector-wiki-dev',
    'inspector-chat-dev',
    'inspector-notepad-dev',
    'inspector-settings-dev',
    'cartyx-dice-dev',
  ];
  const enabledFlags = Object.fromEntries(flagNames.map((f) => [f, true]));

  await page.route(/^https?:\/\/[^/]*posthog[^/]*\//i, async (route) => {
    const url = route.request().url();
    if (/\/(decide|flags)/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ featureFlags: enabledFlags, featureFlagPayloads: {} }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

/**
 * Stub R2 direct upload: the server fn returns a fake presigned URL and the PUT
 * to the (fake) R2 host returns 200. No real R2 traffic is generated.
 */
export async function mockR2DirectUpload(page: Page): Promise<void> {
  await page.route(/_serverFn.*getUploadUrl/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        uploadUrl: 'https://test.r2.example/upload?signature=test',
        imageKey: `uploads/locations/${Date.now()}-test.png`,
        publicUrl: 'https://test.cdn.example/uploads/locations/test.png',
      }),
    });
  });
  await page.route('https://test.r2.example/**', async (route) => {
    await route.fulfill({ status: 200, body: '' });
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
