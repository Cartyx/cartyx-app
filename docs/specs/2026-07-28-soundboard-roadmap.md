# GM Soundboard — Programme Scope

**Date:** 2026-07-28
**Status:** Scope approved; phase 1 design approved, phases 2–3 not yet designed
**Phase specs:** [Phase 1 — Audio Asset Library](./2026-07-28-audio-library-design.md)

## Vision

Embed a Syrinscape-class audio experience directly in Cartyx. A GM builds themed
collections of music, ambience, and one-shot effects, then runs them live from a
board during a session — layering a storm under a tavern, fading music between
scenes, and letting thunder crack at random intervals — while **players hear the
audio in their own browsers**.

Today a GM does this by alt-tabbing to a separate product. The goal is that they
never leave the portal.

## Why this is three phases

The request spans an asset pipeline, a realtime playback system, and an ML
generation tool. Those have different shapes, different risks, and different
definitions of done. One spec covering all three would be too coarse to plan
against.

| Phase | Scope                                                                                                              | Spec                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| **1** | **Audio asset library** — bulk upload, server-side transcode/normalize, classification, search                     | [design](./2026-07-28-audio-library-design.md) ✅ approved |
| **2** | **Packages + soundboard** — collections, moods, Web Audio engine, GM controls, realtime broadcast, player playback | not started                                                |
| **3** | **`ai-sound-generator`** — Python generate → approve → upload tool                                                 | not started                                                |

**Ordering rationale.** Phase 1 is a hard prerequisite: there is nothing to put
in a package or play on a board until assets exist, are classified, and are
playable in every browser. Phase 3 comes last because it is a _client_ of
phase 1's ingest API — building it earlier would mean inventing an ingest
contract before the library that defines it exists.

**Why packages and the board are one phase, not two.** A package with no player
cannot be validated by ear, and a board with no packages has nothing to load.
Splitting them means building throwaway UI on both sides of the seam.

## Programme-level decisions

These bind all three phases. Each was settled during scoping; the reasoning
matters more than the choice.

| Decision                  | Choice                                  | Why                                                                                                                                          |
| ------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Who hears the audio**   | Players, in their own browsers          | Syrinscape's "Online" model. The alternative — GM's speakers only — is far simpler but does not serve remote tables.                         |
| **What crosses the wire** | Playback _commands_, never audio        | The ws service relays "play X at vol 0.6, fade 2s"; each browser fetches from the CDN and plays locally. Streaming audio would be far worse. |
| **Library ownership**     | Per-user, reused across their campaigns | Audio blobs are too large to copy per campaign the way SRD documents are.                                                                    |
| **Audio storage**         | R2 only, never the repo                 | Applies to generated audio too: phase 3 commits Python source, never `.wav`/`.opus`.                                                         |
| **Ingest**                | One shared implementation, two adapters | Browser and Python tool use the same validation and transcode path; only auth differs.                                                       |
| **Loudness**              | −20 LUFS everywhere                     | Matches the POC's `normalize.sh`, so generated and hand-uploaded audio sit at the same level and no per-asset gain-riding is needed.         |

## Prior art

### The `ttrpg-sfx` POC

`~/Developer/ttrpg-sfx` is a working local toolkit. Its `docs/soundboard.md`
documents a **verified** Web Audio engine with measured evidence — fade
envelopes sampled in a real browser, master-bus RMS matching the −20 LUFS
target, gapless decode confirmed. It already solves:

- per-track gain nodes feeding a master bus (the thing that makes independent
  fades possible at all)
- fades that cannot click, including the subtle case of interrupting a fade-in
  (`cancelScheduledValues` → `setValueAtTime(gain.value, now)` → ramp down)
- loop vs one-shot semantics, and correct retrigger behaviour for each
- stale-source guards so a fast off/on cannot clear the new pad
- `∞`/`1×` music variants: a seamless loop file and a composed-ending file

**Phase 2 should port this engine, not reinvent it.** It is the single highest-value
asset in the whole programme.

### How other products model this

Researched to set phase 2's feature bar:

| Product            | Model                                                                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Syrinscape**     | SoundSets contain Elements typed Music / Loops / One-shots. **Moods** are named presets that set which elements play at what volume — one click reshapes the scene. One-shots have randomised delay, volume, and pan. |
| **Foundry VTT**    | Playlists with modes (sequential, shuffle, simultaneous, soundboard), per-track volume and fade duration, separate music/environment/interface volume channels.                                                       |
| **Roll20 Jukebox** | Flat playlists; loop and per-track volume; play for GM only or everyone.                                                                                                                                              |
| **Tabletop Audio** | SoundPad grids — fixed slots, per-slot volume, designed for live ambience mixing.                                                                                                                                     |

The consistent pattern: **type is functional, not decorative** — it determines
default playback behaviour. The POC independently arrived at the same idea with
`SECTIONS` carrying `defaults: {loop, fade}`, which is why phase 1 makes `kind`
a required field rather than just another tag.

The feature that most distinguishes Syrinscape from the rest is **Moods**. It is
the difference between a soundboard and a scene controller, and phase 2 should
treat it as core rather than a stretch goal.

## Phase 1 — Audio asset library ✅ designed

Full design: [2026-07-28-audio-library-design.md](./2026-07-28-audio-library-design.md).

