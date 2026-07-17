# Wiki Card Overflow Menu (Design)

**Date:** 2026-07-17
**Status:** Approved design, ready for implementation plan
**Depends on:** the existing wiki panels, the tabletop/GM-screens window systems, and
`TabletopPlayerState`. All merged in `dev`.

## Summary

Every wiki card gains an overflow menu (`⋮`) offering up to four actions: **Edit**,
**Show on Tab**, **Push to Tabletop**, and **Delete**. Today only `MapCard` has such a
menu. From a card, the only way to get a wiki document onto the tabletop is to drag it
onto the surface — which is laborious, and which only a GM can do. (A
`ShowOnTabletopButton` exists, but only inside the 12 view/edit modals, never on a
card, and it targets the wrong screen — see §4.)

The central distinction, and the reason this is not just a menu-ification of drag:

| Action               | Who        | Target                                | Visible to  | Mechanism                                |
| -------------------- | ---------- | ------------------------------------- | ----------- | ---------------------------------------- |
| **Show on Tab**      | any member | current tab's active screen           | **only me** | **new** `privateWindows` on player state |
| **Push to Tabletop** | GM only    | **always** the Tabletop active screen | everyone    | existing `openTabletopWindow`            |
| **Edit**             | `canEdit`  | —                                     | —           | existing per-panel edit modal            |
| **Delete**           | GM only    | —                                     | —           | existing per-panel delete                |

**Push to Tabletop is exactly what dragging a card does today** (shared, persisted,
broadcast, GM-gated) — the menu is a second entry point over unchanged code.
**Show on Tab is new.** Nothing in the codebase currently opens a window that only
one user can see.

## Decisions (locked)

1. **Two distinct actions, not one.** Private display and shared push are separate
   menu items with separate mechanisms.
2. **Push always targets the Tabletop**, even when the GM is viewing GM Screens. The
   label always reads "Push to Tabletop" and always means one thing.
3. **Show on Tab works on both surfaces** (Tabletop and GM Screens). GM Screens are
   campaign-scoped and shared between co-GMs, so a private window is meaningful there.
4. **Push stays GM-only** (`requireCampaignGM`, unchanged). **Show on Tab is
   `requireCampaignMember`** — it writes only to the caller's own player-state
   document and cannot affect another user's view.
5. **Delete is GM-only; Edit follows `canEdit`.** This matches the existing precedent
   in `PlayerModal.tsx` (a creator may edit, only a GM may delete). No new `canDelete`
   field is introduced.
6. **On the Dashboard tab, both display actions are hidden.** The menu renders
   `null` when no actions qualify.
7. **Duplicate display → focus + flash** the existing window on both surfaces. This
   converges the tabletop's current silent no-op with the GM Screens behaviour.
8. **`spell` becomes a supported window collection.** `map` does not — a map is the
   tabletop surface, not a document window; `MapCard` keeps Edit / Delete / Set Active.
9. **Calendar is out of scope.** It has no cards — it is a singleton config panel, not
   a collection.
10. **`ShowOnTabletopButton` is refactored onto the shared hook** rather than left
    alongside it, fixing its screen-targeting bug (below) at the same time.
11. **The active GM screen is persisted** on player state as `activeGMScreenId`
    (see §2). Without it the wiki cannot know which GM screen to show on.

## Scope

**In:** characters, players, locations, organizations, quests, events, lore, races,
spells, rules, monsters (11 collections with cards + windows), plus maps
(Edit/Delete/Set Active only).

**Out:** calendar (no cards); `map` as a window collection.

## 1. Architecture

Four units, each with one responsibility:

### `OverflowMenu` — `app/components/shared/OverflowMenu.tsx`

A presentational menu primitive. Knows nothing about the wiki.

```ts
interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string; // tooltip, for the disabled case
}
interface OverflowMenuProps {
  items: MenuItem[];
  label: string; // aria-label for the trigger
}
```

Owns: open/close, click-outside, **Escape to close**, **focus restore to the
trigger**, **arrow-key roving focus**, and `aria-haspopup` / `aria-expanded` /
`role="menu"`. `MapCard`'s hand-rolled menu is replaced by this; it currently has
none of the above and no tests.

### `useWikiCardActions` — `app/hooks/useWikiCardActions.ts`

The brain. All branching lives here, and it is unit-testable without rendering.

