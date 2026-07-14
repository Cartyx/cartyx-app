# Organizations — Design

**Date:** 2026-07-13 · **Status:** Implemented (branch `new-orgs` → PR against `dev`)

## Overview

Organizations are a wiki entity representing a group — guild, faction, noble
house, cult, city watch — modeled after Kanka's Organizations. An organization
has public and GM-only (private) descriptive information, a roster of member
players/characters (each with an optional title and public + private
relationship notes), and links to one or more locations (each with public +
private information). Organizations are managed in the same wiki UI as lore,
races, and locations, and are viewed primarily as **GM-screen and tabletop
windows**. Players and characters gain an **Organizations** tab (in both the
edit modal and the view window) listing every org they belong to.

## Data model

Two new mongoose collections (both use mongoose's default pluralized collection
names — `organizations` and `organizationmemberships`).

### `Organization` — `app/server/db/models/Organization.ts`

| Field                     | Type                                                   | Notes                                          |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| `name`                    | String, required                                       | Display name / window title                    |
| `publicInfo`              | String (Markdown)                                      | Rendered to everyone                           |
| `privateInfo`             | String (Markdown)                                      | **GM-only**                                    |
| `isPublic`                | Boolean, default `false`                               | Whole-entity visibility gate                   |
| `locations`               | `[{ locationId → Location, publicInfo, privateInfo }]` | Embedded; each link's `privateInfo` is GM-only |
| `tags`                    | `[String]`                                             | Normalized (lowercased/deduped)                |
| `campaignId`, `createdBy` | ObjectId                                               | Scoping / ownership                            |
| `createdAt`, `updatedAt`  | Date                                                   | Pre-save normalizes tags + bumps `updatedAt`   |

Indexes: `campaignId`, `{campaignId, updatedAt}`, `createdBy`, `tags`,
`isPublic`, `locations.locationId`, and a text index on `{name, publicInfo}`.

### `OrganizationMembership` — `app/server/db/models/OrganizationMembership.ts`

A dedicated join collection (chosen over embedding on both sides). One document
per (org, member) pair.

| Field                     | Type                      | Notes                                 |
| ------------------------- | ------------------------- | ------------------------------------- |
| `organizationId`          | ObjectId → Organization   |                                       |
| `memberKind`              | `'player' \| 'character'` | Which collection `memberId` points to |
| `memberId`                | ObjectId                  | Player or Character `_id`             |
| `title`                   | String                    | Optional (e.g. "Guildmaster")         |
| `publicNotes`             | String (Markdown)         | Rendered to everyone                  |
| `privateNotes`            | String (Markdown)         | **GM-only**                           |
| `campaignId`, `createdBy` | ObjectId                  |                                       |

Indexes: **unique** `{organizationId, memberKind, memberId}` (no duplicate
membership); `{campaignId, memberKind, memberId}` (reverse lookup for the
player/character Organizations tab); `{organizationId}` (roster lookup).

## Privacy model

"Private" always means **GM-only** (never "members-only"), consistent with
Lore's `gmContent`.

1. **`isPublic` on the org (whole-entity visibility).** A **private** org
   (`isPublic:false`) is entirely GM-only: absent from the wiki list for
   non-GMs, dropped from the tabletop window list for non-GM viewers, and its
   memberships are excluded from any player/character Organizations tab for
   non-GMs — a character's membership in a secret org never leaks to players. A
   **public** org is visible to everyone.
2. **GM-only fields within a public org.** `privateInfo`, per-membership
   `privateNotes`, and per-location-link `privateInfo` are always stripped from
   server responses for non-GMs, and writable only by a GM. A non-GM update
   **preserves** existing private values (merge by `locationId` for location
   links; omit `privateInfo` from `$set` for the org) rather than wiping them.

GM screens are a GM-only surface (nothing stripped). Tabletop is player-facing
(stripping + the private-org window drop apply).