In brief: a per-user library with multi-file upload; a dedicated
`cartyx-audio-worker` running ffmpeg to loudness-normalize and emit **Opus +
AAC** renditions (so every player's browser can play every asset); classification
by required `kind` plus structured facets and free tags; server-side search; a
standalone `/audio` route; and an ingest path exposed both as a server function
for the browser and as `POST /api/audio/uploads` server routes for phase 3.

**Delivers:** a library you can fill, classify, find, and audition one file at a
time. **No** playback engine, packages, or realtime.

## Phase 2 — Packages and the soundboard

Not yet designed. Scope sketch only — this phase gets its own spec.

**Packages** are collections of library assets with per-package overrides
(volume, fade, loop/one-shot, one-shot interval), analogous to Syrinscape
SoundSets. Assets are _referenced_, not copied, so one storm clip serves every
package that uses it.

**Moods** are named presets within a package capturing which elements play at
what levels, with crossfade between them.

**The board** ports the POC engine and adds:

- per-track volume, fade in/out, loop toggle, mute/solo
- master volume
- one-shot randomisation — min/max interval, volume and pan jitter (the
  "thunder goes off occasionally" requirement)
- stop-all / fade-all
- GM preview vs broadcast to players

**Realtime** extends the existing `tabletop` party pattern: GM-only message
gating exactly as `parties/tabletop.ts` does today, commands relayed to the room,
each client playing locally.

Known hard problems to solve in that spec:

- **Autoplay policy.** Browsers refuse audio without a user gesture. Every
  player needs an explicit "join audio" action; this must be designed into the
  play route, not bolted on.
- **Random triggers must have a single owner.** If each client randomises its
  own thunder, the table desyncs immediately. One authority schedules and
  broadcasts each fire.
- **Join mid-session.** A player arriving after playback starts must resync to
  current state, including elapsed loop position.
- **Gapless looping on Safari.** AAC's encoder padding makes loops tick. The
  board must set `loopStart`/`loopEnd` from the stored ffprobe duration rather
  than trusting `buffer.duration` — which is precisely why phase 1 stores an
  accurate `durationMs`.
- **Mobile.** Backgrounded tabs and iOS audio-session limits need explicit
  handling.

## Phase 3 — `ai-sound-generator`

Not yet designed. Scope sketch only.

A Python tool that **generates a candidate sound, plays it for approval, and on
acceptance uploads it through phase 1's ingest API**, returning the asset link.
Iterating on the POC's generation scripts (`generate-library.sh`,
`generate-spells.sh`, `generate-music.sh`) and its Stable Audio / MOSS-TTS
pipeline.

**No audio is ever committed.** The repo holds Python source and docs; models
and output stay gitignored and local. For sizing context, `~/Developer/ttrpg-sfx`
is currently 15 GB (`models/` 10 G, `output/` 2.9 G, `MOSS-TTS/` 1.4 G,
`stable-audio-3/` 473 M — the last a nested git repo) against roughly 50 KB of
authored shell.

The tool holds no R2 or Mongo credentials. It authenticates with a **personal
access token** and calls the same endpoints the browser uses, so validation,
transcoding, and the resulting `AudioAsset` are identical regardless of client.
Because the generator knows what it produced, it sends `kind`, facets, and tags
at upload time — generated audio arrives fully classified rather than swamping
the "needs tagging" queue.

**Personal access tokens do not exist in Cartyx today** (session cookies only).
Issuing, hashing, scoping, and revoking them is this phase's work; phase 1 ships
the routes with the token check stubbed to reject.

## Cross-cutting concerns

Not owned by any single phase; each needs a decision before the phase that first
hits it.

- **Storage cost and quotas.** A per-user library with no cap is an unbounded R2
  bill. Needs a per-user quota, surfaced in the UI. First matters in phase 1.
- **Bandwidth.** Every player streams every asset from the CDN independently. A
  six-player table on a 40-track package multiplies egress. First matters in
  phase 2.
- **Licensing.** Users uploading audio they do not own is a ToS question, and
  distributing it to players makes Cartyx a distributor rather than a locker.
  Needs a position before the library is shareable.
- **Orphan cleanup.** `cleanup.ts` must learn the audio prefixes or every
  generated file looks orphaned. Phase 1.
- **Service CI gap.** `realtime/` has no CI job at all — nothing typechecks,
  tests, or audits it on any PR. Phase 1 adds a second unbuilt service
  (`audio-worker`), so it should add one `services` job covering both. This same
  gap let the `/realtime` dependabot entry go missing long enough to produce an
  unmergeable `main`-targeted PR (#534).

## Open questions

Deliberately unresolved; each belongs to the phase that first needs it.

| Question                                                   | Phase |
| ---------------------------------------------------------- | ----- |
| Per-user storage quota, and behaviour at the limit         | 1     |
| Facet counts in the filter UI (deferred, not rejected)     | 1     |
| Whether moods crossfade or hard-cut by default             | 2     |
| Who owns the random-trigger schedule — GM client or server | 2     |
| Whether players get per-track volume or only a master      | 2     |
| Licensing/ToS position on user-uploaded audio              | 2     |
| Which generation models ship, and their licences           | 3     |
| Token scope granularity (per-tool vs per-user)             | 3     |
