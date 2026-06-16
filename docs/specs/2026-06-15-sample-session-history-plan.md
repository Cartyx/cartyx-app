# Sample Session History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the main test campaign ("The Lost Mines of Phandelver") emulate a real, in-progress D&D game from a fresh seed — two completed sessions with end dates, catch-up summaries, shared notes, and heavy chat/dice transcripts, plus an active session with GM-only prep notes.

**Architecture:** All changes live in `scripts/dev_seed.py`. New content is produced by **pure builder functions** (`build_note_docs`, `build_chat_transcript`, `build_dice_log`) that take ids/party/timestamps and return lists of plain dicts — so they are unit-testable without a database. `main()` calls them (guarded by a new `rich_session_history` flag on the main campaign) and bulk-inserts into `db.notes`, `db.messages`, `db.dicerolls`. A plain-Python verification script (`scripts/verify_session_seed.py`) asserts the builders' output; a final integration run exercises the full seed against a throwaway MongoDB.

**Tech Stack:** Python 3 + pymongo/bson (seed), MongoDB. Verification via plain `assert` (no pytest dependency), run with the project venv at `scripts/.venv`.

---

## Spec

`docs/specs/2026-06-15-sample-session-history-design.md`

## Conventions used throughout

- Run the seed venv python as: `scripts/.venv/bin/python <script>`. If the venv is missing: `python3 -m venv scripts/.venv && scripts/.venv/bin/pip install -r scripts/requirements.txt`.
- `bson.ObjectId` instances are passed into builders for `*_id` fields; builders set string fields (`id`, `authorId`) with `str(...)`.
- "Party" shape used by builders — a list of dicts, one per player character:
  ```python
  # {"name": "Bramble Underbough", "user_id": ObjectId(...)}
  ```
- GM identity for transcripts: `gm_name = "Game Master"`, `gm_id = <gm ObjectId>`.
- Channels: `"general"` (party-visible) and `"gm"` (GM-only). Message `type` is always `"chat"` for seeded transcript lines.

## File Structure

- **Modify:** `scripts/dev_seed.py`
  - Add `RICH_SESSION_NARRATIVE` content constants (session specs + line/roll pools) near the existing `CAMPAIGNS` block.
  - Add `"rich_session_history": True` and per-session `summary`/`end_offset_hours` to the main campaign's session specs.
  - Capture the created party (name + user `_id`) inside the per-campaign player loop.
  - Add pure builders: `build_note_docs(...)`, `build_chat_transcript(...)`, `build_dice_log(...)`.
  - In `main()`, after sessions are inserted, call the builders for the rich campaign and bulk-insert.
- **Create:** `scripts/verify_session_seed.py` — plain-Python assertion harness for the builders.

---

### Task 1: Session arc — dates, status, and catch-up summaries

**Files:**

- Modify: `scripts/dev_seed.py` (the `CAMPAIGNS` main-campaign entry, ~lines 251–309; the session-insert loop, ~lines 514–528)

- [ ] **Step 1: Add the `rich_session_history` flag and enrich the main campaign's session specs**

In `scripts/dev_seed.py`, in the first (main) campaign dict, add the flag near `"bulk_test_campaign": True`:

```python
        "stock_test_campaign": True,
        "bulk_test_campaign": True,
        "rich_session_history": True,
```

Replace that campaign's `"sessions": [...]` list (currently 3 entries with only name/number/status) with:

```python
        "sessions": [
            {
                "name": "Goblin Arrows",
                "number": 1,
                "status": "completed",
                # Played ~3 weeks ago, ran ~4 hours.
                "start_offset_days": 21,
                "end_offset_hours": 4,
                "summary": (
                    "## Session 1 — Goblin Arrows\n\n"
                    "The party set out from Neverwinter escorting Gundren Rockseeker's "
                    "supply wagon to Phandalin. On the Triboar Trail they were ambushed "
                    "by Cragmaw goblins.\n\n"
                    "### Key events\n"
                    "- Found two dead horses and signs Gundren and Sildar were taken\n"
                    "- Tracked the goblins to the **Cragmaw Hideout**\n"
                    "- Freed **Sildar Hallwinter**, who offered 50 gp to reach Phandalin\n"
                    "- Klarg the bugbear fell; the wagon was recovered"
                ),
            },
            {
                "name": "The Spider's Web",
                "number": 2,
                "status": "completed",
                # Played ~10 days ago.
                "start_offset_days": 10,
                "end_offset_hours": 4,
                "summary": (
                    "## Session 2 — The Spider's Web\n\n"
                    "The party reached Phandalin and ran afoul of the **Redbrand** "
                    "ruffians terrorizing the town.\n\n"
                    "### Key events\n"
                    "- Cleared the Redbrand hideout beneath Tresendar Manor\n"
                    "- Discovered Glasstaff (Iarno Albrek) was the Redbrands' leader\n"
                    "- Learned of the **Black Spider** and the search for Wave Echo Cave\n"
                    "- Rescued the Dendrar family and rest of the captives"
                ),
            },
            {
                "name": "Wave Echo Cave",
                "number": 3,
                "status": "active",
                # Starts today; no end date (in progress).
                "start_offset_days": 0,
                "end_offset_hours": None,
                "summary": (
                    "## Previously on… The Lost Mines of Phandelver\n\n"
                    "You freed Sildar, broke the Redbrands, and unmasked Glasstaff — who "
                    "served the mysterious **Black Spider**. With the map to **Wave Echo "
                    "Cave** in hand, you set out to find the lost mine and the Forge of "
                    "Spells before the Black Spider's forces beat you to it.\n\n"
                    "_Tonight: the cave mouth waits._"
                ),
            },
        ],
```

