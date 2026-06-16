# Sample data: realistic in-progress session history

**Date:** 2026-06-15
**Branch:** `sample-data`
**Status:** Approved (design)

## Problem

The dev seed (`scripts/dev_seed.py`) makes the main test campaign look unplayed.
Sessions carry only `name` / `number` / `startDate` / `status`; the completed
sessions have no end date and no catch-up summary, the "current" session is
`not_started` rather than `active`, and there are **no** notes, chat messages, or
dice rolls anywhere. When a user opens session 1 or 2, the chat and dice panels
are empty and there is no recap — it does not look like a game that was actually
played.

## Goal

Make **"The Lost Mines of Phandelver"** (the existing stock/bulk test campaign)
emulate a real D&D game in progress, from a fresh seed:

- Two **completed** sessions with start _and_ end dates, markdown catch-up
  summaries, shared notes, and full chat + dice transcripts.
- A third **active** session with a "previously on…" catch-up summary, GM-only
  prep notes, and a freshly-underway feel.
- A realistic mix of notes: public session-tied notes, private GM-only notes,
  and campaign-level notes.

## Grounding: data models (verified)

- **`Session`** (`app/server/db/models/Session.ts`): `campaignId`, `name`, `gm`,
  `number`, `startDate` (required), `endDate` (optional), `status`
  (`not_started` | `active` | `completed`, default `not_started`), `summary`
  (optional markdown — the dashboard CatchUpWidget renders the **active**
  session's summary), timestamps. A partial unique index allows only **one
  `active` session per campaign**.
- **`Note`** (`app/server/db/models/Note.ts`): `title`, `note` (body), `tags[]`,
  `isPublic` (default false), `isReadOnly`, `createdBy` (User `_id`),
  `campaignId` (required), `sessionId` (optional). **No GM-only flag** —
  visibility is public vs. private-to-creator. `listNotes`/`getNote` only return
  a private note to its creator.
- **`Message`** (`app/server/db/models/Message.ts`): `id` (uuid string), `seq`
  (per-session counter), `sessionId`, `campaignId`, `channel`
  (`general` | `gm`), `type` (`chat` | `spell-card` | `trait` | `item`),
  `authorId` (the user identity string), `authorName`, `text`, `beyond20Data?`,
  `timestamp` (ms since epoch), `createdAt`. Non-GM players never receive `gm`
  channel messages (`listMessages`, `app/server/functions/chat.ts`).
- **`DiceRoll`** (`app/server/db/models/DiceRoll.ts`): `id`, `seq`, `sessionId`,
  `campaignId`, `channel`, `character`, `title`, `rollType`, `attackRolls[]`
  (`{roll,type,total,formula,discarded,dice[]}`), `damageRolls[]`
  (`{damageType,dice[],total,flags,formula}`), `totalDamages`, `rollInfo[]`
  (label/value pairs), `description?`, `timestamp`, `createdAt`. Same per-role
  channel filtering as messages.

Collections for raw pymongo inserts: `db.sessions`, `db.notes`, `db.messages`,
`db.dicerolls`.

## Design

### Scope gate

The rich history applies **only to the main campaign**, gated by a new
`"rich_session_history": True` flag on its entry in `CAMPAIGNS`. The other two
campaigns keep their current lean sessions (preserving their happy-path intent).

### 1. Session arc

Replace the main campaign's three session specs with a coherent arc. Dates are
relative to `now`:

| #   | Name             | status      | startDate              | endDate       | summary                                                                             |
| --- | ---------------- | ----------- | ---------------------- | ------------- | ----------------------------------------------------------------------------------- |
| 1   | Goblin Arrows    | `completed` | ~21 days ago, 18:00 CT | same day +~4h | Recap of the Triboar Trail ambush, Sildar's capture, and the Cragmaw Hideout.       |
| 2   | The Spider's Web | `completed` | ~10 days ago, 18:00 CT | same day +~4h | Recap of arriving in Phandalin, the Redbrand thugs, and Glasstaff.                  |
| 3   | Wave Echo Cave   | `active`    | today, 18:00 CT        | `None`        | "Previously on…" recap of sessions 1–2 — the catch-up players see on the dashboard. |

Summaries are short markdown (heading + a few bullets), matching the
CatchUpWidget rendering. This resolves: missing end dates, missing catch-up
content, and the current session not being `active`.

### 2. Notes (~10–14 on the main campaign)

- **Public, session-tied** (`isPublic:true`, `sessionId` = session 1 or 2):
  party-visible recaps and in-character observations. Authored by a mix of the
  GM and player users (`createdBy` varies) so it reads like shared party notes.
- **Private GM-only** (`isPublic:false`, `createdBy = gm_id`): prep notes on the
  **active** session 3 (trap locations, Nezznar "The Black Spider" plans). Since
  private notes are visible only to their creator, these are effectively
  GM-only.
- **Campaign-level** (`sessionId = None`): a public "Party Loot & Leads" note and
  a private GM "Plot threads" note.

Each note gets sensible `tags`, `createdAt`/`updatedAt` near its session's date.

### 3. Chat + dice transcripts (heavy)

For **each completed session (1 & 2):**

- **~40+ `Message` docs**, built **programmatically from the actual seeded party
  names** (the four randomized player characters + the GM) so transcripts always
  match the seeded data. Content: GM scene-setting/narration and in-character
  player lines. Mostly `channel: "general"`, with a handful of `gm`-channel
  messages (GM coordinating a secret) to exercise role filtering. `type: "chat"`.
- **~15 `DiceRoll` docs**: attack rolls, damage rolls, skill checks
  (Perception/Investigation), and saving throws — including one natural-20 crit
  and one nat-1, and a couple on the `gm` channel. Shapes populate
  `attackRolls`/`damageRolls`/`totalDamages`/`rollInfo` per the schema.

For the **active session 3:** a few opening `general` messages + 1–2 rolls so the
live panel looks freshly underway (the session is "in progress").

**Sequencing:** `seq` is assigned sequentially per session across the combined
message+roll stream by `timestamp`; `timestamp` values are spread across the
session's play window (startDate → endDate). `authorId` comes from each seeded
user's identity string; `authorName` is the character name. `id` is a generated
uuid.

### 4. Code structure (`dev_seed.py`)

Add focused helpers in the existing style, invoked only when
`rich_session_history` is set:

- Session specs extended with `endDate` (relative offset) + `summary`.
- `seed_session_notes(db, *, campaign_id, session_ids, gm_id, player_users, now)`
  → inserts the note docs.
- `build_chat_transcript(*, session_id, campaign_id, party, gm, now, window)`
  → returns a list of `Message` docs (deterministic via the existing seeded
  `rng`).
- `build_dice_log(*, session_id, campaign_id, party, now, window)` → returns a
  list of `DiceRoll` docs.
- Insert via `db.messages.insert_many`, `db.dicerolls.insert_many`,
  `db.notes.insert_many`.

The party (names + user identities) is captured when the four players are
created, then threaded into the transcript builders.

### 5. Verification

`dev_seed.py` has no unit-test harness, so prove it empirically (as the seed-gm
fix was proven):

- Run the full seed against a **throwaway in-memory MongoDB** (e.g.
  `mongodb-memory-server` / a temp `mongod`), pointed via `MONGODB_URI` +
  `MONGODB_DB` — never the real dev Atlas DB.
- Assert: session 1 & 2 are `completed` with non-null `endDate` and non-empty
  `summary`; exactly one `active` session (3) with null `endDate`; note counts by
  visibility/scope; `messages`/`dicerolls` counts per session; every doc matches
  the model's required fields and enums.
- Assert the role filter behaves: a non-GM `listMessages`/`listDiceRolls`-style
  query (`channel: "general"` only) returns fewer docs than the GM view; private
  notes are returned only to `createdBy`.
- After it passes, the user runs `npm run dev:clear && npm run dev:seed` against
  the dev DB (this **wipes** the dev DB by design) and verifies in the browser.

## Out of scope (separate follow-ups)

- `SessionEvent` tabletop-state replay (reveal_document, map_change, etc.).
- Map / token / drawing seed data (the earlier sample-data list, items 1–3).
- Any change to the `Note` model to add a first-class GM-only visibility — we use
  private-by-GM instead.

## Risks / notes

- **Destructive reseed:** applying to the dev DB requires `dev:clear` (full wipe).
  Accepted by the user; the throwaway-DB verification de-risks the seed code
  itself before any wipe.
- **`authorId` for seeded players:** seeded player accounts may not have a stable
  provider identity until they log in via OAuth. Transcripts use whatever
  identity string the seeded user carries; for historical sessions the
  `authorName` (character) is what's displayed, so a non-matching `authorId` only
  affects "is this me" highlighting on past sessions — acceptable.
- Transcripts must stay deterministic (reuse the existing seeded `rng`) so seeds
  are reproducible.
