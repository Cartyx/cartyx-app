/**
 * `kanka` fixture — pulls a campaign world from the user's Kanka account
 * (https://kanka.io) into the local dev DB.
 *
 * Status: STUB. Throws "not implemented" with a clear message and prints
 * the integration contract so the next implementer knows what to wire up.
 *
 * Planned integration shape:
 *   - Reads KANKA_TOKEN (API token from Kanka account settings) and
 *     KANKA_CAMPAIGN_ID (the source Kanka campaign id) from .env.
 *   - Walks Kanka's REST API (https://app.kanka.io/api-docs):
 *       /1.0/campaigns/{id}            → name, description
 *       /1.0/campaigns/{id}/locations  → Cartyx Location docs
 *       /1.0/campaigns/{id}/characters → Cartyx Character docs
 *       /1.0/campaigns/{id}/notes      → optional, map to Cartyx Notes
 *   - Inserts into the dev DB with `metadata.managedBy = scripts/dev-fixtures`
 *     and `metadata.fixtureName = 'kanka'` so the destroyer can clean up.
 *   - Best-effort image import: Kanka entity images live at predictable
 *     URLs; either rehost into R2 or store the Kanka URL directly on the
 *     Cartyx doc.
 *
 * Rate limiting: Kanka API is 30 req/min for free accounts (90/min for
 * subscribers). The walker needs a token bucket.
 */
import type { Fixture, FixtureContext } from '../cli';
import type { ObjectId } from 'mongodb';

const FIXTURE_NAME = 'kanka';

async function seed(_ctx: FixtureContext): Promise<{ campaignIds: ObjectId[] }> {
  const token = process.env.KANKA_TOKEN;
  const kankaCampaignId = process.env.KANKA_CAMPAIGN_ID;

  const missing: string[] = [];
  if (!token) missing.push('KANKA_TOKEN');
  if (!kankaCampaignId) missing.push('KANKA_CAMPAIGN_ID');
  if (missing.length) {
    throw new Error(
      `[fixture:kanka] Missing required env var(s): ${missing.join(', ')}. ` +
        `Add to .env. Get your token at https://app.kanka.io/settings/api ` +
        `and find your campaign id in its URL.`
    );
  }

  // Hits the API once to confirm credentials before failing on "not implemented".
  // This gives the developer a fast signal that their token works.
  const resp = await fetch(`https://app.kanka.io/api/1.0/campaigns/${kankaCampaignId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (resp.status === 401) {
    throw new Error(
      '[fixture:kanka] KANKA_TOKEN was rejected (401). Check the token at app.kanka.io/settings/api.'
    );
  }
  if (resp.status === 404) {
    throw new Error(
      `[fixture:kanka] Campaign ${kankaCampaignId} not found (404). Check KANKA_CAMPAIGN_ID.`
    );
  }
  if (!resp.ok) {
    throw new Error(`[fixture:kanka] Kanka API returned ${resp.status} ${resp.statusText}`);
  }
  const { data } = (await resp.json()) as { data: { name: string; entry?: string } };

  throw new Error(
    `[fixture:kanka] Credentials OK — confirmed campaign "${data.name}". ` +
      `Implementation pending: walking /locations, /characters, /notes endpoints, ` +
      `mapping to Cartyx schemas, and inserting with fixture marker. ` +
      `See the file header for the planned shape.`
  );
}

export const kankaFixture: Fixture = {
  name: FIXTURE_NAME,
  description:
    'Clone your Kanka campaign world into the dev DB (stub — verifies credentials, then throws "not implemented").',
  seed,
};