- [ ] **Step 2: Update the session-insert loop to write `endDate` and `summary`**

In `main()`, replace the session-insert block (the `for sess in sessions:` loop, ~lines 514–528) with:

```python
        # Insert sessions
        sessions = defn["sessions"]
        session_ids: dict[int, "ObjectId"] = {}
        for sess in sessions:
            start_offset_days = sess.get("start_offset_days", len(sessions) - sess["number"])
            start_date = now - timedelta(days=start_offset_days)
            # Pin start to 18:00 local-ish for realism; keep tz-aware UTC.
            start_date = start_date.replace(hour=18, minute=0, second=0, microsecond=0)
            end_hours = sess.get("end_offset_hours")
            end_date = start_date + timedelta(hours=end_hours) if end_hours else None
            doc = {
                "campaignId": campaign_id,
                "name": sess["name"],
                "gm": gm_id,
                "number": sess["number"],
                "startDate": start_date,
                "endDate": end_date,
                "status": sess["status"],
                "summary": sess.get("summary"),
                "createdAt": now,
                "updatedAt": now,
            }
            result = db.sessions.insert_one(doc)
            session_ids[sess["number"]] = result.inserted_id
            print(f"    session #{sess['number']}  {sess['name']} [{sess['status']}]"
                  f"{' (active)' if sess['status'] == 'active' else ''}")
```

Note: `session_ids` (number → ObjectId) and the per-session `start_date`/`end_date` are reused in Task 5. `summary` is `None` for the lean campaigns (their specs have no `summary` key), which matches the optional schema field.

- [ ] **Step 3: Smoke-check the file parses and the active-session invariant holds in the spec**

Run: `scripts/.venv/bin/python -c "import ast; ast.parse(open('scripts/dev_seed.py').read()); print('parse OK')"`
Expected: `parse OK`

Confirm by inspection that exactly one main-campaign session has `"status": "active"` (session 3) — the DB enforces a single active session per campaign via a partial unique index, so two would fail insertion.

- [ ] **Step 4: Commit**

```bash
git add scripts/dev_seed.py
git commit -m "feat(seed): session arc with end dates, status, and catch-up summaries

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Pure builder — notes (`build_note_docs`)

**Files:**

- Modify: `scripts/dev_seed.py` (add `build_note_docs` near the other builders, after the `CAMPAIGNS` block)
- Create: `scripts/verify_session_seed.py`

- [ ] **Step 1: Write the failing assertions**

Create `scripts/verify_session_seed.py`:

```python
"""Plain-assert verification for dev_seed session-history builders.

Run: scripts/.venv/bin/python scripts/verify_session_seed.py
Exits 0 on success, 1 on first failed assertion.
"""
import random
from datetime import datetime, timezone, timedelta
from bson import ObjectId

import dev_seed as seed  # importable: main() is guarded by __main__

NOW = datetime(2026, 6, 15, tzinfo=timezone.utc)
GM_ID = ObjectId()
CAMPAIGN_ID = ObjectId()
PARTY = [
    {"name": "Bramble Underbough", "user_id": ObjectId()},
    {"name": "Sister Garaele", "user_id": ObjectId()},
    {"name": "Dern Stonefist", "user_id": ObjectId()},
    {"name": "Lyric Half-Elven", "user_id": ObjectId()},
]
SESSION_IDS = {1: ObjectId(), 2: ObjectId(), 3: ObjectId()}