```ts
useWikiCardActions({
  collection: WindowCollection,
  documentId: string,
  canEdit?: boolean,
  onEdit?: () => void,
  onDelete?: () => void,
}): { menuItems: MenuItem[] }
```

Reads:

- the main-view tab from `useSearch({ from: '/campaigns/$campaignId/play' })`
- `isGM` from `useCampaign(campaignId)`
- the active Tabletop screen from `useTabletopPlayerState(campaignId).playerState?.activeScreenId`
- the active GM screen from `playerState.activeGMScreenId` (see §2 — new field)

Both active screens come from the same player-state query the hook already makes.

Chosen over prop-drilling `activeTab` (4 levels, ~15 files, pass-through props at
every hop) and over a context provider (ceremony for a value the router already
holds). It follows existing precedent: `WikiPanel` and `MapsPanel` already reach for
the router directly via `useParams({ from: '/campaigns/$campaignId/play' })`.

**Trade-off accepted:** this couples cards to the play route, so a router decorator is
needed to story them. There are no wiki-card stories today, so nothing breaks.

### `WikiCardMenu` — `app/components/wiki/shared/WikiCardMenu.tsx`

Thin glue: calls the hook, renders `OverflowMenu`, returns `null` when
`menuItems.length === 0`. This is the single line each card adds.

### Render merge — `TabletopView` / `GMScreensView`

Each view composites shared windows with the caller's `privateWindows` for the active
screen. Private windows render through the same `FloatingWindow` and the same
collection branch; only their source and their close handler differ.

## 2. Data model

Two additions to the existing `TabletopPlayerState` (per campaign + user):

```ts
// The caller's private windows, across both surfaces.
privateWindows: [
  {
    surface: 'tabletop' | 'gmscreen',
    screenId: ObjectId,
    collection: String,
    documentId: ObjectId,
    x,
    y,
    width,
    height: Number,
    zIndex: Number,
    state: 'open' | 'minimized' | 'hidden',
  },
];

// The caller's active GM screen — mirror of the existing activeScreenId,
// which covers the Tabletop only.
activeGMScreenId: ObjectId | null;
```

### Why `activeGMScreenId` is required

`GMScreensView` currently holds its active screen in component-local `useState`
(`GMScreensView.tsx:64`) and **nothing persists it**. The Inspector sidebar is a
sibling subtree, so `useWikiCardActions` has no way to read it — "Show on Tab" on the
GM Screens tab is unimplementable without this. The Tabletop has no such problem
because `playerState.activeScreenId` is already persisted.

Persisting it makes the two surfaces symmetric, lets the hook read both active screens
from a single query, and incidentally gives GMs active-screen persistence across
reload (which they lack today). `GMScreensView` must be changed to read and write this
field instead of its local state.

**Alternatives rejected:** a context provider (keeps the value ephemeral, adds a
second mechanism for something player state already models) and a `?gmScreenId=` URL
param (puts UI state in the URL, which nothing else in this app does).

**Why here.** The document already exists for exactly this purpose — it holds
`activeScreenId`, `viewports`, and `windowOverrides`, all per-user campaign state.

**Alternatives rejected.** A parallel `GMScreenPlayerState` model would double the
duplication the tabletop/GM-screens systems already suffer from. Renaming
`TabletopPlayerState` to a surface-neutral name would mean a collection migration for
a cosmetic gain.

**Known wart:** the model's name is a slight misnomer for `surface: 'gmscreen'` rows
and for `activeGMScreenId`. Document this in a comment on the fields rather than pay
for a migration; the document is already "per-user campaign state" in everything but
name.

## 3. Server functions

In `app/server/functions/tabletop.ts`, alongside `updatePlayerState`:

- `addPrivateWindow({ campaignId, surface, screenId, collection, documentId, x, y })`
- `removePrivateWindow({ campaignId, privateWindowId })`

Both are **`requireCampaignMember`**, and both write **only** to the caller's own
player-state document (matched on `campaignId` + the authenticated `userId`). Neither
broadcasts. A cap mirroring `GMSCREEN_LIMITS.MAX_WINDOWS` (20) per surface+screen
prevents a user bloating their own document.

`openTabletopWindow` is **unchanged** and stays `requireCampaignGM`.

## 4. Bugs fixed en route