## Server API — `app/server/functions/organizations.ts`

Org CRUD (`list/get/create/update/delete`) + membership CRUD
(`add/update/remove`, `listMembershipsForOrg`, `listMembershipsForMember`) +
`pruneMembershipsForMember` (called from `deletePlayer`/`deleteCharacter`).
Every function authenticates via `requireCampaignMember`, gates edits on
GM-or-creator, resolves display labels at read time, and strips GM-only fields
for non-GMs. `listOrganizations` filters by search (`$text`), `tags` (`$all`),
and `locationIds` (`locations.locationId $in`). Deleting an org cascade-deletes
its memberships. React Query hooks live in `app/hooks/useOrganizations.ts`.

## UI surfaces

- **Wiki:** `app/components/wiki/organizations/` — panel (with tag **and**
  location filters), create/edit modal (public/private Markdown, `isPublic`
  toggle, tags, a locations editor with per-link public/private info, and a
  members roster editor), view modal, and the `OrganizationWindow` render
  surface. Registered in `WikiPanel.tsx`.
- **Player/character:** an **Organizations** tab in `PlayerModal`/
  `CharacterModal` (edit) and `PlayerWindow`/`CharacterWindow` (view), backed by
  the shared `MemberOrganizationsTab` (reverse lookup + add/edit/remove).
- **GM-screen + tabletop:** `'organization'` registered in
  `SUPPORTED_COLLECTIONS`/`TABLETOP_COLLECTIONS` and both `COLLECTION_REGISTRY`
  hydration maps; `OrganizationWindowWrapper` renders the window; drag-to-tabletop
  and "Show on Tabletop" work via the shared card/button.

## Seed data

`scripts/dev_seed.py` (`npm run dev:seed`) seeds the rich campaign ("The Lost
Mines of Phandelver") with **5 organizations** and **7 memberships**:

- Public: **The Lords' Alliance**, **Phandalin Miner's Exchange**, **The Harpers**
  (with location links to Phandalin and character/player members).
- GM-only private: **The Redbrands**, **The Black Spider's Network** (with
  GM-only `privateInfo`).
- Memberships mix characters (Sildar, Halia, Sister Garaele, Daran) and party
  players. One party player is a member of the **private** Black Spider's
  Network — exercising that a private org stays hidden from non-GM viewers,
  including that member, on their own Organizations tab.

Builders: `build_organization_docs` and `build_organization_membership_docs`,
inserted in the `rich_session_history` block.

## Testing

Unit: model schemas, server functions (privacy stripping, private-org
filtering, cascade delete, reverse lookup), the registry-sync guard
(`lore-window-collection.test.ts`), the tabletop-hydration strip, and component
tests for the window, member tab, and panel. Full suite green (1629 tests).

## Deferred follow-ups (non-blocking; from the final review)

- Cascade delete (`deleteOrganization`) is non-transactional. Reads fail-closed
  on orphaned memberships (both list paths tolerate a missing org), so there is
  no user-visible impact; diverges from the `withTransaction` precedent used by
  campaigns/gmscreens/sessions/tabletop.
- Membership add/edit/remove modals lack loading-disable / error surfacing /
  delete confirmation — the `mutate` wrappers swallow errors, so a failed
  mutation closes the modal silently.
- A non-GM removing a location link drops that link's GM `privateInfo` (narrow
  edge; the per-link preserve only covers links still present in the payload).
- The tabletop window title bar can be stale after an org rename until the
  tabletop refetches (org mutations don't invalidate the tabletop query; matches
  sibling collections).
- The client sends `privateInfo`/location `privateInfo` in the create/update
  payload even when the editor is hidden from a non-GM (server strips/ignores —
  fragile, not exploitable).
- Test hygiene: `organization-membership-model.test.ts` triggers a
  `vi.unmock('mongoose')` hoisting warning (matches the pre-existing
  `gmscreen.test.ts` pattern).