def test_note_docs():
    docs = seed.build_note_docs(
        campaign_id=CAMPAIGN_ID,
        session_ids=SESSION_IDS,
        gm_id=GM_ID,
        party=PARTY,
        now=NOW,
    )
    # Enough notes, all required fields present and correctly typed.
    assert len(docs) >= 10, f"expected >=10 notes, got {len(docs)}"
    for d in docs:
        assert set(["title", "note", "tags", "isPublic", "isReadOnly",
                    "createdBy", "campaignId", "createdAt", "updatedAt"]).issubset(d), d
        assert isinstance(d["isPublic"], bool)
        assert isinstance(d["tags"], list)
        assert d["campaignId"] == CAMPAIGN_ID
        # sessionId is either a known session id or None
        assert d.get("sessionId") in (None, *SESSION_IDS.values())
    # Public session-tied notes exist for sessions 1 and 2.
    pub_s1 = [d for d in docs if d["isPublic"] and d.get("sessionId") == SESSION_IDS[1]]
    pub_s2 = [d for d in docs if d["isPublic"] and d.get("sessionId") == SESSION_IDS[2]]
    assert pub_s1 and pub_s2, "need public notes tied to sessions 1 and 2"
    # GM-only = private notes authored by the GM, including on the active session 3.
    gm_private = [d for d in docs if not d["isPublic"] and d["createdBy"] == GM_ID]
    assert any(d.get("sessionId") == SESSION_IDS[3] for d in gm_private), \
        "need GM-only (private, GM-authored) notes on the active session"
    # Campaign-level notes (no session) exist, both a public and a private one.
    campaign_level = [d for d in docs if d.get("sessionId") is None]
    assert any(d["isPublic"] for d in campaign_level), "need a public campaign-level note"
    assert any(not d["isPublic"] and d["createdBy"] == GM_ID for d in campaign_level), \
        "need a private GM campaign-level note"
    # At least one public note is authored by a player (not the GM).
    player_ids = {p["user_id"] for p in PARTY}
    assert any(d["isPublic"] and d["createdBy"] in player_ids for d in docs), \
        "need a player-authored public note"


def run():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\n{len(tests)} builder check(s) passed.")


if __name__ == "__main__":
    import sys
    try:
        run()
    except AssertionError as e:
        print(f"FAIL: {e}")
        sys.exit(1)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd scripts && ../scripts/.venv/bin/python verify_session_seed.py; cd ..`
(Or: `scripts/.venv/bin/python -c "import sys; sys.path.insert(0,'scripts'); import verify_session_seed as v; v.run()"`)
Expected: FAIL with `AttributeError: module 'dev_seed' has no attribute 'build_note_docs'`

- [ ] **Step 3: Implement `build_note_docs`**

Add to `scripts/dev_seed.py` (after the `CAMPAIGNS` block, before `main()`):

```python
def build_note_docs(*, campaign_id, session_ids, gm_id, party, now):
    """Return a realistic mix of Note docs for the rich campaign.

    Visibility model (Note.ts has no GM-only flag): public notes use
    isPublic=True; "GM-only" notes are private (isPublic=False) authored by
    the GM, so only the GM can read them. Some public notes are authored by
    players to read like shared party notes.
    """
    s1, s2, s3 = session_ids[1], session_ids[2], session_ids[3]
    p = party  # shorthand; party[i]["user_id"], party[i]["name"]

    def note(title, body, *, public, author_id, session_id=None, tags=None,
             day_offset=0):
        ts = now - timedelta(days=day_offset)
        return {
            "title": title,
            "note": body,
            "tags": tags or [],
            "isPublic": public,
            "isReadOnly": False,
            "createdBy": author_id,
            "campaignId": campaign_id,
            "sessionId": session_id,
            "createdAt": ts,
            "updatedAt": ts,
        }

    docs = [
        # --- Public, session 1 (GM recap + a player observation) ---
        note("Recap: Goblin Arrows",
             "Ambushed on the Triboar Trail. Freed Sildar from the Cragmaw "
             "Hideout. Klarg is dead. Gundren is still missing — taken to "
             "Cragmaw Castle by someone called the Black Spider.",
             public=True, author_id=gm_id, session_id=s1,
             tags=["recap", "session-1"], day_offset=21),
        note("Sildar's offer",
             f"Sildar promised {50} gp if we get him safely to Phandalin. He's "
             "looking for his friend Iarno who went missing.",
             public=True, author_id=p[0]["user_id"], session_id=s1,
             tags=["npc", "quest"], day_offset=21),
        note("Loot from the hideout",
             "Recovered the supply wagon, a few potions, and Klarg's coin stash. "
             "Split evenly.",
             public=True, author_id=p[1]["user_id"], session_id=s1,
             tags=["loot", "session-1"], day_offset=21),
        # --- Public, session 2 ---
        note("Recap: The Spider's Web",
             "Phandalin was under the boot of the Redbrands. We cleared their "
             "hideout under Tresendar Manor and unmasked Glasstaff — Iarno "
             "Albrek. He served the Black Spider and pointed us at Wave Echo Cave.",
             public=True, author_id=gm_id, session_id=s2,
             tags=["recap", "session-2"], day_offset=10),
        note("People of Phandalin",
             "Townmaster Harbin Wester (useless), Sister Garaele at the "
             "Shrine of Luck, Barthen's Provisions, and the Stonehill Inn. "
             "Sister Garaele wants a spellbook from Old Owl Well.",
             public=True, author_id=p[2]["user_id"], session_id=s2,
             tags=["npc", "town"], day_offset=10),
        note("Glasstaff's letter",
             "Found a letter from the Black Spider ordering Glasstaff to find "
             "the cave and kill 'the Rockseekers.' Gundren has two brothers.",
             public=True, author_id=p[3]["user_id"], session_id=s2,
             tags=["clue", "session-2"], day_offset=10),
        # --- GM-only (private, GM-authored), active session 3 ---
        note("GM: Wave Echo Cave prep",
             "Nezznar 'The Black Spider' (drow) is in the cave with Bugbears "
             "and a doppelganger. Forge of Spells is in area 12. Flameskull "
             "guards the eastern hall — relights unless hit with holy water or "
             "downed twice.",
             public=False, author_id=gm_id, session_id=s3,
             tags=["gm", "prep", "boss"], day_offset=0),
        note("GM: traps & secrets",
             "Pressure plate at the cave entrance (DC 13 Perception). Secret "
             "door in area 7 (DC 15 Investigation) hides the Spider's escape "
             "route. Don't let the party TPK on the flameskull — fudge if needed.",
             public=False, author_id=gm_id, session_id=s3,
             tags=["gm", "traps"], day_offset=0),
        # --- Campaign-level (no session) ---
        note("Party Loot & Leads",
             "Running tally of shared loot and open leads. Current leads: find "
             "Cragmaw Castle, reach Wave Echo Cave, help Sister Garaele.",
             public=True, author_id=p[0]["user_id"], session_id=None,
             tags=["loot", "leads"], day_offset=2),
        note("GM: campaign plot threads",
             "Black Spider = Nezznar, wants the Forge of Spells. Gundren held "
             "at Cragmaw Castle (King Grol). Reward the party with the mine "
             "stake if they save Gundren. Long game: Spider's drow backers.",
             public=False, author_id=gm_id, session_id=None,
             tags=["gm", "plot"], day_offset=2),
        note("House rules",
             "Potions are a bonus action to drink. Inspiration refreshes each "
             "session. We use flanking (advantage).",
             public=True, author_id=gm_id, session_id=None,
             tags=["rules"], day_offset=21),
    ]
    return docs
