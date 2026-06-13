# Dev Fixtures

TypeScript-driven dev DB fixtures for iterating on tabletop features. Lets you destroy and rebuild scenario-specific campaigns without touching your real dev data.

## Quick start

```sh
npm run fixture list                  # list available fixtures
npm run fixture reset crowded         # destroy + reseed the "crowded" fixture
npm run fixture destroy crowded       # destroy only — no reseed
npm run fixture destroy --all         # destroy every fixture-managed campaign
npm run fixture destroy --id=<id> --force   # destroy a specific campaign (only with --force)
npm run fixture clean-e2e             # remove E2E test screen + e2e/* image refs
npm run fixture sweep-r2              # delete R2 objects no document references
npm run fixture nuke                  # destroy --all + clean-e2e + sweep-r2
```

After `reset`, log into the app and the fixture campaign will be visible in your campaign list (you're seeded as the GM).

## Teardown story

The product isn't in production yet — we want to be able to change the fixture shape (and the underlying schemas) without thinking about migrations. The teardown commands give that:

- **`destroy <name>`** — wipes a single fixture's campaigns, their session-scoped data, R2 images, and runs the fixture's optional `teardown()` hook.
- **`destroy --all`** — same but for every fixture-managed campaign in the system.
- **`clean-e2e`** — removes the "E2E Test Screen" tabletopscreen and `e2e/*` image keys that `e2e/globalSetup.ts` attaches to whatever campaign/location it picks. These survive `destroy --all` because they attach to non-fixture data.
- **`sweep-r2`** — lists R2 objects under tracked upload prefixes and deletes anything not referenced by any document. Backstop for crashes mid-seed and accumulated leakage. Drives storage cost to zero waste.
- **`nuke`** — runs all three in sequence. The "reset everything to a clean slate, I'm rebuilding the fixture from scratch" button.

R2 cleanup is best-effort: failures are reported but don't block the destroy.

## Safety

- Refuses to run when `NODE_ENV=production` or when `MONGODB_URI` contains "prod".
- The destroyer **only** removes campaigns marked with `metadata.managedBy === 'scripts/dev-fixtures'`. Your real campaigns are safe.
- The `--id` form is the only way to destroy a non-fixture campaign, and it requires `--force`.

## Fixtures

| Name      | Description                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crowded` | 1 campaign, 25 locations (4-level hierarchy with images), 30 NPCs (relationships), 5 tabletop screens with pre-opened windows. Stress-test scale. |
| `kanka`   | (stub) Clones a Kanka campaign world into the dev DB. Reads `KANKA_TOKEN` + `KANKA_CAMPAIGN_ID` from `.env`. Currently only verifies credentials. |

## Adding a new fixture

1. Create `scripts/dev-fixtures/fixtures/<name>.ts` exporting a `Fixture`:
   ```ts
   import type { Fixture } from '../cli';
   export const myFixture: Fixture = {
     name: '<name>',
     description: 'short description',
     async seed({ conn, gm, marker }) {
       const db = conn.db!;
       // ... insert docs, stamp `metadata: marker('<name>')` on each Campaign
       return { campaignIds: [insertedCampaignId] };
     },
     // Optional — only needed if the fixture creates data outside the
     // campaign-scoped collections (User patches, global tags, R2 prefixes
     // not under uploads/, etc.). The generic destroyer handles every
     // campaign-scoped collection automatically.
     async teardown({ conn }) {
       // e.g. await conn.db!.collection('someGlobalThing').deleteMany({ tag: 'myFixture' });
     },
   };
   ```
2. Add it to the `FIXTURES` array in `cli.ts`.
3. **Always stamp** the campaign document with `metadata: marker('<name>')`. Without it, the destroyer won't be able to clean up.

## Collection coverage

The destroyer walks these collections per campaign:

- **Campaign-scoped:** `sessions`, `characters`, `players`, `location`, `locationtype`, `tabletopscreen`, `tabletopplayerstate`, `gmscreen`, `notes`, `rules`, `races`, `tags`
- **Session-scoped:** `sessionevent`, `messages`, `dicerolls`
- **R2 cleanup:** best-effort delete of image keys referenced from `location.images[].imageKey`, `character.picture`, `player.picture`, `campaign.imagePath` (URL → key via `CDN_URL`)
- **User array:** `users.campaigns[]` entries are pulled out

If you add a new campaign-scoped collection to the app, update `CAMPAIGN_SCOPED_COLLECTIONS` in `helpers.ts`.

## Kanka integration (planned)

The `kanka` fixture is a stub. To finish it:

1. Get a personal access token at https://app.kanka.io/settings/api
2. Find your campaign id in its URL
3. Add to `.env`:
   ```
   KANKA_TOKEN=...
   KANKA_CAMPAIGN_ID=...
   ```
4. Implement the entity walkers in `fixtures/kanka.ts`. Kanka API docs: https://app.kanka.io/api-docs
5. Mind the rate limit: 30 req/min free, 90 req/min subscriber.
