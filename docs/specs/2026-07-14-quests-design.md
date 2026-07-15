# Quests — Design

**Date:** 2026-07-14 · **Status:** Planned (branch `new-orgs` → PR against `dev`)

## Overview

Quests are a wiki entity representing a story thread the party can take on —
main quest, side job, personal arc — modeled after Kanka's Quests. A quest has
public and GM-only (private) descriptive information, a **status**, an optional
**quest giver** (a character, player, or organization), an optional **parent
quest** (for sub-quest hierarchies), a freeform **type**, multiple images, tags,
and rich links to other entities. It links to characters, players, locations,
and organizations (each link carrying a role plus public + GM-private notes),
and to calendar events (each event link also carrying a role plus public +
private notes). Quests are managed in the same wiki UI as organizations, lore,
races, and locations, and are viewed primarily as **GM-screen and tabletop
windows**. Characters, players, locations, and organizations gain a **Quests**
tab (in both the edit modal and the view window) listing every quest that links
to them.

This slice deliberately mirrors the Organizations vertical slice
(`docs/specs/2026-07-13-organizations-design.md`) end to end — same stack
(TanStack Start server functions, Mongoose, React Query, Zod validators, R2 CDN
images, panel-based wiki UI in `play.tsx`), same privacy discipline, same
tabletop/GM-screen registry pattern. Where a decision is unstated below, follow
the Organizations precedent.

## Data model

One new mongoose collection (`quests`, the default pluralized name). Unlike
Organizations, quest links and event links are **embedded** on the quest
document rather than kept in a join collection — a quest owns its links and
there is no independent membership lifecycle to manage.

### `Quest` — `app/server/db/models/Quest.ts`

| Field                     | Type                                                              | Notes                                                                                        |
| ------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `name`                    | String, required                                                  | Display name / window title                                                                  |
| `type`                    | String                                                            | Freeform classification ("Main" / "Side" / "Personal"); autocomplete                         |
| `status`                  | enum, default `not_started`                                       | `not_started` \| `active` \| `on_hold` \| `completed` \| `failed`                            |
| `publicInfo`              | String (Markdown)                                                 | Rendered to everyone                                                                         |
| `privateInfo`             | String (Markdown)                                                 | **GM-only**                                                                                  |
| `isPublic`                | Boolean, default `false`                                          | Whole-entity visibility gate                                                                 |
| `giver`                   | `{ kind: 'character' \| 'player' \| 'organization', id } \| null` | Polymorphic quest giver; optional (may be left blank)                                        |
| `parentQuestId`           | ObjectId → Quest, nullable                                        | Sub-quest hierarchy                                                                          |
| `links`                   | `[{ kind, id, role, publicInfo, privateInfo }]`                   | `kind`: `character`\|`player`\|`location`\|`organization`; per-link `privateInfo` is GM-only |
| `events`                  | `[{ eventId → Event, role, publicInfo, privateInfo }]`            | Linked calendar events; per-link `privateInfo` is GM-only                                    |
| `images`                  | `[{ url, caption, crop }]`                                        | Multiple images (reuses the shared `imageSchema`); **public** — not GM-gated                 |
| `tags`                    | `[String]`                                                        | Normalized (lowercased/deduped) in `pre('save')`                                             |
| `campaignId`, `createdBy` | ObjectId                                                          | Scoping / ownership                                                                          |
| `createdAt`, `updatedAt`  | Date                                                              | Pre-save normalizes tags + bumps `updatedAt`                                                 |

Indexes: `campaignId`, `{campaignId, updatedAt}`, `createdBy`, `tags`,
`isPublic`, `status`, `parentQuestId`, `giver.id`, `links.id`, `events.eventId`,
and a text index on `{name, publicInfo}`.

The `links` and `events` entries reuse the same embedded-link shape (`role` +
`publicInfo` + GM-only `privateInfo`), so the read-time stripping, the merge-on-
non-GM-update logic, and the editor UI are shared between them. `links` uses a
polymorphic `{kind, id}`; `events` references the `Event` collection directly by
`eventId`.

