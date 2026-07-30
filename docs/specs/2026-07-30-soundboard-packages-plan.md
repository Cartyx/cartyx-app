# Packages and the GM Board — Implementation Plan (Phase 2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship packages, moods, a ported Web Audio engine and a live GM board, with playback local to the GM's browser.

**Architecture:** Every GM action is a command. A pure reducer applies commands to board state; a Web Audio engine ported from the `ttrpg-sfx` POC reconciles the audio graph against that state; debounced snapshots persist per campaign. Packages are per-user with a nullable owner for system packages; moods reference package items and may override volume, fade and random interval.

**Tech Stack:** TanStack Start (React 19), Mongoose, Zod, Web Audio API, Vitest, Storybook (real-browser), Playwright.

**Design spec:** [2026-07-30-soundboard-packages-design.md](./2026-07-30-soundboard-packages-design.md)
**Programme scope:** [2026-07-28-soundboard-roadmap.md](./2026-07-28-soundboard-roadmap.md)
**Phase 1 (built):** [2026-07-28-audio-library-design.md](./2026-07-28-audio-library-design.md)

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Branch:** work on `soundboard-phase2`. Every PR targets `dev`. NEVER open a PR against `main`.
- **`npm run lint` runs with `--max-warnings 0`** — any new warning fails CI.
- **`npm run typecheck` must be clean** (0 errors).
- **Unit tests mock mongoose** — per-method model mocks, no in-memory Mongo. Follow `tests/server/functions/audio-mutations.test.ts`.
- **Every new component needs a `.stories.tsx`** — `npm run test:storybook` runs stories in a real browser and blocks CI.
- **New npm packages must be published ≥10 days ago** and pass `npm run check:deps-age`.
- **Telemetry:** client `captureException`/`captureEvent` from `~/utils/telemetry-client`; server `serverCaptureException`/`serverCaptureEvent` from `~/server/utils/telemetry`. **The server signature is `(distinctId, event, properties)`** — phase 1's plan got this backwards and it shipped. Never `await` capture calls.
- **Identity:** `requireActor()` in `app/utils/audio-server-fns.ts` resolves the OAuth provider id to the Mongo `_id` via `User.findOne({ providerId: session.id })` and returns `{ userId, sessionUserId }`. **`userId` (Mongo `_id`) is the only value that may scope a query; `sessionUserId` (the provider id) is telemetry-only.** Phase 1 shipped the provider id into queries and every audio query `CastError`ed; only the e2e caught it. (This plan originally called the helper `requireUserId()` — no such export exists. Corrected 2026-07-29.)
- **Ids reaching Mongo must be ObjectId-validated in the Zod schema**, not at the call site. See `objectId` in `app/types/schemas/audio.ts`.
- **Every array field in a Zod schema needs a `.max()`.** Phase 1 shipped one uncapped `tags` array straight into a `$all` query.

### On the code in this plan

The snippets below are **starting points, not authority**. Phase 1's plan carried comparably detailed snippets and **fourteen were wrong** — a swapped `serverCaptureEvent` signature, a test harness that could not run under the repo's global mongoose mock, a Helm helper that did not exist, a `$ne: null` guard that was a tautology, an assertion that passed regardless of the code.

Verify every snippet against the actual API before trusting it. Where a snippet contradicts the codebase, the codebase wins — say so in your report rather than making the codebase match the plan.

### On fixtures

Three separate times in phase 1, a test passed because its **fixture's shape masked the effect under test** — a sine wave with no encoder padding, an MP3 that hid a half-fix a FLAC exposed, a file that was over-cap _and_ multi-format so it passed on the wrong property. When you write a fixture, ask what shape would make this test pass for the wrong reason, and use that shape.

---

## File Structure

**Create:**

| Path                                              | Responsibility                                   |
| ------------------------------------------------- | ------------------------------------------------ |
| `app/types/soundboard.ts`                         | Shared types, defaults, caps                     |
| `app/types/schemas/soundboard.ts`                 | Zod schemas for every soundboard server function |
| `app/server/db/models/AudioPackage.ts`            | Package model with embedded items and moods      |
| `app/server/db/models/SoundboardState.ts`         | Per-campaign live state                          |
| `app/server/functions/packages.ts`                | Package CRUD, clone, and the visibility rule     |
| `app/server/functions/soundboard.ts`              | Board state load/save                            |
| `app/utils/soundboard-server-fns.ts`              | `createServerFn` wrappers                        |
| `app/lib/soundboard/resolve.ts`                   | `mood ?? item` resolution — pure                 |
| `app/lib/soundboard/commands.ts`                  | Command types                                    |
| `app/lib/soundboard/reducer.ts`                   | Command → board state — pure                     |
| `app/lib/soundboard/engine.ts`                    | Web Audio engine, ported from the POC            |
| `app/lib/soundboard/scheduler.ts`                 | Random one-shot scheduler                        |
| `app/hooks/useSoundboard.ts`                      | Wires reducer + engine + persistence             |
| `app/components/soundboard/*`                     | Package editor, mood editor, board               |
| `app/routes/audio/packages.tsx`                   | Package list                                     |
| `app/routes/audio/packages.$packageId.tsx`        | Package editor                                   |
| `app/routes/campaigns/$campaignId/soundboard.tsx` | The board                                        |

**Modify:**

| Path                                        | Change                                                        |
| ------------------------------------------- | ------------------------------------------------------------- |
| `app/utils/queryKeys.ts`                    | `queryKeys.packages`, `queryKeys.soundboard`                  |
| `app/components/audio/AudioAssetDetail.tsx` | Attach a `∞`/`1×` once-variant                                |
| `app/server/functions/audio.ts`             | Ingest path writing `onceRenditions`; package prune on delete |
| `audio-worker/src/process.ts`               | Write to `onceRenditions` when the row says so                |
| `vitest.config.ts`                          | Third `browser` project for the engine tests (Task 10)        |
| `package.json`                              | `test:browser` script (Task 10)                               |
| `.github/workflows/ci.yml`                  | Run `test:browser` in the existing storybook job (Task 10)    |