- **`ShowOnTabletopButton` targets the wrong screen.** It uses `screens[0]` — the
  first screen, never the active one (`ShowOnTabletopButton.tsx:34`, comment concedes
  "Phase 1"). The hook reads `activeScreenId` from player state instead; the
  refactored button inherits the fix.
- **Drop-handler divergence.** The tabletop silently no-ops on a duplicate while GM
  Screens focuses + flashes. Both converge on focus + flash, shared with the menu path
  so no fourth copy appears.

## 5. Registry sync (`spell`)

Adding `spell` as a window collection requires **six** coordinated edits, with nothing
enforcing the sync:

1. `app/types/schemas/tabletop.ts` — `TABLETOP_COLLECTIONS`
2. `app/types/schemas/gmscreens.ts` — `SUPPORTED_COLLECTIONS`
3. `app/server/functions/tabletop-hydration.ts` — `COLLECTION_REGISTRY`
4. `app/server/functions/gmscreens.ts` — the second `COLLECTION_REGISTRY`
5. `app/components/mainview/tabletop/TabletopView.tsx` — render branch
6. `app/components/mainview/gmscreens/GMScreensView.tsx` — render branch

A `SpellWindow` component is needed if one does not already exist. This class of bug
has shipped before: `tests/types/schemas/lore-window-collection.test.ts` exists
precisely because a missing allowlist entry silently rejected lore drops server-side,
"caught by e2e, not units."

## 6. Error handling

- **Push with no tabletop screen** → item rendered **disabled with a tooltip**, not
  hidden (matches `ShowOnTabletopButton`'s existing empty-screens behaviour).
- **Already open** → checked against both the shared window list and the caller's
  private list before mutating; focus + flash the existing window.
- **Private window cap exceeded** → server rejects; client shows an inline notice.
- **Mutation failure** → optimistic add rolls back; `captureException` reports. No
  new error surface; matches existing mutation handling.
- **Delete** → keeps each panel's existing confirmation flow unchanged. The menu calls
  the handler the panel already has.

## 7. Testing

**Unit — `useWikiCardActions`** (highest value; no rendering needed):

- GM on Tabletop → Edit, Show on Tab, Push to Tabletop, Delete
- Player on Tabletop → Show on Tab; Edit only when `canEdit`; never Push or Delete
- GM on GM Screens → Show on Tab + Push to Tabletop (push still targets the Tabletop)
- Dashboard → both display actions absent
- No qualifying items → no menu rendered
- Targets `activeScreenId` from player state, **not** `screens[0]`

**Unit — `OverflowMenu`:** Escape closes; click-outside closes; focus returns to the
trigger; arrow keys rove. (New coverage for behaviour `MapCard` never had.)

**Unit — schemas:** extend `tests/types/schemas/lore-window-collection.test.ts` to
assert `spell` parses in both `openTabletopWindowSchema` and `openWindowSchema`.

**Server:** `addPrivateWindow` writes only the caller's document; a non-GM member
succeeds; the cap is enforced; no broadcast is emitted. `activeGMScreenId` round-trips
through `updatePlayerState` and is scoped to the caller.

**Regression:** `GMScreensView` still selects screens correctly after moving
`activeScreenId` from local state to player state, and falls back to the first screen
when `activeGMScreenId` is null (first visit).

**E2E (the assertion units cannot make):** two browsers, GM + player.

- GM uses **Push to Tabletop** → the player's browser **sees** the window.
- Player uses **Show on Tab** → the GM's browser does **not** see it.

This two-browser pair is the entire point of the private/shared split and must not be
skipped.

## 8. Risks

- **Six-way registry sync for `spell`** with no type enforcement. The schema test
  covers two of the six; the render branches and hydration registries are covered only
  by e2e.
- **Players become window-capable for the first time.** `Show on Tab` is the first
  member-level write to the tabletop surface. Mitigated by the write being scoped to
  the caller's own player-state document, but it warrants review.
- **Generalizing from an unverified baseline.** `MapCard`'s menu and
  `ShowOnTabletopButton` have zero unit tests, stories, or e2e coverage today.
- **`GMScreensView` changes behaviour.** Moving `activeScreenId` from local state to
  persisted player state touches a 52-reference component with no player-state
  integration today. This is the least contained part of the change.
- **`TabletopView.tsx` is already ~29 KB and `ActiveMapStage.tsx` ~71 KB.** The render
  merge should not grow them further than necessary; extract the merge into a hook if
  it exceeds a few lines.