```

- [ ] **Step 4: Run the verification to confirm it passes**

Run: `scripts/.venv/bin/python -c "import sys; sys.path.insert(0,'scripts'); import verify_session_seed as v; v.run()"`
Expected: `ok  test_note_docs` and `1 builder check(s) passed.`

- [ ] **Step 5: Commit**

```bash
git add scripts/dev_seed.py scripts/verify_session_seed.py
git commit -m "feat(seed): build_note_docs — public/GM-only/campaign note mix + verify harness

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Pure builder — chat transcript (`build_chat_transcript`)

**Files:**

- Modify: `scripts/dev_seed.py` (add `build_chat_transcript`)
- Modify: `scripts/verify_session_seed.py` (add `test_chat_transcript`)

- [ ] **Step 1: Write the failing assertions**

Add to `scripts/verify_session_seed.py` (before `run()`):

```python
def test_chat_transcript():
    start = NOW - timedelta(days=21)
    end = start + timedelta(hours=4)
    rng = random.Random(1)
    docs = seed.build_chat_transcript(
        session_id=SESSION_IDS[1], campaign_id=CAMPAIGN_ID,
        party=PARTY, gm_id=GM_ID, gm_name="Game Master",
        start_ts=start, end_ts=end, rng=rng, target_count=40,
    )
    assert len(docs) >= 40, f"expected >=40 messages, got {len(docs)}"
    seqs = [d["seq"] for d in docs]
    assert seqs == list(range(1, len(docs) + 1)), "seq must be 1..N in order"
    ts = [d["timestamp"] for d in docs]
    assert ts == sorted(ts), "timestamps must be non-decreasing"
    start_ms, end_ms = int(start.timestamp() * 1000), int(end.timestamp() * 1000)
    ids = set()
    for d in docs:
        assert set(["id", "seq", "sessionId", "campaignId", "channel", "type",
                    "authorId", "authorName", "text", "timestamp",
                    "createdAt"]).issubset(d), d
        assert d["channel"] in ("general", "gm")
        assert d["type"] == "chat"
        assert isinstance(d["authorId"], str) and d["authorId"], "authorId is a non-empty str"
        assert d["text"], "no empty messages"
        assert start_ms <= d["timestamp"] <= end_ms, "timestamp within session window"
        ids.add(d["id"])
    assert len(ids) == len(docs), "message ids must be unique"
    # Both GM and player authors present; some gm-channel lines for role filtering.
    assert any(d["authorName"] == "Game Master" for d in docs)
    assert any(d["authorName"] != "Game Master" for d in docs)
    assert any(d["channel"] == "gm" for d in docs), "need some gm-channel messages"
    assert any(d["channel"] == "general" for d in docs)
    # Determinism: same rng seed → identical output.
    docs2 = seed.build_chat_transcript(
        session_id=SESSION_IDS[1], campaign_id=CAMPAIGN_ID,
        party=PARTY, gm_id=GM_ID, gm_name="Game Master",
        start_ts=start, end_ts=end, rng=random.Random(1), target_count=40,
    )
    assert [d["text"] for d in docs] == [d["text"] for d in docs2], "must be deterministic"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `scripts/.venv/bin/python -c "import sys; sys.path.insert(0,'scripts'); import verify_session_seed as v; v.run()"`
Expected: FAIL with `AttributeError: module 'dev_seed' has no attribute 'build_chat_transcript'`

- [ ] **Step 3: Implement `build_chat_transcript`**

First, add `import uuid` to the top of `scripts/dev_seed.py` if it is not already imported. Then add the content pools and the builder near `build_note_docs`. It seeds a handwritten narrative spine then pads with in-character banter drawn deterministically from `rng`, assigning monotonic timestamps across the window and `seq` 1..N:

```python
# Generic in-character banter the builder samples to pad transcripts to length.
# Speaker is a player; lines are character-agnostic so any party fits.
_BANTER_POOL = [
    "I check the room for traps before anyone touches anything.",
    "Can I make a Perception check? Something feels off.",
    "I ready my weapon and move to the front.",
    "Wait — did anyone else hear that?",
    "I take cover behind the rubble and nock an arrow.",
    "Let me try to talk to it first. Diplomacy, remember?",
    "I'm going to search the bodies for anything useful.",
    "Do we rest here or push on? I'm down to half my spell slots.",
    "I light a torch and hold it high.",
    "That's a terrible plan. I love it. Let's go.",
    "I keep watch on the corridor while you all loot.",
    "Mark it on the map — we'll want to come back here.",
]

