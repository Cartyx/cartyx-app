# Tabletop / Maps — Tech Debt & Refactoring Backlog

Living backlog of refactors and follow-ups identified during the map-editor work
(drawing tool, multi-token group move, GM-only gating) and a three-part code
review (component decomposition, branch quality, PR comments). Use this to scope
a fresh branch + session.

**Status of the big one:** `ActiveMapStage.tsx` has already been reduced from
~2,647 → ~1,679 lines by extracting cohesive modules (geometry, viewport, ruler,
drop-target, token interactions, drawing/text layers, dialogs, map-sync). What
remains below is the **harder, higher-risk, or off-scope** work that was
deliberately deferred.

**Proven extraction pattern (use it again):** move state + handlers + effects
into a `useXxx` hook (or a presentational `XxxLayer` component), **destructure
the hook's return into the same local names** so call sites stay unchanged, keep
anything touching the shared `dragRef` in the parent, preserve every
`data-testid`, and verify against the relevant e2e spec before committing one
extraction at a time.

**Per-item metadata convention.** Each item carries a `Status:` (OPEN/RESOLVED)
and a `Last-verified:` date. Re-verify line counts, file paths, and var names
against the current code before trusting any number here — they drift.

---

## 1. ActiveMapStage: split the text + drawing tool _state_ off the shared `dragRef` (HIGH value, HIGH risk)

- **Status:** OPEN
- **Last-verified:** 2026-06-15

**Files:** `app/components/mainview/tabletop/ActiveMapStage.tsx` (1679 lines)
(target: `useTextTool.ts`, `useDrawingTool.ts`, optionally a `useStageDrag`).

**Why it needs refactoring.** The stage still owns ~1,680 lines because three
tools (pan/token already partly extracted, **text**, **drawing**) share ONE
mutable `dragRef` discriminated union and two large `onPointerMove`/`onPointerUp`
switches. The text- and drawing-tool _state + handlers_ (draft/selection/brush
state, `openTextDraft`/`commitTextDraft`/`applyTextColor`, `removeDrawing`/
`eraseAt`/`beginDrawing*`, plus their focus/deselect/Delete effects) are
**interleaved with each other and with the dragRef branches**, so they can't be
lifted as cleanly as `useTokenInteractions` was.

**Why it's worth it.** These are the last two big concerns keeping the component
huge; isolating them makes each tool independently testable and readable.

**Why it's risky / approach.** The `dragRef` is the coupling point. Recommended:
keep ONE `dragRef` + the two pointer handlers in the parent (or a `useStageDrag`
hook) and have each tool hook expose `{ onPointerDownProbe, onPointerMove,
onPointerUp }` that the parent dispatches in the **exact current priority order**
(ruler → text → drawing → token → pan). Preserve the throttled-broadcast cadence,
the group-delta clamp, the `draftActiveRef` double-commit guard, and the
`requestAnimationFrame` focus deferral. Do this last and behind the unified
dispatch; gate every step on the drawing + text + token + measurement e2e specs.

---

## 2. TabletopView: extract the remaining concerns (MEDIUM value, MEDIUM risk)

- **Status:** OPEN
- **Last-verified:** 2026-06-15

**File:** `app/components/mainview/tabletop/TabletopView.tsx` (783 lines).

The inbound map-sync reducer is already extracted (`useTabletopMapSync`). Still
mixed in one component:

- **`useTabletopModals()`** — the `DialogState` machine plus six `editing*Id`
  states drive a tangle of modal toggles; collapse into one reducer with
  `openX`/`close` actions. _Why:_ the modal wiring is repetitive and easy to get
  out of sync.
- **`useFloatingWindows()`** — `localWindows`/`handleWindowsChange`/
  `localScreenIdRef` and the big server→local window merge effect are a
  self-contained concern. _Why:_ it's the densest logic in the file and unrelated
  to tab/screen management.

See also item 9 for the four `_`-prefixed dead bindings in this file.

_Note:_ the earlier claim of a `react-hooks/exhaustive-deps` warning on the
window-merge effect could **not** be confirmed in the current code — there is no
`eslint-disable` and no inline `exhaustive-deps` annotation in this file, so that
clause has been dropped. If a warning surfaces from `npm run lint`, re-add it
here with the exact line.

---

## 3. GMScreensView decomposition (MEDIUM value, LOW/MEDIUM risk)

- **Status:** OPEN
- **Last-verified:** 2026-06-15

**File:** `app/components/mainview/gmscreens/GMScreensView.tsx` (768 lines).

A single exported component with ~36 hook calls and a debounced-autosave pattern.

- Extract **`useDebouncedSave`** (the `DEBOUNCE_MS` autosave). _Why:_ the
  debounce/flush logic is reusable and currently inlined.