## Privacy model

Identical discipline to Organizations. "Private" always means **GM-only**.

1. **`isPublic` on the quest (whole-entity visibility).** A **private** quest
   (`isPublic:false`) is entirely GM-only: absent from the wiki list for
   non-GMs, dropped from the tabletop window list for non-GM viewers, and
   excluded from every entity's **Quests** tab for non-GMs — a character's
   involvement in a secret quest never leaks to players. A **public** quest is
   visible to everyone.
2. **GM-only fields within a public quest.** `privateInfo`, each link's
   `privateInfo`, and each event link's `privateInfo` are always stripped from
   server responses for non-GMs, and writable only by a GM. A non-GM update
   **preserves** existing private values (merge links by `{kind,id}` and events
   by `eventId`; omit the quest-level `privateInfo` from `$set`) rather than
   wiping them.

GM screens are a GM-only surface (nothing stripped). Tabletop is player-facing
(stripping + the private-quest window drop apply). Quest **giver**, **status**,
**type**, and **parentQuestId** are public metadata (not stripped) — a public
quest shows them to everyone; a private quest is hidden wholesale anyway.

## Server API — `app/server/functions/quests.ts`

Quest CRUD (`list/get/create/update/deleteQuest`) + a reverse-lookup query
(`listQuestsForEntity`, for the Quests tab). Every function authenticates via
`requireCampaignMember`, gates edits on GM-or-creator
(`canEdit = isGM || String(createdBy) === userId`), resolves display labels for
giver/links/events/parent at read time, and strips GM-only fields for non-GMs.
`LIST_LIMIT = 500` bounds list queries. Tags persist through `ensureTags`;
telemetry via `serverCaptureException`/`serverCaptureEvent`. React Query hooks
and the `createServerFn` wrappers live in `app/hooks/useQuests.ts`; query keys in
`app/utils/queryKeys.ts` (`queryKeys.quests`).

`listQuests` filters by search (`$text`), `tags` (`$all`), `status`, and
`linkedKind`/`linkedId` (reverse lookup — "quests linked to this entity", via
`links: { $elemMatch: { kind, id } }`, plus a `giver` match). The list
projection drops the heavy fields (`publicInfo`, `privateInfo`, `images`,
`links`, `events`).

**Cleanup on delete:**

- `deleteQuest` removes the quest from any GM screens
  (`removeDocumentRefsFromScreens(campaignId, 'quest', id)`) and nulls
  `parentQuestId` on any child quests (children become top-level, not deleted).
- A new `pruneQuestRefs(kind, id, campaignId)` is called from
  `deletePlayer` / `deleteCharacter` / `deleteLocation` / `deleteOrganization` /
  `deleteEvent` to pull dangling `links`, clear a matching `giver`, and pull the
  matching `events` entry — the same discipline as
  `pruneMembershipsForMember`. Deleting an organization therefore also runs
  `pruneQuestRefs('organization', …)` in addition to its existing membership
  cleanup.

## UI surfaces

- **Wiki:** `app/components/wiki/quests/` — panel (`WikiFilterBar` search + tag
  filters plus a **status** filter chip row), create/edit modal (name, type
  autocomplete, status select, giver picker, parent-quest picker, public/private
  Markdown, `isPublic` toggle, tags, image upload, a **links editor** with
  per-link role + public/private info, and an **events editor** with the same
  role + public/private fields), view modal, and the `QuestWindow` render
  surface (`data-testid="quest-window"`: gallery, status/giver/type/parent +
  sub-quests header, public/private Markdown, links grouped by kind, and the
  events list). Registered in `WikiPanel.tsx` (`WikiCategoryId` union,
  `WIKI_CATEGORIES` with a scroll icon, panel switch) — **not** `gmOnly`, so
  players see public quests.
  - `QuestLinksEditor` and `QuestEventsEditor` generalize the existing
    `OrganizationLocationsEditor` / `EventLinksEditor` (kind dropdown + entity
    dropdown + role + public/private notes). The giver and parent-quest pickers
    are single-select entity dropdowns.
