import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect } from '@playwright/test';

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
