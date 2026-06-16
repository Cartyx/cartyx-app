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