- Consider a **panel/list split**. _Why:_ it's the 2nd-largest tabletop-area
  component; smaller pieces are easier to reason about and test. Skim first to
  confirm the seams before committing.

---

## 4. Wiki modal field primitives + tab split (LOW value, LOW risk)

- **Status:** OPEN
- **Last-verified:** 2026-06-15

**Files:** `app/components/wiki/monsters/MonsterModal.tsx` (842 lines), and the
other 500+ line wiki modals (`CharacterModal`, `PlayerModal`, `LocationModal`).

- `MonsterModal` already splits `StatsTab`/`FeaturesTab`/`LinksTab` and field
  primitives (`NumberField`/`SelectField`/`CSVField`) **within one file** — move
  each tab to its own file and the primitives to `app/components/shared/`.
- **Primitives are NOT duplicated today (confirmed 2026-06-15):** a repo-wide
  grep finds `NumberField`/`SelectField`/`CSVField` only inside `MonsterModal.tsx`
  — no other modal references or re-implements them. So the extraction payoff is
  **low**: it's only worthwhile if you also migrate the other modals onto the
  shared primitives. Don't extract on the assumption of existing duplication.
- **Modal LIFECYCLE has now been extracted** into `useModalForm`
  (`app/hooks/useModalForm.ts`, commit `e8edafa`) and adopted by 3 of the 4
  modals: `CharacterModal`, `PlayerModal`, `RaceModal`. The remaining work is
  **just `LocationModal`** — and migrating it must also fix its latent
  ungated-Escape bug (see item 10).

---

## 5. Minor correctness / perf / hardening follow-ups (LOW)

These are small and independent — good "warm-up" tasks for the new branch.

- **Optimistic drawing create.** (Status: OPEN, Last-verified: 2026-06-15)
  `ActiveMapStage` commits a new drawing only in the mutation's `onSuccess`
  (preview is cleared on pointerup), so on a slow link the shape briefly vanishes
  before reappearing. _Fix:_ keep the preview until the create resolves, or insert
  an optimistic temp entry reconciled on success. (Tokens/text share this
  pattern — consider fixing all three together.)
- **Batch group-move cache writes.** (Status: OPEN, Last-verified: 2026-06-15)
  The token-move drag calls `applyTokenMoveToCache` once per token per frame
  (O(selection) `setQueryData` per mousemove). _Fix:_ batch into a single
  `setQueryData` pass for large selections. Minor perf only.

---

## 6. MapUploadModal cleanup (LOW value, LOW risk)

- **Status:** OPEN
- **Last-verified:** 2026-06-15

**File:** `app/components/wiki/maps/MapUploadModal.tsx` (519 lines).

A sibling candidate to the wiki modal cleanup in item 4. Large single-file modal;
once `useModalForm` (item 4) and any shared field primitives land, this modal is
a natural next adopter. Skim for the same modal-lifecycle boilerplate before
committing.

---

## 7. TabletopView dead-code cleanup (LOW value, LOW risk)

- **Status:** OPEN
- **Last-verified:** 2026-06-15

**File:** `app/components/mainview/tabletop/TabletopView.tsx`.

There are **two** `_`-prefixed bindings that are declared but unused (confirmed
2026-06-15):

- `_toWindowState` — module-level helper function (line ~59).
- `_sessionId` — destructured but unread (line ~90).

(The other two, `_pings`/`_handlePingExpired`, were the stranded ping feature —
deleted outright, not wired up; see the "delete stranded ping code" task.)

Decide per remaining binding: delete if truly dead, or wire up if half-finished.
Do this alongside item 2's extraction so the file shrinks in one pass.

---

## 8. OAuth pre-existing-session one-time revocation gap (LOW, transitional, self-healing)

- **Status:** OPEN (transitional — expected to age out)
- **Last-verified:** 2026-06-15

Commit `81dfa1c` moved OAuth provider tokens out of the `cartyx_session` cookie
into an encrypted (AES-256-GCM) server-side store on the User doc
(`app/server/utils/tokenCrypto.ts`); logout revocation now reads from there.

**Gap:** a user who was already logged in _before_ this change has no provider
token in the new store yet. At their **next logout**, provider-grant revocation
is silently skipped **once**. It self-heals on their next login (which writes the
encrypted token). Low severity, no action strictly required — track only so it
isn't mistaken for a regression. Can be closed once the active-session population
has fully cycled through a login.

---

## 9. Remaining `requireCampaignMember` variants left intentionally un-consolidated (INFO / LOW)

- **Status:** OPEN (intentional — documents a deliberate non-consolidation)
- **Last-verified:** 2026-06-15

