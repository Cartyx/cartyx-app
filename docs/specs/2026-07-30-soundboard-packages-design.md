# Packages and the GM Board — Design

**Date:** 2026-07-30
**Status:** Approved (design), pending implementation plan
**Phase:** 2a of the [GM Soundboard programme](./2026-07-28-soundboard-roadmap.md)
**Builds on:** [Phase 1 — Audio Asset Library](./2026-07-28-audio-library-design.md)

## Summary

Add **packages** — themed, self-contained collections of library assets with
per-package playback settings — and a **GM board** that plays them live, in a
campaign, using a Web Audio engine ported from the `ttrpg-sfx` POC.

Playback in this phase is **local to the GM's browser**. Players hearing the
audio is phase 2b.

## Why this is 2a and not all of phase 2

The roadmap scopes phase 2 as "packages + soundboard + realtime broadcast +
player playback". That is two projects with different shapes and different
risks:

|                   | shape                                | principal risk                                                                      |
| ----------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| **2a** (this doc) | data modelling, client Web Audio, UI | mostly known — the engine is proven and measured                                    |
| **2b**            | distributed systems                  | autoplay on devices we don't control, trigger authority, mid-session resync, mobile |

The roadmap's argument against splitting — "a package with no player is
untestable and a board with no packages has nothing to load" — justifies
keeping packages with **a** player. It does not require bundling the broadcast
protocol, the player route, and random-trigger scheduling into the same spec.

2a is independently valuable: today a GM alt-tabs to a separate product to run
audio. A GM-only board removes that before players hear anything.

## Goals

- Author a themed package once and reuse it across every campaign.
- Switch a whole scene with one click, and have it sound intentional.
- Layer ambience, music and one-shots the way the POC already proves works.
- Survive a mid-session page reload without silencing the table.
- Leave 2b with a command vocabulary it can broadcast, rather than a protocol
  to invent.

## Non-goals