**`app/lib/` does not exist yet.** The engine is framework-agnostic on purpose — it must be testable without React — so it gets a new directory rather than living under `app/utils/`, which is app-glue. Say so in the Task 8 commit.

### Routing shape — verify before Task 13

`app/routes/audio.tsx` is a **flat** 17 KB leaf route. `app/routes/campaigns/$campaignId/` is a **directory** with no `$campaignId.tsx` layout beside it, so Task 17's `app/routes/campaigns/$campaignId/soundboard.tsx` matches the existing convention exactly and needs nothing special.

Tasks 13 and 14 are the risk: adding a directory `app/routes/audio/` beside the flat `audio.tsx` makes `audio.tsx` a **layout** for its children, and `/audio` will render nothing new unless that file gains an `<Outlet />` — or breaks outright. **Verify what the generated `routeTree.gen.ts` actually produces and confirm `/audio` still renders its own page** before committing.

**RESOLVED IN TASK 13 (2026-07-30).** This section originally suggested the flat dotted form `app/routes/audio.packages.tsx` as the non-nesting fallback. **That suggestion was wrong** — Task 13 built it, inspected the generated tree, and found `getParentRoute: () => AudioRoute`. A dot is a path separator in TanStack Router's flat convention, so it nests exactly like a directory does.

The correct non-nesting convention is a **trailing underscore on the parent segment**: `app/routes/audio_.packages.tsx`, `app/routes/audio_.packages.$packageId.tsx`. Verified: `AudioRoute` came back a plain childless leaf and `app/routes/audio.tsx` has zero diff. **Task 14 must use `audio_.` too** — repeating the dotted form silently turns the library page into a layout.

---

## Task 1: Types, caps and Zod schemas

**Files:**

- Create: `app/types/soundboard.ts`, `app/types/schemas/soundboard.ts`
- Test: `tests/types/soundboard-schemas.test.ts`

**Interfaces:**

- Consumes: `objectId` from `~/types/schemas/audio`.
- Produces: `MAX_PACKAGE_ITEMS` (64), `MAX_PACKAGE_MOODS` (32), `PackageItemData`, `MoodData`, `AudioPackageData`, `BoardStateData`; schemas `createPackageSchema`, `updatePackageSchema`, `packageItemSchema`, `moodSchema`, `clonePackageSchema`, `deletePackageSchema`, `saveBoardStateSchema`, `loadBoardStateSchema`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/types/soundboard-schemas.test.ts
import { describe, it, expect } from 'vitest';