# GM narration spine per session number; first item sets the scene.
_GM_SPINE = {
    1: [
        "The Triboar Trail bends ahead. Two dead horses lie across the path, "
        "bristling with black-feathered arrows.",
        "Four goblins burst from the underbrush! Roll initiative.",
        "The trail of the captives leads northwest, toward a cave by a stream.",
        "Inside the Cragmaw Hideout, a snarl of goblin voices echoes off wet stone.",
        "Klarg the bugbear rises, wolf at his side, and bellows a challenge.",
        "With Klarg down, you find Sildar Hallwinter bound and bloodied but alive.",
    ],
    2: [
        "Phandalin spreads out before you — a few dozen buildings, a ruined "
        "manor on the hill. Rough-looking men loiter outside the Sleeping Giant.",
        "The Redbrands sneer: 'You must be new. This is our town now.'",
        "Beneath Tresendar Manor, a natural cavern opens into worked stone.",
        "A nothic skitters in the dark, its single eye fixing on you hungrily.",
        "Glasstaff's quarters: papers everywhere, and a half-burned letter in the grate.",
        "The letter is sealed with a spider sigil. It is signed 'The Black Spider.'",
    ],
}

# A couple of GM-channel (secret) lines per session for role-filter testing.
_GM_CHANNEL_LINES = [
    "(GM) Reminder: the bugbear has 7 HP left and will flee at 5.",
    "(GM) The doppelganger is posing as a captive — play it friendly for now.",
    "(GM) Secret door behind the tapestry if they roll a 15+.",
]


def build_chat_transcript(*, session_id, campaign_id, party, gm_id, gm_name,
                          start_ts, end_ts, rng, target_count, session_number=1):
    """Return a deterministic list of Message docs for one session.

    Interleaves GM narration (the per-session-number spine) with player banter
    to ~target_count lines, plus a few gm-channel asides. seq is 1..N;
    timestamps are monotonic across [start_ts, end_ts]. authorId is
    str(user_id); authorName is the speaker.
    """
    spine = list(_GM_SPINE.get(session_number, _GM_SPINE[1]))
    lines = []  # (channel, author_id, author_name, text)

    # 1) GM opens the scene.
    lines.append(("general", str(gm_id), gm_name, spine.pop(0)))

    # 2) Interleave: a couple of player lines, then a GM spine beat, repeat.
    spine_idx = 0
    while len(lines) < target_count:
        for _ in range(rng.randint(2, 4)):
            pc = rng.choice(party)
            text = rng.choice(_BANTER_POOL).format(pc=rng.choice(party)["name"])
            lines.append(("general", str(pc["user_id"]), pc["name"], text))
            if len(lines) >= target_count:
                break
        if spine:
            lines.append(("general", str(gm_id), gm_name, spine.pop(0)))

    # 3) Sprinkle in 2-3 gm-channel asides (GM author).
    for aside in _GM_CHANNEL_LINES[: rng.randint(2, 3)]:
        pos = rng.randint(1, len(lines))
        lines.insert(pos, ("gm", str(gm_id), gm_name, aside))

    # 4) Assign monotonic timestamps across the window and seq 1..N.
    span_ms = max(int((end_ts - start_ts).total_seconds() * 1000), len(lines))
    start_ms = int(start_ts.timestamp() * 1000)
    step = span_ms // len(lines)
    docs = []
    for i, (channel, author_id, author_name, text) in enumerate(lines):
        docs.append({
            "id": str(uuid.UUID(int=rng.getrandbits(128))),
            "seq": i + 1,
            "sessionId": session_id,
            "campaignId": campaign_id,
            "channel": channel,
            "type": "chat",
            "authorId": author_id,
            "authorName": author_name,
            "text": text,
            "beyond20Data": None,
            "timestamp": start_ms + i * step,
            "createdAt": start_ts,
        })
    return docs