- Realtime broadcast, player playback, the join-audio gesture on player devices.
- Multiple packages active simultaneously.
- Editing system packages in place (clone instead).
- A populated built-in catalogue — 2a ships the mechanism, phase 3 fills it.
- Per-user storage quotas (still phase 1's open question).

## Key decisions

| Decision           | Choice                                       | Rationale                                                                                                                       |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Package ownership  | Per-user, plus **system** packages           | Matches the per-user library. A GM builds "Tavern" once for every campaign they run.                                            |
| System audio       | System-owned assets from phase 3's generator | Generated audio is _original_, so there is no licensing surface — the ToS question the roadmap flags never arises.              |
| Board location     | In-campaign                                  | A live session belongs to a campaign; it is also where 2b's broadcast room already exists.                                      |
| Active packages    | **One at a time**, moods within it           | Matches Syrinscape and the roadmap's framing of moods as "presets within a package". Keeps a mood a complete scene description. |
| Live board state   | Persisted server-side, per campaign          | A reload must not silence the table — and 2b's late joiner can read state instead of needing a bespoke resync.                  |
| Mood transition    | Crossfade, **per-item** duration             | The engine already ramps per track. A single global fade cannot serve a 4 s storm swell and a 0 s door slam at once.            |
| State architecture | **Command log**                              | 2b relays commands. Speaking that vocabulary internally means 2b broadcasts what 2a already emits.                              |

## Architecture

### Data model

#### `AudioPackage`

| Field         | Type              | Notes                                      |
| ------------- | ----------------- | ------------------------------------------ |
| `ownerId`     | ObjectId → `User` | **Nullable. Null means a system package.** |
| `name`        | String            | Required.                                  |
| `description` | String?           |                                            |
| `items[]`     | embedded          | See below. Capped explicitly.              |
| `moods[]`     | embedded          | See below.                                 |

#### `PackageItem` (embedded)

| Field                           | Notes                                                               |
| ------------------------------- | ------------------------------------------------------------------- |
| `id`                            | Stable within the package. **Moods reference this, not `assetId`.** |
| `assetId`                       | ObjectId → `AudioAsset`.                                            |
| `label`                         | Optional override of the asset's title within this package.         |
| `volume`, `fadeSeconds`, `loop` | The POC's per-track settings, persisted.                            |
| `randomIntervalMin/Max`         | One-shot scheduling — "thunder goes off occasionally".              |
| `volumeJitter`, `panJitter`     | One-shot variation.                                                 |
| `sortIndex`                     | Board ordering.                                                     |

#### `Mood` (embedded)

`id`, `name`, and `states[]` of:

| Field                    | Notes                              |
| ------------------------ | ---------------------------------- |
| `itemId`                 |                                    |
| `playing`                |                                    |
| `volume?`                | Optional — falls back to the item. |
| `fadeSeconds?`           | Optional — falls back to the item. |
| `randomIntervalMin/Max?` | Optional — falls back to the item. |

**Moods reference items, not assets.** This is what lets one `thunder` item
appear in many moods at different volumes _and different rates_ — every 30–90 s
in "Overhead", every 3–5 minutes in "Distant" — without duplicating the pad.

Every override is optional; unset means inherit. The **resolved** value
(`mood ?? item`) is what the engine and the UI both use, and the UI shows the
resolved value with a marker when it is overridden. Making the reader merge two
records in their head is exactly the ambiguity that produced repeated bugs in
phase 1.

**Why items and moods are embedded:** a package is a bounded authoring unit,
always loaded whole to run the board, and moods reference item ids — so
embedding makes board load one read with no joins.

**Items are capped at 64 per package, moods at 32.** A board with more pads than
that is unusable as a live surface long before the document approaches Mongo's
limit, so the cap is a usability bound that happens to also bound the document.
Enforced in the Zod schema, so it fails at the boundary rather than at write
time — phase 1 shipped an uncapped `tags` array into a `$all` query precisely by
omitting a bound that its sibling schemas had.

#### `SoundboardState`

Its own collection, keyed by `campaignId`: `packageId`, `moodId`,
`items[] { itemId, playing, volume }`, `masterVolume`, `updatedBy`, `updatedAt`.

Deliberately **not** embedded on `Campaign`: it takes debounced writes during
play, and `Campaign` is read on nearly every request. Embedding would put write
amplification on a hot document.

### Authorization

Phase 1 scopes every asset read by `ownerId`. The board is the first consumer
that legitimately reads assets it does not own: a system package references
system-owned assets.

The rule: **an asset is readable if it is owned by the caller, or is
system-owned and referenced by a package the caller can see.** A package is
visible if it is owned by the caller or is a system package.

This is a new seam, and phase 1's reviews found real defects at exactly this
kind of seam. It gets an explicit rule, one implementation, and its own tests —
not an incidental `$or` at each call site.

System packages are read-only. **Cloning** copies items and moods into a
user-owned package; asset references come along unchanged, since they are
references rather than bytes.

### Command layer

Every GM action is a command:

```
loadPackage(packageId)      setMood(moodId)
play(itemId) / stop(itemId) fireOneShot(itemId)
setItemVolume(itemId, v)    setMasterVolume(v)
stopAll()
```

A pure reducer applies a command to `BoardState`. The engine subscribes to state
and reconciles the audio graph. The engine never reads the UI; the UI never
touches the graph.

This vocabulary is the one the roadmap describes 2b relaying — _"play X at vol
0.6, fade 2s"_. Speaking it internally now means 2b broadcasts commands that
already exist rather than deriving a protocol from state diffs.

**The random one-shot scheduler runs in the GM's browser** and emits
`fireOneShot` on a timer — the same command a click emits. The roadmap flags
"random triggers must have a single owner" as a hard problem; this answers it by
construction. The GM's board is always the authority. In 2b, players receive
fires and never schedule them.

**Persistence is debounced snapshots**, not per-command writes. Play/stop and
mood changes flush promptly; continuous controls settle first. Dragging a volume
slider must not write to Atlas per frame.

### The engine

A **port** of the POC engine, not a rewrite. Its behaviour is documented with
measured evidence in `~/Developer/ttrpg-sfx/docs/soundboard.md`, and the
following carry over unchanged:

- `BufferSource → per-track GainNode → masterGain → destination`
- The fade-interrupt fix: `cancelScheduledValues` → `setValueAtTime(g.gain.value, now)`
  → ramp. Without the middle line, interrupting a fade-in leaps to full volume
  before fading out. _Measured:_ interrupted at gain 0.201, it ramps down rather
  than jumping to 0.8.
- The one-shot stale-source guard (`s.source === src`), so a fast off/on cannot
  have the old source clear the new pad.
- Retrigger vs toggle, and the 15 ms ramp on immediate stop so retriggering does
  not click.
- Loop flip mid-play, using `startedAt` to find the playhead.

Two phase-1 investments become load-bearing here:

**`durationSamples`.** The POC could trust `source.loop = true` because its files
measured "exactly 117.000 s — no padding drift". Ours cannot: AAC carries
encoder padding, which is why Safari loops tick. The engine sets `loopStart = 0`
and `loopEnd = durationSamples / sampleRate` from the stored value rather than
`buffer.duration`. Phase 1 stores that as a measurement rather than a header
reading, which is what makes it usable.

**`onceRenditions`.** Phase 1 reserved the field and never wrote it, explicitly
so this phase would not open with a migration. The `∞`/`1×` toggle consumes it:
`∞` loops the normal rendition, `1×` plays a composed-ending variant. 2a adds
the **attach** flow — a second upload through the existing worker, writing
`onceRenditions` instead of `renditions`. The worker needs no new logic.

### UI

| Surface           | Route                                           | Scope       |
| ----------------- | ----------------------------------------------- | ----------- |
| Package authoring | `/audio/packages`, `/audio/packages/$packageId` | Per-user    |
| The board         | `/campaigns/$campaignId/soundboard`             | In-campaign |

**Package editor.** Mounts `AudioLibraryBrowser` as a picker — `selectable` plus
an "Add to package" `actionsSlot`. This is the reuse phase 1 designed for and
never exercised; no fork and no `mode` prop. Beside it, the item list with
per-item settings, and a mood editor whose job is to answer "what will I hear?"
at a glance.

**The board** is optimised for live use, not browsing:

- Pads grouped by `kind` — which is what `kind` was made required for.
- Per-pad volume and the `∞`/`1×` toggle where a once-variant exists.
- A mood bar; one click per mood, since that is the headline interaction.
- Master volume, stop-all, package picker.
- Clear indication of what is currently playing — layered ambience is easy to
  lose track of.

**Board pads are purpose-built, not `AudioAssetRow`.** Phase 1's components were
built for _management_ and carry selection checkboxes, waveforms and
edit/delete affordances that are wrong mid-session.

**Once-variant attach** lives on `AudioAssetDetail` — a variant is a property of
the asset, so it belongs with the asset.

**Reused from phase 1:** `AudioLibraryBrowser`, `AudioFilterBar`,
`AudioAssetRow` (in the picker), `AudioWaveform`, `AudioAssetDetail`,
`chipStyles`.

## Failure modes

**The governing rule: audio is never interrupted by a persistence or network
failure.** The engine owns sound; the server is a mirror. A failed snapshot
write degrades reload-restore, never playback.

| Failure                      | Handling                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AudioContext` suspended     | An explicit "enable audio" affordance, not a hidden resume. Without it the GM's first pad press silently does nothing — the worst possible failure for a live tool.          |
| Referenced asset not `ready` | Pad renders unavailable with the reason. Dangling references are expected: packages reference assets, and assets can be deleted.                                             |
| Rendition URL 404s           | Decode failure disables that pad; it must not throw into the graph. Phase 1's delete path is best-effort by design.                                                          |
| Decode cost                  | The current mood's items are pre-decoded; the rest decode lazily and cache, as the POC does. Decoding 40 buffers on load is slow; decoding on click stalls the GM mid-scene. |
| Two GMs, one board           | Last-write-wins with `updatedBy`, surfaced honestly in the UI. A locking scheme is more machinery than a two-GM table justifies.                                             |

## Testing

- **The reducer is pure** — commands in, state out — and fully unit-testable.
  Mood resolution (`mood ?? item`) lives here and gets exhaustive cases; it is
  precisely the two-record merge that produced repeated phase-1 bugs.
- **The engine needs a real browser.** Web Audio does not exist in happy-dom,
  and mocking it would repeat phase 1's central failure: mocked mongoose passed
  every test while the feature was broken end to end. The POC's own verification
  is the model — _driven in a real browser, measuring the actual gain envelope_,
  with assertions like "interrupted at gain 0.201, ramps down rather than
  leaping to 0.8". Those measured assertions port alongside the code. This repo
  already runs Storybook tests in a real browser and has Playwright.
- **Fixture shape matters.** Three separate times in phase 1, a fixture's shape
  masked the effect under test. Do not test looping with a file whose padding
  happens to be zero, or crossfade with two items sharing a fade duration.

## Open questions

Deferred by choice, each to the phase that first needs it:

| Question                                                 | Phase                                  |
| -------------------------------------------------------- | -------------------------------------- |
| Autoplay gesture on player devices                       | 2b                                     |
| Mid-session join resync (this design makes it easier)    | 2b                                     |
| Whether players get per-track volume or only a master    | 2b                                     |
| Bandwidth: every player streams every asset from the CDN | 2b                                     |
| Mobile — backgrounded tabs, iOS audio-session limits     | 2b                                     |
| Per-user storage quota                                   | 1 (still open)                         |
| Licensing position on user-uploaded audio                | 2b, if libraries ever become shareable |
