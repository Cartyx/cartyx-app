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


def test_dice_log_deterministic():
    start = NOW - timedelta(days=21)
    end = start + timedelta(hours=4)
    a = seed.build_dice_log(
        session_id=SESSION_IDS[1], campaign_id=CAMPAIGN_ID,
        party=PARTY, start_ts=start, end_ts=end, rng=random.Random(2), target_count=15,
    )
    b = seed.build_dice_log(
        session_id=SESSION_IDS[1], campaign_id=CAMPAIGN_ID,
        party=PARTY, start_ts=start, end_ts=end, rng=random.Random(2), target_count=15,
    )
    # Same seed → identical roll stream (titles, rollTypes, natural dice, ids).
    assert [(d["title"], d["rollType"], d["attackRolls"][0]["dice"]) for d in a] == \
           [(d["title"], d["rollType"], d["attackRolls"][0]["dice"]) for d in b], "dice log must be deterministic"
    assert [d["id"] for d in a] == [d["id"] for d in b], "dice ids must be deterministic"


def test_chat_transcript_spine_per_session():
    start = NOW
    end = start + timedelta(hours=4)
    # The GM opener (first message, channel general, authored by the GM) should
    # match the session's own spine — not fall back to session 1's.
    def opener(session_number):
        docs = seed.build_chat_transcript(
            session_id=SESSION_IDS[session_number], campaign_id=CAMPAIGN_ID,
            party=PARTY, gm_id=GM_ID, gm_name="Game Master",
            start_ts=start, end_ts=end, rng=random.Random(7),
            target_count=5, session_number=session_number,
        )
        return docs[0]["text"]
    o1, o2, o3 = opener(1), opener(2), opener(3)
    assert o1 != o2 != o3 and o1 != o3, "each session opens with its own narration"
    # Active session 3 is Wave Echo Cave — its opener must reference the cave,
    # not session 1's Triboar Trail ambush.
    assert "cave" in o3.lower(), f"session 3 opener should be cave-themed, got: {o3!r}"
    assert "triboar" not in o3.lower(), "session 3 must not reuse session 1's Triboar Trail narration"


def test_transcript_ids_are_session_scoped():
    # Re-seed safety: ids derive from (session_id, seq), and session ObjectIds
    # differ each run, so a fresh run produces non-colliding ids on the unique
    # {id:1} index. Same session_id → reproducible ids; different session_id →
    # disjoint ids. (Models a second `dev:seed` against a non-cleared DB.)
    start = NOW - timedelta(days=21)
    end = start + timedelta(hours=4)
    other_session = ObjectId()
    for builder, kwargs in (
        (seed.build_chat_transcript, dict(party=PARTY, gm_id=GM_ID,
                                          gm_name="Game Master", target_count=40)),
        (seed.build_dice_log, dict(party=PARTY, target_count=15)),
    ):
        run1 = builder(session_id=SESSION_IDS[1], campaign_id=CAMPAIGN_ID,
                       start_ts=start, end_ts=end, rng=random.Random(3), **kwargs)
        run1_again = builder(session_id=SESSION_IDS[1], campaign_id=CAMPAIGN_ID,
                             start_ts=start, end_ts=end, rng=random.Random(3), **kwargs)
        run2 = builder(session_id=other_session, campaign_id=CAMPAIGN_ID,
                       start_ts=start, end_ts=end, rng=random.Random(3), **kwargs)
        ids1 = [d["id"] for d in run1]
        assert ids1 == [d["id"] for d in run1_again], "ids reproducible for same session"
        assert set(ids1).isdisjoint(d["id"] for d in run2), \
            "ids must not collide across runs with different session ids"


def test_public_url_cdn_toggle():
    # Seed image URLs must flip between local paths (no CDN config — localhost
    # dev and CI) and full CDN URLs (deployed dev, where local files 404).
    import os
    from unittest import mock

    with mock.patch.dict(os.environ):  # restores the real env on exit
        for k in seed.CDN_ENV_KEYS:
            os.environ.pop(k, None)
        assert seed.cdn_base() is None, "no CDN without full config"
        assert seed.public_url("/uploads/campaigns/x.svg") == "/uploads/campaigns/x.svg"

        os.environ.update({
            "CDN_URL": "https://cdn-dev.example.io/",  # trailing slash on purpose
            "R2_ACCOUNT_ID": "acct",
            "R2_ACCESS_KEY_ID": "key",
            "R2_SECRET_ACCESS_KEY": "secret",
            "R2_BUCKET": "cartyx-dev",
        })
        assert seed.cdn_base() == "https://cdn-dev.example.io", "trailing slash stripped"
        assert (seed.public_url("/uploads/campaigns/x.svg")
                == "https://cdn-dev.example.io/uploads/campaigns/x.svg")
        avatar = seed.local_avatar_path("character", "Test Person")
        assert avatar.startswith("https://cdn-dev.example.io/uploads/seed-avatars/character/"), avatar

        # Partial config (bucket missing) must fall back to local paths rather
        # than emitting URLs nothing will ever upload to.
        os.environ.pop("R2_BUCKET")
        assert seed.cdn_base() is None, "partial R2 config must disable the CDN path"
        assert seed.public_url("/uploads/campaigns/x.svg") == "/uploads/campaigns/x.svg"


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