```

The verification's `test_chat_transcript` calls without `session_number`, which defaults to 1 — fine. (Task 5 passes the real number.)

- [ ] **Step 4: Run the verification to confirm it passes**

Run: `scripts/.venv/bin/python -c "import sys; sys.path.insert(0,'scripts'); import verify_session_seed as v; v.run()"`
Expected: `ok  test_chat_transcript` (and `test_note_docs`) pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/dev_seed.py scripts/verify_session_seed.py
git commit -m "feat(seed): build_chat_transcript — deterministic per-session chat history

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Pure builder — dice log (`build_dice_log`)

**Files:**

- Modify: `scripts/dev_seed.py` (add `build_dice_log`)
- Modify: `scripts/verify_session_seed.py` (add `test_dice_log`)

- [ ] **Step 1: Write the failing assertions**

Add to `scripts/verify_session_seed.py` (before `run()`):

```python
def test_dice_log():
    start = NOW - timedelta(days=21)
    end = start + timedelta(hours=4)
    rng = random.Random(2)
    docs = seed.build_dice_log(
        session_id=SESSION_IDS[1], campaign_id=CAMPAIGN_ID,
        party=PARTY, start_ts=start, end_ts=end, rng=rng, target_count=15,
    )
    assert len(docs) >= 15, f"expected >=15 rolls, got {len(docs)}"
    assert [d["seq"] for d in docs] == list(range(1, len(docs) + 1))
    start_ms, end_ms = int(start.timestamp() * 1000), int(end.timestamp() * 1000)
    ids = set()
    for d in docs:
        assert set(["id", "seq", "sessionId", "campaignId", "channel",
                    "character", "title", "rollType", "attackRolls",
                    "damageRolls", "totalDamages", "rollInfo", "timestamp",
                    "createdAt"]).issubset(d), d
        assert d["channel"] in ("general", "gm")
        assert isinstance(d["attackRolls"], list)
        assert isinstance(d["damageRolls"], list)
        assert start_ms <= d["timestamp"] <= end_ms
        # attack roll subdocs are well-formed when present
        for ar in d["attackRolls"]:
            assert set(["roll", "type", "total", "formula", "discarded", "dice"]).issubset(ar)
            assert ar["type"] in ("hit", "crit", "miss", "crit-fail")
            assert isinstance(ar["dice"], list)
        for dr in d["damageRolls"]:
            assert set(["damageType", "dice", "total", "flags", "formula"]).issubset(dr)
        ids.add(d["id"])
    assert len(ids) == len(docs), "roll ids unique"
    # Variety: at least one crit (nat 20) and one crit-fail (nat 1) somewhere.
    types = [ar["type"] for d in docs for ar in d["attackRolls"]]
    assert "crit" in types, "need a natural-20 crit"
    assert "crit-fail" in types, "need a natural-1 fumble"
    # Some rolls are skill checks / saves (rollType variety).
    roll_types = {d["rollType"] for d in docs}
    assert len(roll_types) >= 3, f"need varied rollTypes, got {roll_types}"
    assert any(d["channel"] == "gm" for d in docs), "need a gm-channel roll"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `scripts/.venv/bin/python -c "import sys; sys.path.insert(0,'scripts'); import verify_session_seed as v; v.run()"`
Expected: FAIL with `AttributeError: module 'dev_seed' has no attribute 'build_dice_log'`

- [ ] **Step 3: Implement `build_dice_log`**

Add to `scripts/dev_seed.py`:

