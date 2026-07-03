# Lore — Design Spec

**Date:** 2026-06-16
**Branch:** `wiki-updates`
**Status:** Approved (design); pending implementation plan

## Summary

Lore is a new wiki entity that captures history, stories, and flavor about anything in
the game. A piece of lore is fundamentally a public Markdown body plus an optional
GM-only Markdown section, can carry images, and can be linked to any number of game
entities — **Race, Character, Player, Location**. Lore behaves like other wiki entities
(Characters, Races): a GM (or the lore's creator) can edit it, and it can be dragged out
onto the tabletop and GM screens anywhere a Race/Character can.

Lore linked to a Player surfaces in a **Lore tab** in the Player information window.
Players can author lore (public or private) during player creation and while editing
their player. Private lore is readable only by its author and the GM; public lore is
readable by everyone in the campaign.

This feature mirrors the existing **Character** feature end-to-end. Where a decision is
not stated below, follow the Character implementation as the template.

## Decisions (locked)

1. **Link model:** one lore entry can link to _many_ entities of mixed types; entities
   can have many lore. Stored as a polymorphic `links: [{ kind, id }]` array.
2. **Player lore model:** a single unified `Lore` collection. "Player lore" is simply a
   lore doc whose `links` include that player. No separate embedded sub-collection.
3. **Visibility:** `isPublic` flag controls whether non-GM/non-author can see the entry
   at all; plus an optional GM-only Markdown section (`gmContent`), exactly like Character
   `notes`/`gmNotes`.
4. **Reseed:** build and test against ephemeral Mongo first, then pause for explicit
   go-ahead before running the destructive `dev:clear` + `dev:seed` against the dev DB.
5. **Edit permissions:** any campaign member may create lore; only the creator or a GM may
   edit/delete it.
6. **Lore wiki category:** visible to all members (not GM-only).
7. **Images:** an array of images per lore entry (mirrors Location `images`), not a single
   picture.

## Architecture

Lore is a first-class campaign-scoped collection with the same shape of moving parts as
Character: Mongoose model → Zod schemas → server functions (gated by
`requireCampaignMember`) → React Query hooks → wiki UI (panel/card/modal/view-modal/window)
→ drag-out registration → seed data → tests.

### 1. Data model — `app/server/db/models/Lore.ts`

```
linkSchema ({ _id: false }):
  kind: String enum ['race','character','player','location'], required
  id:   ObjectId, required        // id of the linked document

imageSchema ({ _id: false }):
  url:     String, required
  caption: String, default ''
  crop:    { x, y, width, height } | null   // same shape as PictureCrop

loreSchema:
  title:      String, required
  content:    String, default ''            // public Markdown
  gmContent:  String, default ''            // GM-only Markdown
  isPublic:   Boolean, default false
  images:     [imageSchema], default []
  links:      [linkSchema],  default []
  tags:       [String], default [] (normalizeTags)
  campaignId: ObjectId, required
  createdBy:  ObjectId ref User, required
  createdAt / updatedAt: Date

Indexes: campaignId, { campaignId, updatedAt: -1 }, isPublic, tags,
         'links.id', text index on title + content
Hooks:   pre('save') normalize tags + bump updatedAt (mirror Character)
```

### 2. Types — `app/types/lore.ts`

```ts
interface LoreLink { kind: 'race'|'character'|'player'|'location'; id: string; label?: string }
interface LoreImage { url: string; caption: string; crop: PictureCrop | null }
interface LoreData {
  id, campaignId, createdBy, title, content, gmContent, isPublic,
  images: LoreImage[], links: LoreLink[], tags: string[],
  createdAt, updatedAt, canEdit: boolean
}
interface LoreListItem  // excludes gmContent
```

`label` on `LoreLink` is a denormalized display string resolved server-side for read
responses (entity name/title), so the UI can render link chips without N extra fetches.

### 3. Zod schemas — `app/types/schemas/lore.ts`

`createLoreSchema`, `updateLoreSchema` (create + `id`), `deleteLoreSchema` ({id,campaignId}),
`listLoreSchema` ({ campaignId, search?, tags?, visibility?, linkedKind?, linkedId? }),
`getLoreSchema` ({id,campaignId}). Link entries validated as `{ kind: enum, id: string.min(1) }`.

### 4. Server functions — `app/server/functions/lore.ts`

All wrapped with `createServerFn`, gated by `requireCampaignMember`.

- `listLore` — filters: `search` (text), `tags`, `visibility` ('all'|'public'|'private'),
  and `linkedKind`+`linkedId` (for the Player tab and entity-scoped views). Visibility
  rule: GM sees all; non-GM sees `isPublic === true` OR `createdBy === userId`. Returns
  `LoreListItem[]` (no `gmContent`) sorted by `updatedAt` desc.
- `getLore` — visibility + permission check; strips `gmContent` for non-GM; resolves
  `links[].label`; returns `LoreData & { canEdit }` where `canEdit = isCreator || isGM`.
- `createLore` — any member; returns created lore.
- `updateLore` — creator or GM only.
- `deleteLore` — creator or GM only; calls `removeDocumentRefsFromScreens('lore', id)`.
- **Link integrity:** when a Character/Player/Location/Race is deleted, prune any
  `Lore.links` entries pointing at it (extend each entity's delete handler with a
  `$pull` on `lore.links`), mirroring how character relationships are cleaned up today.

### 5. Hooks — `app/hooks/useLore.ts`

Query keys under `queryKeys.lore` (`list`, `detail`, `linked`). Hooks: `useLore(campaignId,
filters)`, `useLoreEntry(id, campaignId)`, `useLinkedLore(campaignId, kind, id)`,
`useCreateLore`, `useUpdateLore`, `useDeleteLore` (invalidate list + detail + linked +
`gmscreens.all`, following the Character mutation pattern).

### 6. Wiki UI — `app/components/wiki/lore/`

- Register `{ id: 'lore', label: 'Lore', icon: BookOpen }` in `WIKI_CATEGORIES`
  (`WikiPanel.tsx`), visible to all members; switch renders `LorePanel`.
- `LorePanel` — mirrors `CharactersPanel`: search/visibility/tag filter bar, `LoreCard`
  list, create button; opens `LoreModal` (edit) when `canEdit`, else `LoreViewModal`.
- `LoreCard` — draggable; payload `{ collection: 'lore', documentId, title }`; uses
  `setTokenDragImage` (first image or a book glyph). Shows public/private icon, tags,
  and a compact "linked to" summary.
- `LoreModal` (create/edit, via `useModalForm`) — fields: title, isPublic toggle,
  `content` MarkdownEditor, `gmContent` MarkdownEditor (GM-only), multi-image upload
  (compress → `uploadToR2('uploads/lore')`), tags, and a **Links editor**: a picker that
  searches across races/characters/players/locations and adds/removes `{kind,id}` links.
  Header has `ShowOnTabletopButton` (GM-only) in edit/view contexts.
- `LoreViewModal` + `LoreWindow` (read-only display) — images gallery, public `content`,
  `gmContent` (GM only), and clickable "Linked to" chips that open the linked entity.

### 7. Drag-out registration (the cross-cutting "collection" sites)

Register `'lore'` everywhere a collection string is mapped (the same set Character uses):

1. `LoreCard` drag payload (`collection: 'lore'`).
2. `GMScreensView` collection→component switch → `LoreWindowWrapper`.
3. `TabletopView` collection→component switch → `LoreWindowWrapper`.
4. `GMScreensView` + `TabletopView` window-title public/private icon sites (lore has
   `isPublic`).
5. `LoreWindowWrapper` + `EditLoreModalWrapper` (new, mirrors `CharacterWindowWrapper`).
6. `ShowOnTabletopButton` usages in `LoreModal`/`LoreViewModal` (`collection="lore"`).

Drag-out behavior then matches Race/Character exactly.

### 8. Player Lore tab — `app/components/wiki/players/PlayerWindow.tsx`

Add a `Lore` tab. Content uses `useLinkedLore(campaignId, 'player', playerId)` and renders
a `LoreList` (add/edit/remove when `canManage = isOwnPlayer || isGM`). Add/edit opens
`LoreModal` pre-seeded with a `player` link to this player. Server-side visibility means a
non-owner viewer only sees that player's _public_ lore; the owner and GM also see private
lore. Tab is always shown for managers; for non-managers it is shown when the player has
≥1 visible lore entry.

### 9. Player creation & editing lore

- **Join wizard** (`app/routes/campaign/join.tsx` + `app/components/join-wizard/`): add a
  `StepLore` allowing the player to add 0+ lore entries (title, public/private, content).
  Extend `WizardPlayerState` with `lore: WizardLore[]`, `completeJoinWizardSchema` with a
  `lore` array, and `completeJoinWizard` to create lore docs linked to the new player.
- **PlayerModal** (edit): a Lore management section reusing the tab's `LoreList`/`LoreModal`
  flow so a player can add/edit/remove their lore while editing.

### 10. Seed data + generated images

- Extend `scripts/dev_seed.py` (rich-session-history campaign) with several lore entries:
  - linked to a **race** (flavor sourced from `docs/srd/races`),
  - linked to a **town/location** (Phandalin),
  - linked to an **NPC character**,
  - linked to a **player**,
  - a mix of public/private, some with `gmContent`, some with images.
- Generate deterministic placeholder images into `public/uploads/seed-lore/` (extend
  `scripts/gen_seed_avatars.mjs` or add a sibling generator; wire into `npm run dev:seed`).

### 11. Tests

- **Server unit** (`tests/server/functions/lore.test.ts`): visibility gating (GM vs member
  vs author), `gmContent` stripping, create (any member) vs edit/delete (creator-or-GM),
  `linkedKind`/`linkedId` filtering, and the **cross-user private-lore** case (author and
  GM see private lore; other members do not). Mongoose models / session mocked per the
  existing server-fn test pattern.
- **Component** (`tests/components/...`): LorePanel render/list, LoreCard drag payload,
  LoreModal create/edit + links editor, PlayerWindow Lore tab gating.
- **Seed harness**: extend the ephemeral-Mongo seed integration test to assert lore docs
  are created and well-formed.
- **E2E (Playwright, `e2e/lore/`)**: GM creates and edits lore in the wiki panel; dragging
  lore onto the tabletop opens a `LoreWindow`; the Player Lore tab renders linked lore.
  **Honesty note:** the e2e harness seeds a single GM session, so the cross-user
  public-vs-private visibility check is covered by server unit tests, not browser e2e.

### 12. Reseed (final, gated)

After implementation and green unit + e2e tests, pause for explicit confirmation, then run
`npm run dev:clear -- --force` followed by `npm run dev:seed` against the dev environment.

## Out of scope (YAGNI)

- Versioning/history of lore edits.
- Rich link types beyond the four entity kinds.
- Cross-campaign / global lore (lore is campaign-scoped like everything else).
- Reordering/pinning lore within a tab beyond `updatedAt` sort.

## Risks / open notes

- **Link integrity** adds a small `$pull` to four existing delete handlers; must be covered
  by tests so deletions don't leave dangling lore links.
- **`links[].label` denormalization** is read-time only (not stored), so renames of linked
  entities are always reflected.
- The **e2e cross-user limitation** is intentional given the single-GM seed; documented
  above so coverage expectations are clear.