- **Character/player/location/organization:** a **Quests** tab in each entity's
  edit modal and view window, backed by a shared `EntityQuestsTab` (reverse
  lookup via `listQuestsForEntity`; read-only list of linked quests with status
  badges — quests are edited from the quest side, so this tab lists rather than
  mutates).
- **GM-screen + tabletop:** `'quest'` registered in `SUPPORTED_COLLECTIONS`
  (gmscreens), `TABLETOP_COLLECTIONS`, and both `COLLECTION_REGISTRY` hydration
  maps (fetcher selects `_id name publicInfo isPublic status`; non-GM private
  quests stripped in `hydrateRefs`). `QuestWindowWrapper` /
  `EditQuestModalWrapper` render the window in `GMScreensView.tsx` and
  `TabletopView.tsx`; drag-to-tabletop and "Show on Tabletop" work via a
  draggable `QuestCard` and the shared `ShowOnTabletopButton`
  (`application/x-cartyx-document` payload `{ collection: 'quest', documentId,
title }`).

## Seed data

`scripts/dev_seed.py` (`npm run dev:seed`) seeds the rich campaign ("The Lost
Mines of Phandelver") with a handful of quests exercising the model:

- Public quests with mixed statuses (e.g. an **active** main quest "Goblin
  Arrows", a **completed** side quest, an **on-hold** personal arc), each with a
  giver (character/player/organization), links to characters/locations/orgs
  (with roles + notes), and one or two linked events with per-event notes.
- At least one **GM-only private** quest (e.g. "The Black Spider's Plot") with
  GM-only `privateInfo` and private link/event notes — exercising that a private
  quest stays hidden from non-GM viewers, including on a linked character's
  Quests tab.
- At least one **sub-quest** (a child with `parentQuestId` set) to exercise the
  hierarchy and the "null children on parent delete" path.

Builder: `build_quest_docs`, inserted in the `rich_session_history` block. Quest
images are uploaded to R2 with CDN URLs via a new
`scripts/gen_seed_quest_images.mjs` (mirrors `gen_seed_org_images.mjs`).

## Testing

Unit (Vitest, `npm test`):

- `quest-model.test.ts` — schema, defaults (status `not_started`), tag
  normalization, embedded link/event shapes.
- `quests.test.ts` — privacy stripping (quest `privateInfo`, per-link and
  per-event `privateInfo`), private-quest list filtering, status filter,
  reverse lookup (`listQuestsForEntity`), cascade delete (GM-screen ref removal
  - child re-parenting), `pruneQuestRefs` on entity deletes, and GM-or-creator
    permission gating.
- Extend the **registry-sync guard** (`lore-window-collection.test.ts`) to
  assert `'quest'` is present in `SUPPORTED_COLLECTIONS` /
  `TABLETOP_COLLECTIONS` / both `COLLECTION_REGISTRY` maps.
- `tabletop-hydration.test.ts` — quest hydration + non-GM private-quest strip.
- Component tests: `QuestWindow.test.tsx`, `EntityQuestsTab.test.tsx`, and
  `WikiPanel` quest registration.

E2E (Playwright, `npm run e2e`): `e2e/gmscreens/gmscreens-quest-window.spec.ts`
— provision a campaign + quest + GM screen directly in MongoDB, synthesize a
drag of the `application/x-cartyx-document` payload onto the GM-screen tabpanel,
and assert a `quest-window` appears and persists across reload (the same
registry-sync guard class as the org e2e).

## Out of scope (Kanka has these; cut for 1.0)

- **Inventory / rewards** — Kanka attaches an inventory to a quest for completion
  rewards. Not in 1.0.
- **Calendar auto-event generation** — Kanka can add a quest to a calendar as an
  event. Quests link to existing events only; they do not create calendar
  entries. Not in 1.0.
- **Two-way event links** — event links live on the quest only; the Event window
  does not list the quests that reference it (no `quest` kind added to Event's
  `linkSchema`).