```python
def _d20(rng):
    return rng.randint(1, 20)


def build_dice_log(*, session_id, campaign_id, party, start_ts, end_ts, rng,
                   target_count):
    """Return a deterministic list of DiceRoll docs for one session.

    Produces a mix of attack rolls (with damage), skill checks, and saving
    throws, guaranteeing at least one nat-20 crit and one nat-1 fumble, plus
    one gm-channel roll. seq is 1..N; timestamps monotonic across the window.
    """
    rolls = []  # each: dict ready except seq/timestamp/id

    def attack(character, title, *, force=None, channel="general"):
        nat = {"crit": 20, "crit-fail": 1}.get(force) or _d20(rng)
        bonus = rng.randint(3, 7)
        rtype = ("crit" if nat == 20 else "crit-fail" if nat == 1
                 else "hit" if nat + bonus >= 13 else "miss")
        total = nat + bonus
        roll = {
            "channel": channel, "character": character, "title": title,
            "rollType": "attack",
            "attackRolls": [{
                "roll": 1, "type": rtype, "total": total,
                "formula": f"1d20+{bonus}", "discarded": False, "dice": [nat],
            }],
            "damageRolls": [], "totalDamages": {}, "rollInfo": [], "description": "",
        }
        if rtype in ("hit", "crit"):
            d1, d2 = rng.randint(1, 8), rng.randint(1, 8)
            dmg = d1 + d2 + (d1 + d2 if rtype == "crit" else 0)
            roll["damageRolls"] = [{
                "damageType": "Slashing", "dice": [d1, d2], "total": dmg,
                "flags": 16 if rtype == "crit" else 0, "formula": "2d8",
            }]
            roll["totalDamages"] = {"Slashing": dmg}
        return roll

    def check(character, ability, *, channel="general"):
        nat = _d20(rng)
        bonus = rng.randint(0, 6)
        return {
            "channel": channel, "character": character, "title": f"{ability} Check",
            "rollType": "skill-check",
            "attackRolls": [{
                "roll": 1, "type": "hit", "total": nat + bonus,
                "formula": f"1d20+{bonus}", "discarded": False, "dice": [nat],
            }],
            "damageRolls": [], "totalDamages": {},
            "rollInfo": [["Ability", ability]], "description": "",
        }

    def save(character, ability, *, channel="general"):
        nat = _d20(rng)
        bonus = rng.randint(0, 5)
        return {
            "channel": channel, "character": character, "title": f"{ability} Save",
            "rollType": "saving-throw",
            "attackRolls": [{
                "roll": 1, "type": "hit", "total": nat + bonus,
                "formula": f"1d20+{bonus}", "discarded": False, "dice": [nat],
            }],
            "damageRolls": [], "totalDamages": {},
            "rollInfo": [["Save", ability]], "description": "",
        }

    names = [p["name"] for p in party]
    # Guaranteed variety up front.
    rolls.append(attack(names[0], "Longsword Attack", force="crit"))
    rolls.append(attack(names[1], "Shortbow Attack", force="crit-fail"))
    rolls.append(check(names[2], "Perception"))
    rolls.append(check(names[3], "Investigation"))
    rolls.append(save(names[0], "Dexterity", channel="gm"))  # gm-channel roll
    # Pad to target with random rolls.
    makers = [
        lambda n: attack(n, "Weapon Attack"),
        lambda n: check(n, rng.choice(["Perception", "Insight", "Stealth", "Arcana"])),
        lambda n: save(n, rng.choice(["Strength", "Wisdom", "Constitution"])),
    ]
    while len(rolls) < target_count:
        rolls.append(rng.choice(makers)(rng.choice(names)))

    # Assign timestamps + seq + id.
    span_ms = max(int((end_ts - start_ts).total_seconds() * 1000), len(rolls))
    start_ms = int(start_ts.timestamp() * 1000)
    step = span_ms // len(rolls)
    docs = []
    for i, r in enumerate(rolls):
        r.update({
            "id": str(uuid.UUID(int=rng.getrandbits(128))),
            "seq": i + 1,
            "sessionId": session_id,
            "campaignId": campaign_id,
            "timestamp": start_ms + i * step,
            "createdAt": start_ts,
        })
        docs.append(r)
    return docs
```

- [ ] **Step 4: Run the verification to confirm it passes**

Run: `scripts/.venv/bin/python -c "import sys; sys.path.insert(0,'scripts'); import verify_session_seed as v; v.run()"`
Expected: all three checks pass (`test_chat_transcript`, `test_dice_log`, `test_note_docs`).

- [ ] **Step 5: Commit**

```bash
git add scripts/dev_seed.py scripts/verify_session_seed.py
git commit -m "feat(seed): build_dice_log — varied per-session dice history

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Wire builders into `main()` + integration verification

**Files:**

- Modify: `scripts/dev_seed.py` (capture party in the player loop; call builders + insert after sessions; guarded by `rich_session_history`)

- [ ] **Step 1: Capture the party during player creation**

In `main()`, in the per-campaign player loop (~lines 475–512), initialize a party list before the loop and append each created player. Just before `for pu in player_users:` add:

```python
        party = []
```

Inside the loop, right after the `db.players.insert_one({...})` call (after the existing `print(...)`), add:

```python
            party.append({"name": f"{pc['firstName']} {pc['lastName']}",
                          "user_id": pu["_id"]})
```

- [ ] **Step 2: Call the builders and insert, gated by the flag**

In `main()`, immediately AFTER the session-insert loop from Task 1 (after `session_ids` is fully populated) and before the LocationTypes insert, add:

```python
        # Rich session history — notes, chat, and dice for the main campaign so
        # past sessions look genuinely played and the active session is underway.
        if defn.get("rich_session_history"):
            note_docs = build_note_docs(
                campaign_id=campaign_id, session_ids=session_ids,
                gm_id=gm_id, party=party, now=now,
            )
            if note_docs:
                db.notes.insert_many(note_docs)
            print(f"    notes      inserted {len(note_docs)}")

            msg_total = roll_total = 0
            # Completed sessions 1 & 2 get heavy transcripts; active session 3
            # gets a light "just underway" transcript.
            transcript_plan = {1: (40, 15), 2: (40, 15), 3: (5, 2)}
            for num, (n_msgs, n_rolls) in transcript_plan.items():
                sid = session_ids[num]
                sess_spec = next(s for s in sessions if s["number"] == num)
                s_start = (now - timedelta(days=sess_spec.get("start_offset_days", 0))
                           ).replace(hour=18, minute=0, second=0, microsecond=0)
                eh = sess_spec.get("end_offset_hours") or 4
                s_end = s_start + timedelta(hours=eh)
                msgs = build_chat_transcript(
                    session_id=sid, campaign_id=campaign_id, party=party,
                    gm_id=gm_id, gm_name="Game Master", start_ts=s_start,
                    end_ts=s_end, rng=rng, target_count=n_msgs, session_number=num,
                )
                rolls = build_dice_log(
                    session_id=sid, campaign_id=campaign_id, party=party,
                    start_ts=s_start, end_ts=s_end, rng=rng, target_count=n_rolls,
                )
                if msgs:
                    db.messages.insert_many(msgs)
                if rolls:
                    db.dicerolls.insert_many(rolls)
                msg_total += len(msgs)
                roll_total += len(rolls)
            print(f"    chat       inserted {msg_total} messages")
            print(f"    dice       inserted {roll_total} rolls")