Commits `ad8545f` + `d950031` centralized the duplicated `requireCampaignMember`
helper into `app/server/utils/requireCampaignMember.ts` and migrated 10
server-function files. **Three files keep their own local copy on purpose**
because they have different contracts:

- `app/server/functions/notes.ts` (local `requireCampaignMember`, ~line 74)
- `app/server/functions/tags.ts` (local `requireCampaignMember`, ~line 12)
- `app/server/functions/tabletop.ts` (local `requireCampaignMember` ~line 170 and
  a `requireCampaignGM` ~line 204)

They differ in return shape and/or GM semantics (e.g. no `isGM` in the return),
so folding them into the shared helper would change behavior. Only consolidate if
the shared helper is first generalized to cover these contracts without
broadening its surface for the 10 already-migrated callers.

---

## 10. LocationModal: ungated Escape handler + not migrated to `useModalForm` (LOW, latent bug)

- **Status:** OPEN
- **Last-verified:** 2026-06-15

**File:** `app/components/wiki/locations/LocationModal.tsx`.

`LocationModal` was **left unmigrated** from item 4's `useModalForm` extraction
because (a) it has extra non-lifecycle state and (b) its Escape handler is
**ungated** — a latent bug. Confirmed 2026-06-15: the `keydown` listener is
registered in a `useEffect` with deps `[onClose]` and is **not gated on
`isOpen`** (lines ~62–68), even though the component early-returns `null` when
`!isOpen` (line ~161). So while the modal is mounted-but-closed, a global Escape
press still fires `onClose()`.

_Fix as part of migrating it:_ gate the handler on `isOpen` (or only attach the
listener while open), then move the shared lifecycle onto `useModalForm` like the
other three modals. Verify the location wiki e2e flow afterward.

---

## 11. Exact-pinned transitive `overrides` need manual review (LOW, recurring)

- **Status:** OPEN
- **Last-verified:** 2026-07-28

**File:** `package.json` → `overrides`.

Two transitive dependencies are pinned to an **exact** version to clear
`npm audit --audit-level=high --omit=dev`, which is a blocking CI step:

| Package   | Pin      | Advisory it clears                | Dependent's declared range               |
| --------- | -------- | --------------------------------- | ---------------------------------------- |
| `js-yaml` | `4.3.0`  | GHSA-52cp-r559-cp3m (≤ 4.2.0)     | `^4.1.1` (xmlbuilder2, @eslint/eslintrc) |
| `postcss` | `8.5.19` | PostCSS path traversal (≤ 8.5.17) | vite                                     |

They are exact rather than `^` on purpose: a caret would float the lockfile onto
whatever released most recently, which regularly lands inside the **10-day
cooldown** that `npm run check:deps-age` enforces (both had a patch published
within 4 days at the time of pinning).

**The catch:** Dependabot does not update `overrides`, and neither package is a
direct dep, so nothing will ever propose a bump. When the next advisory lands on
either one, `npm audit` fails in CI with no PR explaining why. Fix by hand:
choose the lowest patched version that is **≥ 10 days old** and still satisfies
the dependent's range, then re-run `npm audit --audit-level=high --omit=dev` and
`npm run check:deps-age`. Drop the override entirely once the dependent's own
floor moves past the advisory.

---

## 12. Storybook was broken end-to-end — RESOLVED (2026-07-28)

- **Status:** RESOLVED
- **Last-verified:** 2026-07-28

Storybook could not build **or** run, and nothing in CI noticed because
`test:ci` is `--project unit` only. Four distinct faults, fixed together:

1. **The preview build inherited the app's server plugins.** Storybook's
   react-vite builder auto-loads the root `vite.config.ts`, which includes
   `nitro()` and `tanstackStart()`. `main.ts` tried to strip them by plugin-name
   prefix, but both factories return **nested arrays** and the filter only
   checked top-level entries — so it matched nothing. Failure was
   `[tanstack-start:start-manifest-capture-client-build] multiple entries
detected`. Fixed by giving Storybook its own `.storybook/vite.config.ts`
   (react + tailwind + tsconfig paths) wired via `framework.options.builder.viteConfigPath`,
   instead of blocklisting names — which silently stops working whenever an
   upstream plugin is renamed.
2. **Server code was pulled into the browser bundle.** Without the Start plugin
   stripping server-fn bodies, the `await import('~/server/…')` inside every
   hook dragged mongoose, the MongoDB driver and `@sentry/node-core` in.
   `~/server/**` is now aliased to `.storybook/mocks/serverFunctions.ts`, and
   `@tanstack/react-start` (which reaches `node:async_hooks`) to
   `.storybook/mocks/react-start.ts`.