describe('soundboard schemas', () => {
  it('rejects more than MAX_PACKAGE_ITEMS items', async () => {
    const { updatePackageSchema } = await import('~/types/schemas/soundboard');
    const { MAX_PACKAGE_ITEMS } = await import('~/types/soundboard');
    const item = () => ({
      id: 'i1',
      assetId: '507f1f77bcf86cd799439011',
      volume: 0.8,
      fadeSeconds: 1,
      loop: true,
    });
    const r = updatePackageSchema.safeParse({
      id: '507f1f77bcf86cd799439011',
      items: Array.from({ length: MAX_PACKAGE_ITEMS + 1 }, item),
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-ObjectId assetId before it can reach Mongo', async () => {
    const { packageItemSchema } = await import('~/types/schemas/soundboard');
    expect(packageItemSchema.safeParse({ id: 'i1', assetId: 'nope' }).success).toBe(false);
  });

  it('mood overrides are optional but bounded when present', async () => {
    const { moodSchema } = await import('~/types/schemas/soundboard');
    const ok = moodSchema.safeParse({
      id: 'm1',
      name: 'Overhead',
      states: [{ itemId: 'i1', playing: true }],
    });
    expect(ok.success).toBe(true);

    const bad = moodSchema.safeParse({
      id: 'm1',
      name: 'Overhead',
      states: [{ itemId: 'i1', playing: true, volume: 5 }],
    });
    expect(bad.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --project unit tests/types/soundboard-schemas.test.ts`
Expected: FAIL — cannot resolve `~/types/schemas/soundboard`.

- [ ] **Step 3: Write the types**

`app/types/soundboard.ts` exports the caps (`MAX_PACKAGE_ITEMS = 64`, `MAX_PACKAGE_MOODS = 32`), sensible defaults (`DEFAULT_FADE_SECONDS`, `DEFAULT_VOLUME`), and the data types the client consumes. Model it on `app/types/audio.ts` — same shape, same export style.

- [ ] **Step 4: Write the schemas**

`app/types/schemas/soundboard.ts`. **Every array gets a `.max()`; every id uses the `objectId` refinement from `~/types/schemas/audio`.** Volumes are `z.number().min(0).max(1)`; fades `z.number().min(0).max(30)`; random intervals positive integers with `min <= max` enforced by `.refine()`.

- [ ] **Step 5: Run tests, then typecheck and lint**

Run: `npx vitest run --project unit tests/types/soundboard-schemas.test.ts && npm run typecheck && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add app/types/soundboard.ts app/types/schemas/soundboard.ts tests/types/soundboard-schemas.test.ts
git commit -m "feat(soundboard): package and board types with bounded schemas"
```

---

## Task 2: `AudioPackage` model

**Files:**

- Create: `app/server/db/models/AudioPackage.ts`
- Test: `tests/server/db/audio-package-model.test.ts`

**Interfaces:**

- Consumes: caps from Task 1.
- Produces: `AudioPackage` model, `IAudioPackage`.

**Read `app/server/db/models/AudioAsset.ts` first** — it is the closest sibling and establishes the house idiom (the `mongoose.models.X ||` guard, the `// istanbul ignore next` index block, `InferSchemaType`).

**The model test must use the `vi.unmock('mongoose')` + dynamic-reimport pattern** from `tests/server/db/audio-asset-model.test.ts`. The repo's global mock in `tests/setup.ts` makes `mongoose.model()` return a plain object, so `new AudioPackage(...)` throws otherwise. Phase 1's plan missed this and the whole test file was unrunnable.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/db/audio-package-model.test.ts
// NOTE: copy the beforeAll/afterAll vi.unmock('mongoose') scaffolding from
// tests/server/db/audio-asset-model.test.ts verbatim — without it every
// `new AudioPackage(...)` throws "not a constructor".

it('allows a null ownerId, which is what makes a package a system package', async () => {
  const doc = new AudioPackage({ ownerId: null, name: 'Tavern' });
  await expect(doc.validate()).resolves.toBeUndefined();
});

it('requires a name', async () => {
  const doc = new AudioPackage({ ownerId: null });
  await expect(doc.validate()).rejects.toBeTruthy();
});

it('indexes ownerId so the visibility query is served', async () => {
  const idx = AudioPackage.schema.indexes().map(([spec]) => spec);
  expect(idx).toContainEqual(expect.objectContaining({ ownerId: 1 }));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --project unit tests/server/db/audio-package-model.test.ts`

- [ ] **Step 3: Write the model**

Embedded `packageItemSchema` and `moodSchema` sub-schemas with `{ _id: false }`. `ownerId` is `{ type: ObjectId, ref: 'User', default: null }` — **nullable is the whole mechanism for system packages**, so it must not be `required`. Index `{ ownerId: 1 }` and `{ ownerId: 1, name: 1 }`.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add app/server/db/models/AudioPackage.ts tests/server/db/audio-package-model.test.ts
git commit -m "feat(soundboard): AudioPackage model with nullable owner for system packages"
```

---

## Task 3: `SoundboardState` model

**Files:**

- Create: `app/server/db/models/SoundboardState.ts`
- Test: `tests/server/db/soundboard-state-model.test.ts`

**Interfaces:**

- Produces: `SoundboardState` model, `ISoundboardState`.

Keyed by `campaignId` with a **unique** index — one live state per campaign. Fields: `campaignId`, `packageId`, `moodId`, `items[] { itemId, playing, volume }`, `masterVolume`, `updatedBy`, `updatedAt`.

Same `vi.unmock('mongoose')` test scaffolding as Task 2.

- [ ] **Step 1–5:** Mirror Task 2's shape. The test that matters: **the unique index on `campaignId` exists**, since last-write-wins depends on there being exactly one document to write.

```bash
git commit -m "feat(soundboard): per-campaign live board state model"
```

---

## Task 4: Package CRUD and the visibility rule

**Files:**

- Create: `app/server/functions/packages.ts`
- Test: `tests/server/functions/packages.test.ts`

**Interfaces:**

- Consumes: `AudioPackage` (Task 2), schemas (Task 1).
- Produces: `listPackages({ userId })`, `getPackage({ data, userId })`, `createPackage`, `updatePackage`, `deletePackage`, and **`packageVisibilityFilter(userId)`**.

**This is the security-critical task.** Phase 1 scoped every audio read by `ownerId`; this is the first consumer that legitimately reads records it does not own.

The rule, from the design: **a package is visible if it is owned by the caller or is a system package.** Express it once:

```ts
export function packageVisibilityFilter(userId: string) {
  return { $or: [{ ownerId: userId }, { ownerId: null }] };
}
```

Every read uses it. Every **write** uses `{ _id, ownerId: userId }` — never the visibility filter — because a system package must not be mutable.

- [ ] **Step 1: Write the failing tests**

The tests that matter are the negative ones. Assert on the **actual query arguments**, not on a mocked return value — phase 1 shipped a "refuses another user's asset" test that mocked `findOne` to return `null` unconditionally and would have passed with the ownership clause deleted.

```ts
it('reads are visible to the owner and to everyone for system packages', async () => {
  const { listPackages } = await import('~/server/functions/packages');
  await listPackages({ userId: 'u1' });
  expect(vi.mocked(AudioPackage.find).mock.calls[0][0]).toEqual({
    $or: [{ ownerId: 'u1' }, { ownerId: null }],
  });
});

it('updates are owner-scoped, so a system package cannot be mutated', async () => {
  const { updatePackage } = await import('~/server/functions/packages');
  await updatePackage({ data: { id: 'p1', name: 'x' }, userId: 'u1' }).catch(() => {});
  const filter = vi.mocked(AudioPackage.findOneAndUpdate).mock.calls[0][0];
  expect(filter).toEqual({ _id: 'p1', ownerId: 'u1' });
  expect(filter).not.toHaveProperty('$or');
});

it('deletes are owner-scoped too', async () => {
  /* same shape against deleteOne */
});
```

- [ ] **Step 2:** Run and watch fail.
- [ ] **Step 3:** Implement. Follow the structure of `app/server/functions/audio.ts` — `ensureDb()`, try/catch with un-awaited `serverCaptureException`, a `serialize*` function at the boundary.
- [ ] **Step 4:** `npx vitest run --project unit tests/server/functions/` — no regressions.
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(soundboard): package CRUD with a single visibility rule"
```

---

## Task 5: Clone a package

**Files:**

- Modify: `app/server/functions/packages.ts`
- Test: `tests/server/functions/packages-clone.test.ts`

**Interfaces:**

- Produces: `clonePackage({ data, userId })` → `AudioPackageData`.

Clone reads through the **visibility** filter (so you can clone a system package) and writes a new document with `ownerId = userId`. Item and mood `id`s are preserved so mood→item references survive; only `_id` and `ownerId` change.

- [ ] **Step 1: The test that matters**

```ts
it('clones a system package into the caller, preserving mood->item references', async () => {
  vi.mocked(AudioPackage.findOne).mockResolvedValue({
    _id: 'sys1',
    ownerId: null,
    name: 'Tavern',
    items: [{ id: 'i1', assetId: 'a1' }],
    moods: [{ id: 'm1', name: 'Busy', states: [{ itemId: 'i1', playing: true }] }],
  } as never);
  const { clonePackage } = await import('~/server/functions/packages');
  await clonePackage({ data: { id: 'sys1' }, userId: 'u1' });

  const created = vi.mocked(AudioPackage.create).mock.calls[0][0] as Record<string, unknown>;
  expect(created.ownerId).toBe('u1');
  // The reference must still resolve — a clone that renumbers items silently
  // breaks every mood in the package.
  expect((created.moods as { states: { itemId: string }[] }[])[0].states[0].itemId).toBe(
    (created.items as { id: string }[])[0].id
  );
});
```

- [ ] **Steps 2–5:** Run, implement, verify, commit.

```bash
git commit -m "feat(soundboard): clone a package, preserving mood references"
```

---

## Task 6: Board state load and save

**Files:**

- Create: `app/server/functions/soundboard.ts`
- Test: `tests/server/functions/soundboard-state.test.ts`

**Interfaces:**

- Produces: `loadBoardState({ data, userId })`, `saveBoardState({ data, userId })`.

**Use the exported shared helper `requireCampaignMember(campaignId)` from `app/server/utils/requireCampaignMember.ts`** — it returns `{ userId, sessionUserId, isGM }`. Do **not** copy `requireGmOfCampaign` out of `cleanup.ts`: that one is module-private and GM-only, and this plan's original pointer to `cleanup.ts:152` was wrong. Reuse rather than reinventing — phase 1's review found a campaign-authorized function enumerating per-user data, and this is the mirror risk.

**Asymmetric scope, decided 2026-07-29:**

- `loadBoardState` requires **membership** — a player reading state is 2b's resync path and costs nothing to allow now.
- `saveBoardState` requires **`isGM`** — throw `Forbidden` otherwise. In 2a the GM's browser is the sole authority by construction; the design's two-GMs case is last-write-wins _between GMs_. The plan originally said membership for both, which left the live board writable by every player at the table.

`saveBoardState` is an **upsert** keyed on `campaignId`. Last-write-wins, stamping `updatedBy`.

- [ ] **Step 1: The tests that matter**

```ts
it('refuses a caller who is not in the campaign', async () => {
  /* assert the membership check runs BEFORE any model call */
});

it('refuses a save from a non-GM member', async () => {
  // requireCampaignMember resolves with isGM: false; SoundboardState
  // must not be touched. Assert `findOneAndUpdate` was NOT called —
  // asserting only that the promise rejects passes with the guard deleted
  // if some later line happens to throw.
});

it('upserts on campaignId so a campaign never accumulates two states', async () => {
  const { saveBoardState } = await import('~/server/functions/soundboard');
  await saveBoardState({ data: { campaignId: 'c1', masterVolume: 0.8 }, userId: 'u1' });
  const [filter, , opts] = vi.mocked(SoundboardState.findOneAndUpdate).mock.calls[0];
  expect(filter).toEqual({ campaignId: 'c1' });
  expect(opts).toMatchObject({ upsert: true });
});
```

- [ ] **Steps 2–5:** Run, implement, verify, commit.

```bash
git commit -m "feat(soundboard): per-campaign board state load and save"
```

---

## Task 7: Server-fn wrappers and query keys

**Files:**

- Create: `app/utils/soundboard-server-fns.ts`
- Modify: `app/utils/queryKeys.ts`
- Test: `tests/utils/soundboard-server-fns.test.ts`

**Interfaces:**

- Produces: `listPackagesFn`, `getPackageFn`, `createPackageFn`, `updatePackageFn`, `deletePackageFn`, `clonePackageFn`, `loadBoardStateFn`, `saveBoardStateFn`; `queryKeys.packages.*`, `queryKeys.soundboard.*`.

**Copy the structure of `app/utils/audio-server-fns.ts` exactly**, including its `requireActor()` — that function resolves the provider id to the Mongo `_id`, and getting it wrong broke every query in phase 1. Note its dynamic `await import('~/server/session')` inside each handler; the file explains why a module-scope import breaks the client bundle. Do not export a duplicate copy of `requireActor` from this new file if the existing one can be shared — check first and say which you did.

Query keys **nest under the existing `queryKeys` object** (`queryKeys.packages`, not a standalone `packageKeys`). All ~24 domains in that file nest; there is no `<domain>Keys` precedent.

- [ ] **Step 1: The test that matters** — mirror `tests/utils/audio-server-fns.test.ts`: for every wrapper, a null session rejects **and** the underlying function is `not.toHaveBeenCalled()`. The negative assertion is the one that protects the auth gate.

- [ ] **Steps 2–5:** Run, implement, verify, commit.

```bash
git commit -m "feat(soundboard): server-fn wrappers and query keys"
```

---

## Task 8: Mood resolution — `mood ?? item`

**Files:**

- Create: `app/lib/soundboard/resolve.ts`
- Test: `tests/lib/soundboard/resolve.test.ts`

**Interfaces:**

- Produces: `resolveItemState(item, moodState | undefined)` → `{ playing, volume, fadeSeconds, randomIntervalMin, randomIntervalMax, loop, assetId }`.

**This is the highest-risk pure function in the phase.** It is the two-record merge the design flags, and phase 1 produced repeated bugs at exactly this kind of seam.

The rule: **an override applies only when present.** `undefined` inherits; `0` and `false` are values, not absence. `volume: 0` in a mood means silent, not "inherit".

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/soundboard/resolve.test.ts
const item = {
  id: 'i1',
  assetId: 'a1',
  volume: 0.8,
  fadeSeconds: 2,
  loop: true,
  randomIntervalMin: 30,
  randomIntervalMax: 90,
};

it('inherits every field when the mood overrides nothing', () => {
  expect(resolveItemState(item, { itemId: 'i1', playing: true })).toMatchObject({
    volume: 0.8,
    fadeSeconds: 2,
    randomIntervalMin: 30,
  });
});

it('treats an explicit 0 as a value, not as absence', () => {
  // The bug this catches: `moodState.volume || item.volume` yields 0.8 here.
  const r = resolveItemState(item, { itemId: 'i1', playing: true, volume: 0 });
  expect(r.volume).toBe(0);
});

it('treats an explicit false the same way', () => {
  const r = resolveItemState(item, { itemId: 'i1', playing: false });
  expect(r.playing).toBe(false);
});

it('lets one item fire at different rates in different moods', () => {
  const overhead = resolveItemState(item, { itemId: 'i1', playing: true });
  const distant = resolveItemState(item, {
    itemId: 'i1',
    playing: true,
    randomIntervalMin: 180,
    randomIntervalMax: 300,
  });
  expect(overhead.randomIntervalMin).toBe(30);
  expect(distant.randomIntervalMin).toBe(180);
});

it('resolves to not-playing when the mood omits the item entirely', () => {
  expect(resolveItemState(item, undefined).playing).toBe(false);
});
```

- [ ] **Step 2:** Run and watch fail.
- [ ] **Step 3:** Implement with `??`, never `||`. The `0`/`false` tests exist specifically to fail against `||`.
- [ ] **Step 4:** Run to verify.
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(soundboard): mood-over-item resolution"
```

---

## Task 9: Commands and the reducer

**Files:**

- Create: `app/lib/soundboard/commands.ts`, `app/lib/soundboard/reducer.ts`
- Test: `tests/lib/soundboard/reducer.test.ts`

**Interfaces:**

- Consumes: `resolveItemState` (Task 8).
- Produces: `SoundboardCommand` union, `boardReducer(state, command)` → `BoardState`, `initialBoardState(pkg)`.

```ts
export type SoundboardCommand =
  | { type: 'loadPackage'; pkg: AudioPackageData }
  | { type: 'setMood'; moodId: string }
  | { type: 'play'; itemId: string }
  | { type: 'stop'; itemId: string }
  | { type: 'fireOneShot'; itemId: string }
  | { type: 'setItemVolume'; itemId: string; volume: number }
  | { type: 'setMasterVolume'; volume: number }
  | { type: 'stopAll' };
```

`loadPackage` carries the resolved `pkg`, not a bare `packageId` — this was
`packageId: string` when this plan was written, corrected during Task 9's
implementation. Reason: `packageVisibilityFilter` scopes every package read
to the owner or a system package, so a player receiving an id-only
`loadPackage` broadcast could not fetch a GM-owned package by that id at
all. Carrying `pkg` means whoever dispatches the command already proved
they could see it.

The reducer is **pure** — no audio, no network, no `Date.now()`. That is what makes it exhaustively testable and what lets 2b replay commands.

- [ ] **Step 1: Write the failing tests**

```ts
it('setMood resolves every item, not just the ones the mood names', () => {
  // An item absent from the mood's states must resolve to not-playing —
  // otherwise switching mood leaves the previous scene's tracks running.
});

it('stopAll leaves the package and mood loaded', () => {
  // Regression guard: stopping is not unloading.
});

it('setItemVolume on a non-playing item persists for when it starts', () => {});

it('is pure — the same command twice yields deep-equal state', () => {
  const a = boardReducer(s, { type: 'play', itemId: 'i1' });
  const b = boardReducer(s, { type: 'play', itemId: 'i1' });
  expect(a).toEqual(b);
});
```

- [ ] **Steps 2–5:** Run, implement, verify, commit.

```bash
git commit -m "feat(soundboard): command vocabulary and pure board reducer"
```

---

## Task 10: The Web Audio engine

**Files:**

- Create: `app/lib/soundboard/engine.ts`
- Test: `app/lib/soundboard/engine.browser.test.ts` (real browser)
- Modify: `vitest.config.ts`, `package.json`, `.github/workflows/ci.yml`

**Interfaces:**

- Produces: `createEngine(ctx)` → `{ apply(state), dispose() }`.

### The test vehicle — read this before writing a line of engine code

The plan originally specified `app/lib/soundboard/engine.stories.tsx`. **That file would never have run.** `.storybook/main.ts` globs `stories: ['../app/components/**/*.stories.@(ts|tsx)']`, so a story under `app/lib/` is not collected — `npm run test:storybook` would have reported success having executed zero engine assertions. That is the exact "green suite, broken feature" failure this plan warns about, so the vehicle changed (decided 2026-07-29).

Add a **third vitest project** instead. The engine is not a component and should not be dressed as one to get a browser.

1. In `vitest.config.ts`, add a project alongside `unit` and `storybook`:

```ts
{
  extends: true,
  test: {
    name: 'browser',
    include: ['app/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
    setupFiles: [],
  },
}
```

`setupFiles: []` is deliberate — `tests/setup.ts` mocks mongoose and is irrelevant here.

2. `package.json`: `"test:browser": "vitest run --project browser"`.
3. `.github/workflows/ci.yml`: add a `Run browser tests` step to the **existing `storybook` job**, after `Run story tests`. That job already runs `npx playwright install --with-deps chromium`, so reusing it costs seconds; a new job would pay the chromium install again. Rename the job's `name:` to `Storybook & browser tests` to keep the CI check label honest.
4. Confirm the `unit` project does not also collect the file — its include is `tests/**/*.test.{ts,tsx}`, so `app/**` is out of scope. Verify rather than assume: run `npm test` and check the engine file is absent from the run.

**Verification that the vehicle works, before trusting any assertion:** make one assertion fail on purpose, run `npm run test:browser`, and confirm you see a _failing_ test. A suite that collects nothing also exits 0.

**Port, do not rewrite.** Read `~/Developer/ttrpg-sfx/docs/soundboard.md` in full first. Its behaviour has measured evidence; reimplementing from scratch throws that away.

Carry over exactly:

1. `BufferSource → per-track GainNode → masterGain → destination`.
2. **The fade-interrupt fix.** On stop: `cancelScheduledValues(now)` → `setValueAtTime(g.gain.value, now)` → `linearRampToValueAtTime(0, now + fade)`. Without the middle line, interrupting a fade-in leaps to full volume before fading out.
3. **The stale-source guard.** `src.onended = () => { if (s.source === src) clear(name); }`. Without the identity check, a fast off/on has the old source clear the new pad.
4. Retrigger vs toggle; a 15 ms ramp on immediate stop so retriggering does not click.
5. Loop flip mid-play via `startedAt`.

**New, and not in the POC:**

```ts
// The POC could trust source.loop because its files measured exactly 117.000s
// with no padding drift. Ours cannot: AAC carries encoder padding, which is
// why Safari loops tick. durationSamples is a measurement (phase 1 stores it
// from a decode, not from a container header), so it is safe to trust here.
source.loopStart = 0;
source.loopEnd = asset.durationSamples / asset.sampleRate;
```

**Tests run in a real browser.** Web Audio does not exist in happy-dom, and mocking it would repeat phase 1's central failure — mocked mongoose passed every test while the feature was broken end to end. Use an `OfflineAudioContext` and **assert on measured gain values**, porting the POC's own verifications:

- fade-in is linear and reaches target at exactly `t = fade`
- two items with different fades started together sit at different gains mid-ramp (the POC measured storm@4s at 0.402 while battle@0.5s was at full)
- interrupting a fade-in ramps **down** from the current value, never jumps
- a one-shot releases its pad at end of buffer
- `fade = 0` starts at full without throwing

**Fixture warning:** do not test looping with a source whose padding happens to be zero. That is precisely the shape that would let a `buffer.duration` regression pass.

- [ ] **Steps 1–6:** RED in the browser first, then port, then verify each measured assertion, then commit.

```bash
git commit -m "feat(soundboard): port the POC Web Audio engine with measured loop bounds"
```

---

## Task 11: Random one-shot scheduler

**Files:**

- Create: `app/lib/soundboard/scheduler.ts`
- Test: `tests/lib/soundboard/scheduler.test.ts`

**Interfaces:**

- Produces: `createScheduler({ emit, now, setTimeout })` → `{ sync(state), dispose() }`.

Emits `fireOneShot` commands on a timer for every playing item with a random interval. **Injectable clock and timer** — a scheduler that reads `Date.now()` directly is untestable.

The GM's browser is the sole authority, by construction. In 2b players receive fires and never schedule.

- [ ] **Step 1: The tests that matter**

```ts
it('fires within the resolved interval, using the mood override not the item default', () => {});
it('reschedules with a fresh random interval after each fire', () => {});
it('stops firing for an item that the current mood turns off', () => {});
it('disposes every pending timer, so a package switch cannot leak a ghost fire', () => {});
```

- [ ] **Steps 2–5:** Run, implement with fake timers, verify, commit.

```bash
git commit -m "feat(soundboard): random one-shot scheduler owned by the GM board"
```

---

## Task 12: `useSoundboard`

**Files:**

- Create: `app/hooks/useSoundboard.ts`
- Test: `tests/hooks/useSoundboard.test.tsx`

**Interfaces:**

- Consumes: reducer, engine, scheduler, `saveBoardStateFn`.
- Produces: `useSoundboard(campaignId, pkg)` → `{ state, dispatch, audioReady, enableAudio }`.

Wires the pieces: dispatch → reducer → engine `apply` → debounced `saveBoardStateFn`.

**Three things this hook owns:**

- **`AudioContext` starts suspended.** `enableAudio()` resumes it on a user gesture. Without an explicit affordance the GM's first pad press silently does nothing.
- **Debounce.** Play/stop and mood changes flush promptly; `setItemVolume`/`setMasterVolume` settle first. Dragging a slider must not write to Atlas per frame.
- **A failed save never interrupts audio.** Catch, report via `captureException`, keep playing.

- [ ] **Step 1: The tests that matter**

```ts
it('does not write on every volume tick', async () => {
  // 20 rapid setItemVolume dispatches -> one save.
});

it('keeps playing when the save rejects', async () => {
  // saveBoardStateFn rejects; engine.apply still received the new state.
});

it('does not dispatch audio commands before the context is resumed', () => {});
```

- [ ] **Steps 2–5:** Run, implement, verify, commit.

```bash
git commit -m "feat(soundboard): useSoundboard wiring reducer, engine and persistence"
```

---

## Task 13: Package list route

**Files:**

- Create: `app/components/soundboard/PackageList.tsx` + stories, `app/routes/audio/packages.tsx`
- Test: `tests/components/soundboard/PackageList.test.tsx`

Lists the caller's packages and system packages, visually distinguished. System rows offer **Clone**, not Edit. Add a `beforeLoad` auth guard matching `app/routes/dashboard.tsx:6-12`.

- [ ] Test: a system row shows Clone and **not** Edit; a user row shows Edit.
- [ ] Steps: RED, implement, stories, `npm run test:storybook`, commit.

```bash
git commit -m "feat(soundboard): package list with clone-not-edit for system packages"
```

---

## Task 14: Package editor — items

**Files:**

- Create: `app/components/soundboard/PackageEditor.tsx`, `PackageItemRow.tsx` + stories, `app/routes/audio/packages.$packageId.tsx`
- Test: `tests/components/soundboard/PackageEditor.test.tsx`

**Mounts `AudioLibraryBrowser` as a picker** — `selectable` plus an "Add to package" `actionsSlot`. This is the reuse phase 1 designed for; no fork and no `mode` prop. Read its props before wiring.

Per-item controls: volume, fade, loop, random interval.

- [ ] Test: adding from the picker appends an item referencing the chosen `assetId`; the item cap is enforced in the UI, not only the schema.
- [ ] Steps: RED, implement, stories, storybook, commit.

```bash
git commit -m "feat(soundboard): package editor reusing the library browser as a picker"
```

---

## Task 15: Mood editor

**Files:**

- Create: `app/components/soundboard/MoodEditor.tsx` + stories
- Test: `tests/components/soundboard/MoodEditor.test.tsx`

Each mood is a row of item states. **Show the resolved value with a marker when overridden** — never make the reader merge two records in their head.

- [ ] Test: an item with no override renders the item's value and no marker; overriding renders the new value **and** the marker; clearing the override returns to the item's value.
- [ ] Steps: RED, implement, stories, storybook, commit.

```bash
git commit -m "feat(soundboard): mood editor showing resolved values"
```

---

## Task 16: Board surfaces

**Files:**

- Create: `app/components/soundboard/BoardPad.tsx`, `MoodBar.tsx`, `MasterBar.tsx` + stories
- Test: `tests/components/soundboard/BoardPad.test.tsx`

**Purpose-built, not `AudioAssetRow`** — that component carries selection checkboxes, waveforms and edit/delete affordances that are wrong mid-session.

A pad renders: label, playing state, volume, `∞`/`1×` where a once-variant exists, and **an unavailable state with the reason** when the asset is not `ready` or its rendition cannot be decoded.

- [ ] Test: a pad for a `pending` asset is disabled and states why; a pad whose asset was deleted does not throw.
- [ ] Steps: RED, implement, stories, storybook, commit.

```bash
git commit -m "feat(soundboard): board pad, mood bar and master bar"
```

---

## Task 17: The board route

**Files:**

- Create: `app/routes/campaigns/$campaignId/soundboard.tsx`
- Test: `tests/routes/soundboard-route.test.tsx`

Assembles everything: package picker, `useSoundboard`, mood bar, pads, master bar, and the **enable-audio** affordance.

**Hydration is part of this task (added 2026-07-30).** `loadBoardStateFn` shipped in Task 7 and, as originally planned, was consumed by no task at all — the design's goal _"survive a mid-session page reload without silencing the table"_ had zero coverage anywhere in the plan. Fetch it here and hand the result to `useSoundboard`'s hydrate seam (Task 12's fix round adds one).

Three things the naive approach gets wrong, all found in review:

- **Do not hydrate by replaying commands.** A replay of `setMood` + per-item `play` cannot express an item the mood names but the GM had _stopped_ before the reload — `setMood` resolves it back to playing. Hydration sets state directly.
- **Hydration must not schedule a save.** Every ordinary command is prompt- or settle-urgency, so a replay re-saves what it just read, silently making whoever _opened_ the board the last writer and destroying the `updatedBy` signal the design's two-GM handling depends on.
- **Mind the clobber race.** The `[pkg]` effect dispatches `loadPackage`, which resets to `initialBoardState` and arms a prompt-urgency save. If board state or hydration lands after that, Atlas is overwritten with a blank board first. Order the two so hydration wins, and test it.

**Asset source:** use Task 21's package-scoped resolver, not `listAudioAssetsFn`. See Task 21 for why the paginated owner-scoped list cannot serve a board.

`beforeLoad` guard matching `dashboard.tsx`. Handlers passed to pads must be `useCallback`-stable if pads are memoized — phase 1 found `useDeleteConfirm` returning a fresh closure per render silently defeated a memo.

Commit `app/routeTree.gen.ts` alongside.

- [ ] Test: the board does not dispatch before audio is enabled; a failed state save leaves the UI playing.
- [ ] Steps: RED, implement, typecheck (proves the route tree regenerated), commit.

```bash
git commit -m "feat(soundboard): the in-campaign GM board"
```

---

## Task 18: Once-variant attach

**Files:**

- Modify: `app/components/audio/AudioAssetDetail.tsx`, `app/server/functions/audio.ts`, `audio-worker/src/process.ts`
- Test: `tests/server/functions/audio-once-variant.test.ts`, `audio-worker/test/once-variant.test.ts`

Phase 1 reserved `onceRenditions` and never wrote it, explicitly so this phase would not open with a migration. This is where it gets written.

The ingest path gains a `variant: 'main' | 'once'` flag; the worker writes `onceRenditions` instead of `renditions` when the row says `once`. **The worker needs no new transcode logic** — same pipeline, different destination field.

- [ ] Test (server): a `once` upload writes to `onceRenditions` and leaves `renditions` untouched.
- [ ] Test (worker): the destination field follows the row's variant, and the storage key does not collide with the main rendition.
- [ ] Steps: RED, implement, run both suites, commit.

```bash
git commit -m "feat(soundboard): attach a once-variant, writing onceRenditions"
```

---

## Task 19: E2E

**Files:**

- Create: `e2e/soundboard.spec.ts`

**Seed real fixtures**, as `e2e/globalSetup.ts` already does for audio. Do **not** guard assertions behind `if (await x.count())` — with no seed data that condition is always false and the spec reports coverage it does not have. Phase 1's plan made exactly that mistake.

Cover: create a package → add an asset → define two moods → open the board → enable audio → switch mood → stop all.

**Add a reload step (2026-07-30).** After switching mood, reload the page and assert the board comes back in the same state. This is the only coverage the design's headline persistence goal gets — Task 17 implements hydration, and nothing else exercises it end to end. Without this step the whole `SoundboardState` collection is write-only and untested.

- [ ] Steps: seed, write the spec, run it, commit.

```bash
git commit -m "test(soundboard): e2e for package authoring and the GM board"
```

---

## Task 20: Prune package references when an asset is deleted

**Added 2026-07-29.** The plan as written left a referenced-asset delete producing a permanently dangling `assetId` in every package that used it. Task 16 renders such a pad unavailable, and that stays — it is still needed for the races this task cannot close (an asset deleted while a board is already loaded, or a system asset removed under a cloned package). But a dangling reference that nothing ever prunes is a slow leak in a document with a hard 64-item cap: a GM who churns their library eventually cannot add items to a package whose pads are mostly tombstones.

**Files:**

- Modify: `app/server/functions/audio.ts` (`deleteAudioAsset`)
- Test: `tests/server/functions/audio-delete-prunes-packages.test.ts`

**Interfaces:**

- Consumes: `AudioPackage` (Task 2).
- `deleteAudioAsset` gains, before the row delete: remove every `items[]` entry referencing the asset **and** every `moods[].states[]` entry referencing those items, across the caller's own packages only.

**Scope it to the caller.** `deleteAudioAsset` already resolves `{ _id: data.id, ownerId: userId }`. The prune must filter `{ ownerId: userId }` too — never a bare `{ 'items.assetId': id }`, which would reach into other users' packages. System packages (`ownerId: null`) are **not** pruned: they are read-only, and a user cannot delete a system-owned asset anyway.

**Two-step, not one.** Moods reference `item.id`, not `assetId`, so `$pull`ing the item is not enough — the mood states pointing at it must go too, and you need the item ids before you drop them. Read the affected packages, compute the item ids per package, then update. A single `$pull` on `items` leaves orphaned mood states that resolve to a phantom pad.

**Failure is non-fatal.** Follow the shape of the existing best-effort R2 delete directly above in the same function: a prune that throws must not block the row delete, and must report via `serverCaptureException`. The user asked for the asset to be gone.

- [ ] **Step 1: The tests that matter**

```ts
it('removes the item AND the mood states that referenced it', async () => {
  // Fixture shape warning: give the package TWO items and a mood whose
  // states name both. A single-item fixture passes even if the
  // implementation clears `states` wholesale instead of filtering it.
  // Assert the surviving item and its mood state are still present.
});

it("never touches another owner's packages", async () => {
  // Assert on the actual filter passed to the model, not on a mocked
  // return value: expect it to carry `ownerId: <caller>`. A test that
  // only checks "the other package came back unchanged" passes with the
  // ownership clause deleted, because the mock returns what it was told.
});

it('leaves system packages alone', async () => {});

it('still deletes the asset when the prune throws', async () => {
  // The prune rejects; deleteOne must still have been called and the
  // function must resolve `{ deleted: true }`.
});
```

- [ ] **Steps 2–5:** Run, implement, verify, commit.

```bash
git commit -m "fix(audio): prune package item and mood references on asset delete"
```

---

## Task 21: Asset readability for a package's items

**Added 2026-07-30.** The design's Authorization section states **two** rules:

> A package is visible if it is owned by the caller or is a system package.
> An asset is readable if it is owned by the caller, **or is system-owned and referenced by a package the caller can see.**

Task 4 implemented the first. **Nothing in the plan ever implemented the second** — `listAudioAssets` queries `{ ownerId: userId }` and nothing else, so a system package's pads are structurally unplayable. Cloning does not help: a clone copies asset _references_, not bytes, so a cloned system package still points at assets the cloner cannot read. The system-package mechanism 2a is supposed to ship has therefore never worked once, end to end.

There is a second, independent defect the same resolver fixes. Task 12 was going to source board assets from `listAudioAssetsFn`, which is **cursor-paginated at 50 by default, 200 max**, while a package holds up to `MAX_PACKAGE_ITEMS` (64) items. A package whose assets straddle a page boundary gets permanently dead pads regardless of ownership — and the engine caches a failed load as permanently unplayable, so the pad stays dead for the rest of the session.

**Files:**

- Modify: `app/server/functions/packages.ts` (or a sibling — decide and say which)
- Modify: `app/utils/soundboard-server-fns.ts`, `app/utils/queryKeys.ts`
- Test: `tests/server/functions/package-assets.test.ts`, plus wrapper coverage

**Interfaces:**

- Produces: `listPackageAssets({ data: { packageId }, userId, sessionUserId })` → the `AudioAssetData[]` a board needs, and a `listPackageAssetsFn` wrapper.

**The rule, expressed once.** Resolve the package through `packageVisibilityFilter` first — if the caller cannot see the package, they get nothing, and no asset query runs. Then read exactly the assets that package's items reference, scoped to `{ _id: { $in: referencedIds }, $or: [{ ownerId: userId }, { ownerId: null }] }`. **The `$in` is what bounds it** — this is not a library listing, it is "the assets this one package needs", so there is no pagination and no cap beyond the package's own 64.

**Do not widen `listAudioAssets`.** That function is the library browser's, it is owner-scoped, and phase 1's review already caught a campaign-authorized function enumerating per-user data. A second, narrower, package-gated entry point is the safer shape.

- [ ] **Step 1: The tests that matter**

```ts
it('refuses a package the caller cannot see, without querying assets at all', async () => {
  // Assert AudioAsset.find was NOT called. Asserting only that it rejects
  // passes with the gate deleted, because a later line throws anyway.
});

it('returns system-owned assets referenced by a system package', async () => {
  // The case that is broken today. Assert the asset filter carries BOTH the
  // $in of referenced ids AND the ownerId $or — either alone passes against
  // half a fix.
});

it('does not return an asset the package does not reference', async () => {
  // Fixture: caller owns two assets, the package references one.
  // A resolver that ignores $in and just returns the owner's library
  // passes every other test in this file.
});

it('returns all of a full package's assets, with no pagination boundary', async () => {
  // MAX_PACKAGE_ITEMS items. This is the pagination defect; a fixture with
  // three items cannot detect it.
});
```

- [ ] **Steps 2–5:** Run, implement, verify, commit.

```bash
git commit -m "feat(soundboard): package-scoped asset readability for the board"
```

---

## Final gate

- [ ] **Run the whole gate before opening the PR:**

```bash
npm run typecheck && npm run lint && npm test && npm run test:storybook
npm run test:browser
bash deploy/charts/cartyx/tests/render-tests.sh
(cd audio-worker && npm run typecheck && npm test)
(cd realtime && npm run typecheck && npm test)
npx playwright test e2e/soundboard.spec.ts
```

- [ ] **Open the PR against `dev`.**

```bash
git push -u origin soundboard-phase2
gh pr create --base dev --title "feat(soundboard): phase 2a — packages and the GM board"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement                                      | Task    |
| ----------------------------------------------------- | ------- |
| `AudioPackage`, nullable owner for system packages    | 2       |
| `PackageItem` with per-package overrides              | 1, 2    |
| `Mood` referencing items, optional overrides          | 1, 2, 8 |
| Item/mood caps (64/32)                                | 1       |
| Visibility rule, system packages read-only            | 4       |
| Clone preserves mood references                       | 5       |
| `SoundboardState`, own collection, unique on campaign | 3, 6    |
| Command vocabulary                                    | 9       |
| Pure reducer                                          | 9       |
| Engine port with measured assertions                  | 10      |
| `loopEnd` from `durationSamples`                      | 10      |
| Random scheduler owned by the GM                      | 11      |
| Debounced persistence, audio never interrupted        | 12      |
| Enable-audio affordance                               | 12, 17  |
| Package editor reusing the library picker             | 14      |
| Mood editor showing resolved values                   | 15      |
| Purpose-built pads, unavailable states                | 16      |
| `onceRenditions` attach + `∞`/`1×`                    | 16, 18  |
| Real-browser engine tests                             | 10      |
| E2E                                                   | 19      |
| Reference prune on asset delete                       | 20      |

**Not covered, by design:** realtime broadcast, player playback, autoplay on player devices, mid-session resync — all 2b. Per-user storage quota remains phase 1's open question.

**Known risk:** Task 10 is the only task whose tests need a real browser, and it is also the task with the most inherited subtlety. If it slips, the reducer (9) and resolution (8) are independently valuable and already tested.