```

- [ ] **Step 3: Re-run the builder verification (no regression)**

Run: `scripts/.venv/bin/python -c "import sys; sys.path.insert(0,'scripts'); import verify_session_seed as v; v.run()"`
Expected: all builder checks still pass.

- [ ] **Step 4: Integration run against a throwaway MongoDB**

Do NOT use the real dev Atlas DB. Start an ephemeral MongoDB and run the full seed against it.

If `docker` is available:

```bash
docker run -d -p 37017:27017 --name cartyx-seed-check mongo:8
export MONGODB_URI="mongodb://localhost:37017"
export MONGODB_DB="cartyx_seed_check"
node scripts/seed-gm.cjs
scripts/.venv/bin/python scripts/dev_seed.py
```

(If docker is unavailable, use `mongodb-memory-server` to obtain a URI, or a temp `mongod`, and point `MONGODB_URI`/`MONGODB_DB` at it.)

Then assert the result with a one-off check:

```bash
scripts/.venv/bin/python - <<'PY'
import os
from pymongo import MongoClient
db = MongoClient(os.environ["MONGODB_URI"])[os.environ["MONGODB_DB"]]
camp = db.campaigns.find_one({"name": "The Lost Mines of Phandelver"})
cid = camp["_id"]
sess = list(db.sessions.find({"campaignId": cid}).sort("number", 1))
assert len(sess) == 3, sess
assert sess[0]["status"] == "completed" and sess[0]["endDate"] and sess[0]["summary"]
assert sess[1]["status"] == "completed" and sess[1]["endDate"] and sess[1]["summary"]
assert sess[2]["status"] == "active" and sess[2]["endDate"] is None and sess[2]["summary"]
active = list(db.sessions.find({"campaignId": cid, "status": "active"}))
assert len(active) == 1, "exactly one active session"
notes = list(db.notes.find({"campaignId": cid}))
assert len(notes) >= 10
assert any(n["isPublic"] and n.get("sessionId") for n in notes)
assert any((not n["isPublic"]) and n["createdBy"] == camp["gameMasterId"] for n in notes)
for num in (1, 2):
    sid = sess[num - 1]["_id"]
    msgs = list(db.messages.find({"sessionId": sid}))
    rolls = list(db.dicerolls.find({"sessionId": sid}))
    assert len(msgs) >= 40, (num, len(msgs))
    assert len(rolls) >= 15, (num, len(rolls))
    # role filter: GM sees all, players see only general
    gen = [m for m in msgs if m["channel"] == "general"]
    assert len(gen) < len(msgs), "some gm-channel messages must exist"
print("INTEGRATION OK")
PY
```

Expected: `INTEGRATION OK`

Clean up: `docker rm -f cartyx-seed-check` (or stop the temp mongod).

- [ ] **Step 5: Commit**

```bash
git add scripts/dev_seed.py
git commit -m "feat(seed): wire session notes/chat/dice into the main campaign seed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Apply to the dev database (manual, after the plan is complete)

This is a **destructive** refresh of the dev DB (accepted in the design). The user runs it themselves against the real dev DB:

```bash
npm run dev:clear   # wipes the dev DB
npm run dev:seed    # reseeds with the rich session history
```

Then verify in the browser: open the main campaign, select session 1 or 2 (full chat + dice transcript + recap + notes), confirm session 3 shows as active with the catch-up summary on the dashboard and GM-only prep notes visible only to the GM.

## Self-review notes

- **Spec coverage:** end dates (Task 1), `summary` catch-up incl. active session (Task 1), active status + single-active invariant (Task 1/Step 4 of Task 5), public/GM-only/campaign notes (Task 2), heavy chat ≥40 + dice ≥15 with gm-channel (Tasks 3–4), active-session light transcript (Task 5), deterministic transcripts via shared `rng` (Tasks 3–4 determinism assertions), throwaway-DB verification before reseed (Task 5/Step 4). All covered.
- **Type/name consistency:** builder names (`build_note_docs`, `build_chat_transcript`, `build_dice_log`) and their keyword args are identical across the verification harness and the `main()` call sites; `session_ids` is a `{number: ObjectId}` dict everywhere; `party` is `[{"name", "user_id"}]` everywhere. `build_chat_transcript` takes an optional `session_number` (defaults to 1 in the unit check; the real number is passed in Task 5).