3. **`useParams` threw in every play-route panel.** `WikiPanel`, `NotesPanel`,
   `SettingsPanel` and `ChatPanel` all call
   `useParams({ from: '/campaigns/$campaignId/play' })`, which needs a
   RouterProvider — taking `InspectorSidebar` and `MainView` down with them
   (both mount every tab panel at once). `.storybook/mocks/router.tsx` now
   overrides `useParams`/`useSearch`/`useNavigate` alongside the existing `Link`
   override.
4. **Stories missing required props.** `ChatPanel` (rendered with no args at
   all), `TabletopView` (`currentUserId`/`openToolWindows`/`onCloseToolWindow`),
   `NotesFilterWidget` (`campaignId`/`filterTags`/`onFilterTagsChange`) — all
   props added to components without updating their fixtures.

Result: **167 stories across 48 files pass**, and `build-storybook` succeeds. A
**Storybook CI job** now runs `test:storybook` plus `build-storybook`, so this
cannot rot silently again.

Related: `WikiCardActionsStubProvider` supplies the wiki-card-actions context to
stories whose components reach `useWikiCardActions` (the real provider cannot
mount outside `/play`), and
`tests/components/wiki/shared/WikiCardActionsStubProvider.test.tsx` guards that
class of breakage from the unit project too.

---

## Resolved

Items closed on the `update-tech-debt` branch (on top of `origin/dev`) and
earlier map-editor work. Kept for traceability.

- **`tabletop-map` party `onRequest` auth — RESOLVED (earlier, commit `1f8871b`).**
  The HTTP broadcast endpoint is no longer unauthenticated. `onRequest` now
  requires a signed **`tabletop-broadcast`** JWT (HS256, verified against
  `SESSION_SECRET`, `scope === 'tabletop-broadcast'`) before accepting a
  `map:active-changed` POST — now `realtime/src/parties/tabletopMap.ts`
  (`onRequest`), after the PartyKit `party/` directory was retired.
  Confirmed 2026-06-15.
- **`listMapTokens` IDOR — RESOLVED (commit `7887a43`).** `listMapTokens` is now
  scoped by `campaignId`, closing the cross-campaign read.
- **`requireCampaignMember` duplication — RESOLVED (commits `ad8545f`,
  `d950031`).** Centralized into `app/server/utils/requireCampaignMember.ts`; 10
  server-function files migrated. (Three intentionally retained — see open item 9.)
- **OAuth provider tokens hardening — RESOLVED (commits `81dfa1c`, `b469bcb`).**
  Provider tokens moved out of the `cartyx_session` cookie into an encrypted
  (AES-256-GCM) server-side store on the User doc
  (`app/server/utils/tokenCrypto.ts`); logout revocation reads from there.
  (One transitional gap remains — see open item 8.)
- **OAuth PKCE — RESOLVED (commit `af4f13d`).** Added PKCE (S256) to the
  authorization-code flow for all three providers.
- **Mutation-hook duplication — RESOLVED (commit `0613a24`).** Extracted a
  `createMutationHook` factory + shared `extractErrorMessage`
  (`app/utils/errors.ts`); ~20 mutation hooks migrated.
- **Shared wiki modal lifecycle — RESOLVED for 3 of 4 (commit `e8edafa`).**
  Extracted `useModalForm` (`app/hooks/useModalForm.ts`); Character/Player/Race
  modals migrated. (LocationModal remains — see open item 10.)
- **e2e now runs in CI + supply-chain guard now enforcing — RESOLVED (commits
  `dba040e`, `1de2a26`, `5e677be`).** Added a Playwright e2e job (mongo:8 service)
  to `.github/workflows/ci.yml`; removed `continue-on-error` from the
  `check:deps-age` step so it is now blocking (its sunset window has passed); and
  fixed `scripts/seed-gm.cjs` so the fresh-DB e2e bootstrap produces a queryable
  GM user.

---

## Verification checklist (per the repo conventions)

For every change in the new session. **Establish the baseline first** by running
each command on a clean checkout, then ensure your change doesn't regress it
(numbers drift — capture them at the start of the session rather than trusting any
hardcoded count here):

- `npm run typecheck` — clean (no errors).
- `npm run lint` — record the starting error/warning counts; keep errors at 0 and
  do not introduce new warnings. (Run it once up front to get today's baseline.)
- `npm test` (`vitest run --project unit`) — record the starting passing-test
  count from the run summary, then keep it green and non-decreasing.
- Relevant + full `e2e/tabletop` and `e2e/gmscreens` suites green, run serially:
  `--project=chromium --reporter=line --workers=1`. Run new/changed specs 2–3×
  for flake.
- Server-side model/server-fn changes require restarting the dev server
  (`lsof -ti tcp:3000 | xargs kill`, then `npm run dev`); party changes require
  restarting `npm run party:dev`.
- Commit one extraction at a time, conventional-commit style, ending with the
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` line.
