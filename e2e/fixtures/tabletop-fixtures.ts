import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';

interface SeedData {
  campaignId: string;
  locationId: string;
  locationName: string;
  screenId: string;
  fixtureImageTitle: string;
}

function readSeedData(): SeedData {
  const path = join(process.cwd(), 'e2e', '.auth', 'seed-data.json');
  if (!existsSync(path)) {
    throw new Error(
      'e2e/.auth/seed-data.json missing — globalSetup did not run. Check playwright.config.ts.'
    );
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as SeedData;
}

export const test = base.extend<{
  campaignId: string;
  locationId: string;
  locationName: string;
  screenId: string;
  fixtureImageTitle: string;
  campaignUrl: string;
  tabletopUrl: string;
}>({
  campaignId: async ({}, use) => {
    await use(readSeedData().campaignId);
  },
  locationId: async ({}, use) => {
    await use(readSeedData().locationId);
  },
  locationName: async ({}, use) => {
    await use(readSeedData().locationName);
  },
  screenId: async ({}, use) => {
    await use(readSeedData().screenId);
  },
  fixtureImageTitle: async ({}, use) => {
    await use(readSeedData().fixtureImageTitle);
  },
  campaignUrl: async ({}, use) => {
    const seed = readSeedData();
    await use(`/campaigns/${seed.campaignId}/play`);
  },
  tabletopUrl: async ({}, use) => {
    const seed = readSeedData();
    await use(`/campaigns/${seed.campaignId}/play?tab=tabletop`);
  },
});

export { expect };

/**
 * Click the Wiki inspector tab and wait for it to actually take effect.
 *
 * On a cold `vite dev` server the client bundle can take many seconds to
 * hydrate. A click fired before React attaches its event listeners lands on
 * inert SSR markup: no error, no state change, and the test has no way to
 * tell the difference from a normal click — it just silently does nothing,
 * and everything that depends on the Wiki panel being active times out much
 * later with a confusing error.
 *
 * Instead of a fixed sleep (which would either be too short under load or
 * needlessly slow otherwise), retry the click until the tab is provably
 * selected. Once hydration completes, the very next retry's click succeeds
 * immediately, so this only costs real wall-clock time on genuinely slow
 * cold starts.
 */
export async function openWikiTab(page: Page): Promise<void> {
  const wikiTab = page.getByRole('tab', { name: 'Wiki' });
  await expect(wikiTab).toBeVisible();

  await expect(async () => {
    await wikiTab.click();
    await expect(wikiTab).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Click a Tabletop screen tab and wait for it to actually take effect.
 *
 * Same hydration hazard as openWikiTab: on a cold `vite dev` server a click
 * fired before React attaches its event listeners lands on inert SSR markup
 * and silently no-ops, leaving the wrong screen active — everything that
 * depends on the target screen's contents (e.g. a pre-seeded floating
 * window) then fails or times out with a confusing error far from the real
 * cause. Retry the click until the tab is provably selected instead of a
 * fixed sleep.
 */
export async function openTabletopTab(page: Page, screenId: string): Promise<void> {
  const tab = page.getByTestId(`tabletop-tab-${screenId}`);
  await expect(tab).toBeVisible();

  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}
