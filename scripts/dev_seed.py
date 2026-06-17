#!/usr/bin/env python3
"""
Seed the dev database with 3 test campaigns, each with sessions,
characters, and a generated placeholder SVG image.

Usage:
    scripts/.venv/bin/python scripts/dev_seed.py

Shortcut:
    npm run dev:seed

Prerequisites:
    - MONGODB_URI must be set (via .env or shell export)
    - A User document with role "gm" must exist

Safety: refuses to run if NODE_ENV is "production" or MONGODB_URI contains "prod".
"""

import hashlib
import os
import random
import re
import secrets
import shutil
import sys
import uuid
from datetime import datetime, timedelta, timezone
from html import escape
from pathlib import Path

from dotenv import load_dotenv
from bson import ObjectId
from pymongo import MongoClient
from pymongo.errors import ConfigurationError

# Sibling modules for reference data — kept out of this file to keep it
# focused on insertion logic.
from seed_player_data import PLAYER_EMAILS, PLAYER_IMAGES, random_pc
from seed_monster_data import build_monster_docs
from seed_calendar_data import HARPTOS, to_ordinal


def import_srd_races(db, *, campaign_id, gm_id, now) -> int:
    """Insert every docs/srd/races/*.md as a Race document for the campaign."""
    races_dir = REPO_ROOT / "docs" / "srd" / "races"
    if not races_dir.exists():
        return 0
    docs = []
    for md in sorted(races_dir.glob("*.md")):
        content = md.read_text(encoding="utf-8")
        title = md.stem.replace("-", " ").title()
        docs.append({
            "title": title,
            "content": content,
            "tags": ["srd"],
            "campaignId": campaign_id,
            "createdBy": gm_id,
            "createdAt": now,
            "updatedAt": now,
        })
    if docs:
        db.races.insert_many(docs)
    return len(docs)


def import_srd_rules(db, *, campaign_id, gm_id, now) -> int:
    """Insert every docs/srd/rules/**/*.md as a Rule document for the campaign."""
    rules_root = REPO_ROOT / "docs" / "srd" / "rules"
    if not rules_root.exists():
        return 0
    docs = []
    for md in sorted(rules_root.rglob("*.md")):
        content = md.read_text(encoding="utf-8")
        section = md.parent.name  # e.g. "combat", "spells"
        title = md.stem.replace("-", " ").title()
        docs.append({
            "title": title,
            "content": content,
            "tags": ["srd", section],
            "isPublic": True,
            "campaignId": campaign_id,
            "createdBy": gm_id,
            "createdAt": now,
            "updatedAt": now,
        })
    if docs:
        db.rules.insert_many(docs)
    return len(docs)


def bulk_npc_specs(rng: random.Random, count: int) -> list[dict]:
    """Generate `count` NPC stat specs from name pools, for volume testing."""
    from seed_player_data import (
        FIRST_NAMES,
        LAST_NAMES,
        RACES,
        CLASSES,
        BACKSTORIES,
    )
    factions = [
        "Crown Guard", "Thieves' Guild", "Crimson Order", "Driftwood Watch",
        "Silver Pact", "Iron Brotherhood", "Hollow Court", "Skyforge Clan",
        "Emerald Conclave", "Stormcaller Circle",
    ]
    out = []
    for _ in range(count):
        first = rng.choice(FIRST_NAMES)
        last = rng.choice(LAST_NAMES)
        out.append({
            "firstName": first,
            "lastName": last,
            "race": rng.choice(RACES),
            "characterClass": rng.choice(CLASSES),
            "notes": rng.choice(BACKSTORIES),
            "faction": rng.choice(factions),
        })
    return out


def ensure_player_users(db, now) -> list[dict]:
    """Find-or-create the 4 player User accounts referenced by email.

    New users get role='unknown' and no provider info — they claim those
    fields on first OAuth login.  Returns the list of user docs (each with
    `_id` and `email`) in the order defined by PLAYER_EMAILS so the seed's
    Player insertion can rely on stable ordering.
    """
    out = []
    for email in PLAYER_EMAILS:
        existing = db.users.find_one({"email": email})
        if existing:
            out.append({"_id": existing["_id"], "email": email})
            continue
        result = db.users.insert_one({
            "email": email,
            "role": "unknown",
            "firstName": "",
            "lastName": "",
            "avatarUrl": "",
            "campaigns": [],
            "createdAt": now,
            "updatedAt": now,
        })
        out.append({"_id": result.inserted_id, "email": email})
    return out


def local_avatar_path(kind: str, name: str) -> str:
    """Deterministic served path for a generated local avatar.

    The PNG itself is produced by `scripts/gen_seed_avatars.mjs` (run via
    `npm run dev:gen-avatars`) — Python has no SVG rasteriser, so the seed only
    records the path and the Node generator renders the identicon there. The
    hash MUST stay in sync with that script: sha1("{kind}:{name}")[:16].
    Local files avoid DiceBear's CDN rate limit (which 429s the burst of ~350
    avatar requests the wiki fires on load) and work offline.
    """
    digest = hashlib.sha1(f"{kind}:{name}".encode("utf-8")).hexdigest()[:16]
    return f"/uploads/seed-avatars/{kind}/{digest}.png"


def adventurer_avatar(first_name: str, last_name: str) -> str:
    """Local generated avatar path for a character (see local_avatar_path)."""
    return local_avatar_path("character", f"{first_name} {last_name}".strip())

load_dotenv()

# Repo root anchored to this script's location (scripts/ is one level down)
REPO_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Safety
# ---------------------------------------------------------------------------

def require_mongo_uri() -> str:
    if os.environ.get("NODE_ENV") == "production":
        sys.exit("Refusing to run in production.")
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        sys.exit("MONGODB_URI is not set.")
    if re.search(r"prod", uri, re.IGNORECASE):
        sys.exit("MONGODB_URI looks like a production connection string. Aborting.")
    return uri


# ---------------------------------------------------------------------------
# SVG placeholder generation
# ---------------------------------------------------------------------------

def generate_campaign_svg(title: str, colors: dict[str, str]) -> str:
    initials = "".join(w[0] for w in title.split() if w)[:3].upper()
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:{colors['bg']}"/>
      <stop offset="100%" style="stop-color:{colors['accent']}"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="{colors['fg']}" stroke-opacity="0.08" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="800" height="450" fill="url(#bg)"/>
  <rect width="800" height="450" fill="url(#grid)"/>
  <circle cx="400" cy="180" r="80" fill="{colors['fg']}" fill-opacity="0.15"/>
  <text x="400" y="200" text-anchor="middle" font-family="Georgia, serif" font-size="64" font-weight="bold" fill="{colors['fg']}">{initials}</text>
  <text x="400" y="320" text-anchor="middle" font-family="Georgia, serif" font-size="28" fill="{colors['fg']}">{escape(title)}</text>
  <text x="400" y="360" text-anchor="middle" font-family="sans-serif" font-size="14" fill="{colors['fg']}" fill-opacity="0.6">Test Campaign — Dev Seed</text>
</svg>"""


def save_image(svg_content: str, filename: str) -> str:
    uploads_dir = REPO_ROOT / "public" / "uploads" / "campaigns"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    (uploads_dir / filename).write_text(svg_content, encoding="utf-8")
    return f"/uploads/campaigns/{filename}"


def copy_player_portraits() -> None:
    """Publish the 12 committed player portraits so the URLs the player docs
    reference (`/uploads/seed-players/playerN.jpg`, see PLAYER_IMAGES) actually
    resolve. The source files live in `assets/` (not web-served); Vite only
    serves `public/` at the site root, so each portrait is copied into
    `public/uploads/seed-players/`. Idempotent — overwrites on every seed."""
    src_dir = REPO_ROOT / "assets"
    dst_dir = REPO_ROOT / "public" / "uploads" / "seed-players"
    dst_dir.mkdir(parents=True, exist_ok=True)
    copied = 0
    missing = []
    for i in range(1, 13):
        src = src_dir / f"player{i}.jpg"
        if not src.exists():
            missing.append(src.name)
            continue
        shutil.copyfile(src, dst_dir / f"player{i}.jpg")
        copied += 1
    print(f"Player portraits: copied {copied}/12 → public/uploads/seed-players/")
    if missing:
        print(f"  WARNING missing portrait sources: {', '.join(missing)}")


# ---------------------------------------------------------------------------
# Campaign data
# ---------------------------------------------------------------------------

# Default location types from app/server/db/models/LocationType.ts.
# Auto-seeded on first listLocationTypes request, but pre-seeding here makes
# the dev/e2e environment deterministic.
DEFAULT_LOCATION_TYPES = [
    "continent", "country", "region", "state", "province",
    "city", "town", "village", "cave", "dungeon", "planet",
]


CAMPAIGNS = [
    {
        # The "stock" / comprehensive test campaign — receives the full
        # bundle of SRD-imported races + rules, several hundred monsters,
        # and several hundred characters. Designed to exercise list
        # rendering, search, filtering, and drag-to-token at realistic
        # scale.  The other two campaigns stay lean for happy-path testing.
        "stock_test_campaign": True,
        "bulk_test_campaign": True,
        "rich_session_history": True,
        "name": "The Lost Mines of Phandelver",
        "description": (
            "A classic introductory adventure. The party has been hired to escort a wagon "
            "of supplies to the rough-and-tumble settlement of Phandalin. Along the way, "
            "they stumble into a web of intrigue involving the mysterious Wave Echo Cave."
        ),
        "locations": [
            {
                "name": "Phandalin",
                "locationType": "town",
                "description": (
                    "A rough-and-tumble frontier settlement on the Triboar Trail. "
                    "Once destroyed by orcs, recently resettled by farmers and prospectors."
                ),
                "isPublic": True,
                "tags": ["starting-area", "town"],
            },
        ],
        "schedule": {
            "frequency": "weekly",
            "dayOfWeek": "Saturday",
            "time": "18:00",
            "timezone": "America/Chicago",
        },
        "maxPlayers": 5,
        "colors": {"bg": "#1a3a2a", "fg": "#e8e0d0", "accent": "#2d5a3f"},
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
        "characters": [
            {
                "firstName": "Thorin",
                "lastName": "Ironforge",
                "race": "Dwarf",
                "characterClass": "Fighter",
                "location": "Phandalin",
                "notes": "Veteran miner turned adventurer. Seeking revenge against the orcs that destroyed his clan.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Elara",
                "lastName": "Moonwhisper",
                "race": "Elf",
                "characterClass": "Wizard",
                "location": "Neverwinter",
                "notes": "Scholar from Neverwinter Academy studying ancient dwarven magic.",
                "tags": ["npc", "quest-giver"],
            },
            {
                "firstName": "Sildar",
                "lastName": "Hallwinter",
                "race": "Human",
                "characterClass": "Fighter",
                "location": "Phandalin",
                "notes": "Member of the Lords' Alliance. Wants to bring order back to Phandalin.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Gundren",
                "lastName": "Rockseeker",
                "race": "Dwarf",
                "characterClass": "Prospector",
                "location": "Phandalin",
                "notes": "The dwarf who hired the party. Knows the location of Wave Echo Cave.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Reidoth",
                "lastName": "the Druid",
                "race": "Human",
                "characterClass": "Druid",
                "location": "Thundertree",
                "notes": "A reclusive druid who knows the ruins of Thundertree and the lands around them.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Sister",
                "lastName": "Garaele",
                "race": "Elf",
                "characterClass": "Cleric",
                "location": "Phandalin",
                "notes": "Acolyte of Tymora at the Shrine of Luck. A member of the Harpers.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Qelline",
                "lastName": "Alderleaf",
                "race": "Halfling",
                "characterClass": "Farmer",
                "location": "Phandalin",
                "notes": "A sensible halfling farmer who offers the party shelter and local rumors.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Daran",
                "lastName": "Edermath",
                "race": "Half-Elf",
                "characterClass": "Paladin",
                "location": "Phandalin",
                "notes": "Retired adventurer and orchard keeper. A member of the Order of the Gauntlet.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Halia",
                "lastName": "Thornton",
                "race": "Human",
                "characterClass": "Guildmaster",
                "location": "Phandalin",
                "notes": "Ambitious master of the Phandalin Miner's Exchange. A Zhentarim agent with her own agenda.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Linene",
                "lastName": "Graywind",
                "race": "Human",
                "characterClass": "Merchant",
                "location": "Phandalin",
                "notes": "Runs the Lionshield Coster trading post. Pays well for news of stolen shipments.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Toblen",
                "lastName": "Stonehill",
                "race": "Human",
                "characterClass": "Innkeeper",
                "location": "Phandalin",
                "notes": "Owner of the Stonehill Inn. A friendly font of Phandalin gossip.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Pip",
                "lastName": "Stonehill",
                "race": "Human",
                "characterClass": "Commoner",
                "location": "Phandalin",
                "notes": "Toblen's young son, always underfoot and eager to help the heroes.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Carp",
                "lastName": "Alderleaf",
                "race": "Halfling",
                "characterClass": "Commoner",
                "location": "Phandalin",
                "notes": "Qelline's curious son. Found a secret tunnel into the Redbrand hideout.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Adabra",
                "lastName": "Gwynn",
                "race": "Human",
                "characterClass": "Healer",
                "location": "Conyberry",
                "notes": "A kindly midwife and healer living alone outside the ruins of Conyberry.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Narth",
                "lastName": "the Elder",
                "race": "Human",
                "characterClass": "Commoner",
                "location": "Phandalin",
                "notes": "An old farmer and town elder who remembers Phandalin before the Redbrands.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Freda",
                "lastName": "Tallstag",
                "race": "Human",
                "characterClass": "Scout",
                "location": "Triboar",
                "notes": "A caravan guard who ranges the Triboar Trail and trades word of bandit movements.",
                "tags": ["npc", "ally"],
            },
        ],
    },
    {
        "name": "Curse of Strahd",
        "description": (
            "Under raging storm clouds, the vampire darklord Strahd von Zarovich looks "
            "down from the tall windows of Castle Ravenloft. The adventurers have been "
            "lured into his domain of dread — Barovia. Can they escape, or will they "
            "become permanent residents?"
        ),
        "schedule": {
            "frequency": "biweekly",
            "dayOfWeek": "Friday",
            "time": "19:30",
            "timezone": "America/New_York",
        },
        "maxPlayers": 4,
        "colors": {"bg": "#2a1a2e", "fg": "#d4c8e0", "accent": "#4a2a5a"},
        "sessions": [
            {"name": "Into the Mists", "number": 1, "status": "completed"},
            {"name": "Village of Barovia", "number": 2, "status": "active"},
        ],
        "characters": [
            {
                "firstName": "Ireena",
                "lastName": "Kolyana",
                "race": "Human",
                "characterClass": "Noble",
                "notes": "The adopted daughter of Burgomaster Kolyan Indirovich. Strahd believes she is the reincarnation of Tatyana.",
                "tags": ["npc", "key-character"],
            },
            {
                "firstName": "Ismark",
                "lastName": "Kolyanovich",
                "race": "Human",
                "characterClass": "Fighter",
                "notes": 'Ireena\'s brother. Known as "Ismark the Lesser." Desperate to protect his sister from Strahd.',
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Madam",
                "lastName": "Eva",
                "race": "Human",
                "characterClass": "Seer",
                "notes": "A Vistani fortune teller who can read the Tarokka cards to reveal the party's destiny.",
                "tags": ["npc", "quest-giver"],
            },
        ],
    },
    {
        "name": "Storm King's Thunder",
        "description": (
            "Giants have emerged from their strongholds to threaten civilization as never "
            "before. Hill giants steal crops and livestock, frost giants plunder coastal "
            "towns, and fire giants press gangs into service. The ordning — the social "
            "structure of giantkind — has shattered."
        ),
        "schedule": {
            "frequency": "weekly",
            "dayOfWeek": "Wednesday",
            "time": "20:00",
            "timezone": "America/Los_Angeles",
        },
        "maxPlayers": 6,
        "colors": {"bg": "#1a2a3a", "fg": "#d0e0f0", "accent": "#2a4a6a"},
        "sessions": [
            {"name": "A Great Upheaval", "number": 1, "status": "not_started"},
        ],
        "characters": [
            {
                "firstName": "Harshnag",
                "lastName": "the Grim",
                "race": "Frost Giant",
                "characterClass": "Barbarian",
                "notes": "A legendary frost giant who has long been a friend to small folk. Now seeks to restore the ordning.",
                "tags": ["npc", "ally", "giant"],
            },
        ],
    },
]


def build_lore_docs(*, campaign_id, gm_id, player_ids, player_user_ids,
                    character_ids, location_ids, race_ids, now):
    """Return at least 5 Lore docs for the rich campaign.

    Arguments
    ---------
    player_ids      : list of Player document ObjectIds (not userId) — used for
                      the "player" link targets so the Lore tab can filter by
                      player doc id.
    player_user_ids : list of User ObjectIds, parallel to player_ids — used as
                      createdBy so the server's ownership check
                      (String(doc.createdBy) === member.userId) correctly
                      identifies the owning player.
    character_ids : list of Character document ObjectIds (in insertion order)
    location_ids  : dict mapping location name → ObjectId
    race_ids      : dict mapping race title → ObjectId (subset; may be empty)
    """
    def image(slug, caption):
        return {"url": f"/uploads/seed-lore/{slug}.png", "caption": caption, "crop": None}

    def lore(title, content, *, public, author_id, links, images, tags,
             gm_content="", day_offset=0):
        ts = now - timedelta(days=day_offset)
        return {
            "title": title,
            "content": content,
            "gmContent": gm_content,
            "isPublic": public,
            "images": images,
            "links": links,
            "tags": tags,
            "campaignId": campaign_id,
            "createdBy": author_id,
            "createdAt": ts,
            "updatedAt": ts,
        }

    # Resolve ids — fall back gracefully when the collection is sparse.
    elf_race_id   = race_ids.get("Elf") or (next(iter(race_ids.values())) if race_ids else ObjectId())
    phandalin_id  = location_ids.get("Phandalin") or (next(iter(location_ids.values())) if location_ids else ObjectId())
    # "Black Spider" NPC is Nezznar — use the first character id (Thorin) as a
    # stand-in when no named-character lookup is available; see build_lore_docs
    # call site where character_ids are indexed by insertion order.
    npc_id        = character_ids[0] if character_ids else ObjectId()
    # Second character (Elara Moonwhisper) for the dragon legend multi-link.
    char2_id      = character_ids[1] if len(character_ids) > 1 else npc_id
    # Player *document* ids for the two player-linked lore docs (link targets).
    player0_id    = player_ids[0] if player_ids else ObjectId()
    player1_id    = player_ids[1] if len(player_ids) > 1 else player0_id
    # Player *user* ids — used as createdBy so the server ownership check
    # (String(doc.createdBy) === member.userId) recognises the owning player.
    player0_user_id = player_user_ids[0] if player_user_ids else ObjectId()
    player1_user_id = player_user_ids[1] if len(player_user_ids) > 1 else player0_user_id

    docs = [
        # 1 — Race link (public, GM-authored)
        lore(
            "Origins of the Elves",
            (
                "Long before the rise of human kingdoms, the elves walked beneath "
                "ancient stars. Born of the Feywild's raw magic, they carry the "
                "memories of an age when gods still walked among mortals.\n\n"
                "Their **Trance** meditation is not sleep but a waking reverie, "
                "and their **Darkvision** a remnant of centuries spent in star-lit "
                "forests far from any torch."
            ),
            public=True,
            author_id=gm_id,
            links=[{"kind": "race", "id": elf_race_id}],
            images=[image("elf-origins", "Ancient elf ruins beneath a moonlit sky")],
            tags=["lore", "race", "elf"],
            day_offset=14,
        ),
        # 2 — Location link (public, GM-authored)
        lore(
            "A Short History of Phandalin",
            (
                "Phandalin was once a thriving human settlement that traded with "
                "the dwarves of the Phandelver Pact. Orcs razed it to the ground "
                "some five centuries ago, and only ruins remained until a generation "
                "past when a wave of settlers began to rebuild.\n\n"
                "Today it is a rough frontier town of a few hundred souls. The "
                "Miner's Exchange controls much of the commerce, while Harbin Wester "
                "serves as the largely ineffectual Townmaster."
            ),
            public=True,
            author_id=gm_id,
            links=[{"kind": "location", "id": phandalin_id}],
            images=[image("phandalin-history", "Phandalin's main street at dusk")],
            tags=["lore", "location", "history"],
            day_offset=10,
        ),
        # 3 — Character link (private, GM-only gmContent)
        lore(
            "The Black Spider's Web",
            (
                "Rumours speak of a shadowy figure pulling strings across the "
                "Sword Coast — a spymaster known only as the Black Spider. Caravans "
                "have been ambushed, dwarven prospectors have gone missing, and at "
                "the centre of each thread sits this unseen hand."
            ),
            public=False,
            author_id=gm_id,
            links=[{"kind": "character", "id": npc_id}],
            images=[image("black-spider", "A spider-sigil wax seal on a torn letter")],
            tags=["lore", "villain", "secret"],
            gm_content=(
                "**GM eyes only:** The Black Spider is Nezznar, a drow mage "
                "who wants sole access to the Forge of Spells in Wave Echo Cave. "
                "He has sent a doppelganger to impersonate one of the Rockseeker "
                "brothers — reveal this when the party reaches area 12."
            ),
            day_offset=10,
        ),
        # 4 — Multi-link: location + character (public)
        lore(
            "Legend of the Sleeping Dragon",
            (
                "The peasants of the Triboar Trail tell of a dragon that once "
                "laid waste to a city of mages, then curled beneath the mountains "
                "to sleep for a thousand years. Some say the tremors that occasionally "
                "shake Phandalin are its shallow breaths.\n\n"
                "Scholars note that every fifty years or so, a silver-scaled form "
                "is glimpsed above the Sword Mountains at dusk."
            ),
            public=True,
            author_id=gm_id,
            links=[
                {"kind": "location", "id": phandalin_id},
                {"kind": "character", "id": char2_id},
            ],
            images=[image("dragon-legend", "A silver dragon silhouetted against storm clouds")],
            tags=["lore", "legend", "dragon"],
            day_offset=7,
        ),
        # 5 — Player link (private — player + GM only)
        lore(
            "The Wanderer's Oath",
            (
                "Before joining the party, this adventurer swore an oath in a "
                "roadside shrine to Tymora — Lady Luck. The exact words are known "
                "only to them and to the goddess, but the party has glimpsed the "
                "silver coin always turning between their fingers."
            ),
            public=False,
            # createdBy must be the User _id (not the Player doc _id) so the
            # server ownership check (String(doc.createdBy) === member.userId)
            # lets the owning player read their own private lore.
            author_id=player0_user_id,
            links=[{"kind": "player", "id": player0_id}],
            images=[],
            tags=["lore", "player", "backstory"],
            day_offset=5,
        ),
        # 6 — Second player link (public) — ensures both visibility states
        #     appear on the Player Lore tab.
        lore(
            "Songs of the Road",
            (
                "This adventurer keeps a travelling journal of the places the "
                "party has passed through — sketches of Phandalin's crooked rooftops, "
                "rubbings of goblin cave-carvings, the pressed flower from Conyberry. "
                "Anyone who asks may read it at camp."
            ),
            public=True,
            # Same reasoning: createdBy is the User _id, not the Player doc _id.
            author_id=player1_user_id,
            links=[{"kind": "player", "id": player1_id}],
            images=[],
            tags=["lore", "player", "journal"],
            day_offset=3,
        ),
    ]
    return docs


def build_calendar_doc(*, campaign_id, gm_id, now):
    """One Calendar of Harptos document for the rich campaign.

    Starts from the shared HARPTOS config (which mirrors app/utils/harptos.ts)
    and stamps on the per-campaign ownership/timestamps. A shallow copy is fine
    because we only add top-level keys; the nested month/season/etc. lists are
    static reference data we never mutate.
    """
    doc = dict(HARPTOS)
    doc.update({
        "campaignId": campaign_id,
        "createdBy": gm_id,
        "createdAt": now,
        "updatedAt": now,
    })
    return doc


def build_event_docs(*, campaign_id, calendar_id, gm_id, now,
                     character_ids, location_ids, race_ids, player_ids, session_ids):
    """~10 sample events on the Harptos calendar, linked to seeded entities.

    Arguments
    ---------
    character_ids : list of Character document ObjectIds (insertion order) —
                    character_ids[0] is the first named NPC (Thorin Ironforge).
    location_ids  : dict mapping location name → ObjectId (e.g. "Phandalin").
    race_ids      : dict mapping race title → ObjectId (subset; may be empty).
    player_ids    : list of Player document ObjectIds.
    session_ids   : list of session ObjectIds (the first is linked from the
                    Siege event). Pass [] when none are available — the link
                    simply becomes None.

    Every start/end date is valid under Harptos (see seed_calendar_data.py for
    month lengths; Shieldmeet — monthIndex 10 — is only valid in leap years, and
    1488 IS a leap year so day 1 resolves).
    """
    def ev(title, content, start, *, public, epic=False, end=None, links=None,
           gm_content="", tags=None, session_id=None, day_offset=0):
        ts = now - timedelta(days=day_offset)
        return {
            "title": title, "content": content, "gmContent": gm_content,
            "isPublic": public, "isEpic": epic,
            "start": start, "end": end,
            "startOrdinal": to_ordinal(HARPTOS, start),
            "endOrdinal": to_ordinal(HARPTOS, end or start),
            "links": links or [], "sessionId": session_id, "images": [],
            "tags": tags or [], "color": None,
            "campaignId": campaign_id, "calendarId": calendar_id, "createdBy": gm_id,
            "createdAt": ts, "updatedAt": ts,
        }

    # Resolve ids against the real seeded structures, falling back to a fresh
    # ObjectId only when the collection is genuinely empty (keeps the builder
    # usable in DB-free unit checks).
    phandalin = location_ids.get("Phandalin") or (next(iter(location_ids.values())) if location_ids else ObjectId())
    npc0 = character_ids[0] if character_ids else ObjectId()
    player0 = player_ids[0] if player_ids else ObjectId()
    elf = race_ids.get("Elf") or (next(iter(race_ids.values())) if race_ids else ObjectId())
    session0 = session_ids[0] if session_ids else None

    return [
        ev("The Time of Troubles", "The gods walked Faerûn as mortals; Mystra fell at Mistmere.",
           {"year": 1358, "monthIndex": 6, "day": 15}, public=True, epic=True, tags=["world", "history"]),
        ev("The Spellplague", "Blue fire swept the Weave; magic itself convulsed across the Realms.",
           {"year": 1385, "monthIndex": 8, "day": 1}, public=True, epic=True, tags=["world", "history"]),
        ev("Shieldmeet Grand Council", "Rulers renewed pacts on the leap-day festival of Shieldmeet.",
           {"year": 1488, "monthIndex": 10, "day": 1}, public=True, tags=["festival", "politics"]),
        ev("Founding of Phandalin", "Settlers rebuilt the ruined town atop the old Phandelver pact lands.",
           {"year": 1451, "monthIndex": 3, "day": 8}, public=True,
           links=[{"kind": "location", "id": phandalin}], tags=["history"]),
        ev("The Siege of Phandalin", "Redbrands stormed the town over two desperate days.",
           {"year": 1491, "monthIndex": 4, "day": 11}, end={"year": 1491, "monthIndex": 4, "day": 12},
           public=True, epic=True,
           links=[{"kind": "location", "id": phandalin}, {"kind": "character", "id": npc0}],
           tags=["campaign", "battle"], session_id=session0),
        ev("Gundren's Disappearance", "Gundren Rockseeker vanished on the Triboar Trail.",
           {"year": 1491, "monthIndex": 4, "day": 2}, public=False,
           gm_content="Captured by Cragmaw goblins on the Black Spider's orders.",
           links=[{"kind": "character", "id": npc0}], tags=["campaign", "secret"]),
        ev("Wave Echo Cave Rediscovered", "The lost mine and its Forge of Spells came to light again.",
           {"year": 1491, "monthIndex": 4, "day": 20}, public=True,
           links=[{"kind": "location", "id": phandalin}], tags=["campaign"]),
        ev("Greengrass in Phandalin", "The spring festival of Greengrass was kept with garlands and ale.",
           {"year": 1491, "monthIndex": 5, "day": 1}, public=True,
           links=[{"kind": "player", "id": player0}], tags=["festival"]),
        ev("The Elven Retreat", "The elves withdrew to their hidden refuges as the age turned.",
           {"year": 1344, "monthIndex": 12, "day": 20}, public=True,
           links=[{"kind": "race", "id": elf}], tags=["history", "elf"]),
        ev("Council Vote at Neverwinter", "A closed council set the season's trade compacts.",
           {"year": 1491, "monthIndex": 6, "day": 10}, public=False,
           gm_content="Sets up the next arc's politics.", tags=["politics", "secret"]),
    ]


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
             "Sildar promised 50 gp if we get him safely to Phandalin. He's "
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
    3: [
        "The trail ends at a cliff face above a rushing stream — the dark "
        "mouth of Wave Echo Cave yawns open before you.",
        "Inside, the air is stale and metallic. Old bones and rusted mining "
        "gear litter the worked-stone tunnels.",
        "A sickly green light flickers ahead, and a flaming skull drifts out "
        "of the dark, cackling as it comes.",
        "Deeper in, the Forge of Spells pulses with old magic — and a cold "
        "drow voice echoes: 'You should not have come here.'",
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
    while len(lines) < target_count:
        for _ in range(rng.randint(2, 4)):
            pc = rng.choice(party)
            # Banter lines are character-agnostic (no {pc} placeholders), so the
            # speaker is the `pc` chosen above; the text needs no formatting.
            text = rng.choice(_BANTER_POOL)
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
            # Deterministic but collision-free across re-seeds: session_id is a
            # fresh ObjectId each run, so ids differ run-to-run, while seq is
            # unique within a session. Avoids duplicate-key errors on the unique
            # {id:1} index when dev:seed runs without a prior dev:clear.
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL,
                                 f"cartyx-message:{session_id}:{i + 1}")),
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
                # flags: 16 = crit (matches DiceRoll wire format)
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
    # Seed always creates a 4-player party (names[0..3]).
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
            # Deterministic but collision-free across re-seeds (see
            # build_chat_transcript): scoped to the fresh per-run session_id.
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL,
                                 f"cartyx-diceroll:{session_id}:{i + 1}")),
            "seq": i + 1,
            "sessionId": session_id,
            "campaignId": campaign_id,
            "timestamp": start_ms + i * step,
            "createdAt": start_ts,
        })
        docs.append(r)
    return docs


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    uri = require_mongo_uri()
    client: MongoClient = MongoClient(uri)
    db_name = os.environ.get("MONGODB_DB")
    if db_name:
        db = client[db_name]
    else:
        try:
            db = client.get_default_database()
        except ConfigurationError:
            sys.exit(
                "MONGODB_URI does not include a database name and MONGODB_DB is not set.\n"
                "Either add a database name to the URI (e.g. mongodb+srv://…/cartyx) "
                "or set MONGODB_DB=cartyx in your .env file."
            )

    # Find the GM user
    user = db.users.find_one({"role": "gm"})
    if not user:
        sys.exit(
            "No GM user found. Run `node scripts/seed-gm.cjs` first, "
            "then log in to create a User doc."
        )

    gm_id = user["_id"]
    print(f"Using GM: {user.get('firstName') or user.get('email')} ({gm_id})\n")

    now = datetime.now(timezone.utc)
    campaign_ids = []

    # Find-or-create the four player user accounts up front so each campaign
    # can reference them by `_id` consistently. New accounts start with
    # role='unknown' — they'll claim it via OAuth on first login.
    player_users = ensure_player_users(db, now)
    print(f"Player accounts: {', '.join(p['email'] for p in player_users)}\n")

    # Publish the committed portraits to the web-served path the player docs
    # reference, so portrait URLs resolve instead of 404ing to a letter avatar.
    copy_player_portraits()

    # Asset cursor — advances across campaigns so each of the 12 portraits
    # is used exactly once over the 3 campaigns × 4 players = 12 player docs.
    image_cursor = 0

    # Deterministic RNG for repeatable name/class generation.
    rng = random.Random(20260613)

    for defn in CAMPAIGNS:
        # Generate and save placeholder image
        svg = generate_campaign_svg(defn["name"], defn["colors"])
        filename = f"seed-{secrets.token_hex(4)}.svg"
        image_path = save_image(svg, filename)
        print(f"  image  {image_path}")

        # Insert campaign — start with the GM as the only member, then add
        # the four player users below.
        invite_code = secrets.token_hex(4)
        members = [{"userId": gm_id, "role": "gm", "joinedAt": now}]
        for pu in player_users:
            members.append({"userId": pu["_id"], "role": "player", "joinedAt": now})

        result = db.campaigns.insert_one({
            "gameMasterId": gm_id,
            "name": defn["name"],
            "description": defn["description"],
            "imagePath": image_path,
            "schedule": defn["schedule"],
            "links": [],
            "maxPlayers": defn["maxPlayers"],
            "inviteCode": invite_code,
            "status": "active",
            "members": members,
            "createdAt": now,
            "updatedAt": now,
        })
        campaign_id = result.inserted_id
        campaign_ids.append(campaign_id)
        print(f"  campaign  {defn['name']} ({campaign_id})")

        # Insert four players (one per player account), each with a unique
        # portrait + randomised name/race/class/backstory.
        party = []
        # player_doc_ids: list of Player document _ids (used for lore links).
        player_doc_ids: list = []
        for pu in player_users:
            pc = random_pc(rng)
            picture = PLAYER_IMAGES[image_cursor % len(PLAYER_IMAGES)]
            image_cursor += 1
            p_result = db.players.insert_one({
                "campaignId": campaign_id,
                # `userId` is required by the unique index
                # `{campaignId:1, userId:1}` — one player document per user
                # per campaign.
                "userId": pu["_id"],
                "createdBy": pu["_id"],
                "firstName": pc["firstName"],
                "lastName": pc["lastName"],
                "race": pc["race"],
                "characterClass": pc["characterClass"],
                "age": rng.randint(18, 80),
                "gender": "",
                "location": "",
                "link": "",
                "picture": picture,
                "pictureCrop": None,
                "description": "",
                "backstory": pc["backstory"],
                "gmNotes": "",
                "color": pc["color"],
                "eyeColor": "",
                "hairColor": "",
                "weight": None,
                "height": "",
                "size": "Medium",
                "appearance": "",
                "status": {"value": "alive", "changedAt": None, "changedBy": None},
                "relationships": [],
                "createdAt": now,
                "updatedAt": now,
            })
            player_doc_ids.append(p_result.inserted_id)
            print(f"    player    {pc['firstName']} {pc['lastName']} "
                  f"({pc['race']} {pc['characterClass']}) — {pu['email']}")
            party.append({"name": f"{pc['firstName']} {pc['lastName']}",
                          "user_id": pu["_id"]})

        # Insert sessions
        sessions = defn["sessions"]
        session_ids: dict[int, ObjectId] = {}
        session_windows: dict[int, tuple] = {}
        for sess in sessions:
            start_offset_days = sess.get("start_offset_days")
            if start_offset_days is None:
                # Legacy spacing for campaigns without explicit offsets: one
                # week per session back from now (preserves the prior weekly
                # cadence for the lean campaigns).
                start_date = now - timedelta(weeks=len(sessions) - sess["number"])
            else:
                start_date = now - timedelta(days=start_offset_days)
            # Pin start to 18:00 local-ish for realism; keep tz-aware UTC.
            start_date = start_date.replace(hour=18, minute=0, second=0, microsecond=0)
            end_hours = sess.get("end_offset_hours")
            end_date = start_date + timedelta(hours=end_hours) if end_hours is not None else None
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
            session_windows[sess["number"]] = (start_date, end_date)
            print(f"    session #{sess['number']}  {sess['name']} [{sess['status']}]"
                  f"{' (active)' if sess['status'] == 'active' else ''}")

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
                s_start, s_end = session_windows[num]
                # Active session has no DB endDate; use a nominal 4h window so
                # its in-progress events still get spread over a sensible span.
                if s_end is None:
                    s_end = s_start + timedelta(hours=4)
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

        # Insert default LocationTypes for the campaign (matches LocationType.ts behavior)
        db.locationtype.insert_many([
            {
                "campaignId": campaign_id,
                "name": name,
                "isDefault": True,
                "sortOrder": i,
            }
            for i, name in enumerate(DEFAULT_LOCATION_TYPES)
        ])
        print(f"    location types  ({len(DEFAULT_LOCATION_TYPES)} defaults)")

        # Insert any seed locations defined for this campaign.
        # location_ids: maps location name → inserted _id (for lore links).
        location_ids: dict[str, object] = {}
        for loc in defn.get("locations", []):
            loc_result = db.location.insert_one({
                "campaignId": campaign_id,
                "createdBy": gm_id,
                "name": loc["name"],
                "locationType": loc["locationType"],
                "description": loc.get("description", ""),
                "gmNotes": loc.get("gmNotes", ""),
                "isPublic": loc.get("isPublic", True),
                "parentLocations": [],
                "childLocations": [],
                "mapImage": None,
                "mapBounds": None,
                "images": [],
                "tags": loc.get("tags", []),
                "createdAt": now,
                "updatedAt": now,
            })
            location_ids[loc["name"]] = loc_result.inserted_id
            print(f"    location  {loc['name']} ({loc['locationType']})")

        # Insert characters; capture ids in insertion order for lore links.
        character_ids: list = []
        for char in defn["characters"]:
            char_result = db.characters.insert_one({
                "firstName": char["firstName"],
                "lastName": char["lastName"],
                "race": char["race"],
                "characterClass": char["characterClass"],
                "notes": char["notes"],
                "gmNotes": "",
                "tags": char["tags"],
                "isPublic": False,
                "sessions": [],
                "campaignId": campaign_id,
                "createdBy": gm_id,
                "picture": adventurer_avatar(char["firstName"], char["lastName"]),
                "pictureCrop": None,
                "location": char.get("location", ""),
                "link": "",
                "age": None,
                "createdAt": now,
                "updatedAt": now,
            })
            character_ids.append(char_result.inserted_id)
            print(f"    character  {char['firstName']} {char['lastName']} ({char['race']} {char['characterClass']})")

        # Bulk / stock test campaign — pile in SRD races, rules, hundreds
        # of monsters (base + variants), and hundreds of NPC characters so
        # every list page, search, filter, and drag-to-token surface is
        # exercisable at realistic scale from a fresh seed.
        race_ids: dict[str, object] = {}
        if defn.get("bulk_test_campaign"):
            n_races = import_srd_races(db, campaign_id=campaign_id, gm_id=gm_id, now=now)
            n_rules = import_srd_rules(db, campaign_id=campaign_id, gm_id=gm_id, now=now)
            print(f"    SRD races  imported {n_races} from docs/srd/races")
            print(f"    SRD rules  imported {n_rules} from docs/srd/rules")
            # Collect race ids for lore links (query back the titles we care about).
            for race_doc in db.races.find(
                {"campaignId": campaign_id, "title": {"$in": ["Elf", "Dwarf", "Human"]}},
                {"_id": 1, "title": 1},
            ):
                race_ids[race_doc["title"]] = race_doc["_id"]

            # Bulk NPC characters — 200 generated names/classes/factions,
            # plus the two named characters already declared on the spec.
            extra_npcs = bulk_npc_specs(rng, 200)
            char_docs = [
                {
                    "firstName": spec["firstName"],
                    "lastName": spec["lastName"],
                    "race": spec["race"],
                    "characterClass": spec["characterClass"],
                    "notes": f"{spec['notes']}\n\n_Faction: {spec['faction']}_",
                    "gmNotes": "",
                    "tags": ["npc", spec["faction"].lower().replace(" ", "-")],
                    "isPublic": False,
                    "sessions": [],
                    "campaignId": campaign_id,
                    "createdBy": gm_id,
                    "picture": adventurer_avatar(spec["firstName"], spec["lastName"]),
                    "pictureCrop": None,
                    "location": "",
                    "link": "",
                    "age": rng.randint(15, 800),
                    "createdAt": now,
                    "updatedAt": now,
                }
                for spec in extra_npcs
            ]
            if char_docs:
                db.characters.insert_many(char_docs)
            print(f"    bulk NPCs  inserted {len(char_docs)} generated characters")
        elif defn.get("stock_test_campaign"):
            pass  # legacy path: nothing extra for non-bulk stock campaigns

        if defn.get("stock_test_campaign"):
            # SRD-style monsters — base set in the stock-only path; for the
            # bulk campaign, expand each base into multiple variants so the
            # bestiary spans ~150 stat blocks.
            with_variants = bool(defn.get("bulk_test_campaign"))
            monster_docs = build_monster_docs(
                campaign_id=campaign_id,
                gm_id=gm_id,
                now=now,
                with_variants=with_variants,
            )
            if monster_docs:
                db.monsters.insert_many(monster_docs)
            print(
                f"    monsters   imported {len(monster_docs)} stat blocks "
                f"({'base+variants' if with_variants else 'base only'})"
            )

        # Lore docs — rich campaign only, inserted last so all entity ids
        # (races, locations, characters, players) are available.
        if defn.get("rich_session_history"):
            lore_docs = build_lore_docs(
                campaign_id=campaign_id,
                gm_id=gm_id,
                player_ids=player_doc_ids,
                player_user_ids=[pu["_id"] for pu in player_users],
                character_ids=character_ids,
                location_ids=location_ids,
                race_ids=race_ids,
                now=now,
            )
            if lore_docs:
                # Mongoose pluralizes model('Lore') to the `lores` collection.
                db.lores.insert_many(lore_docs)
            print(f"    lore       inserted {len(lore_docs)}")

            # Calendar of Harptos + sample events — inserted after lore so all
            # entity ids (characters, locations, races, players, sessions) are
            # available to link from events.
            cal_doc = build_calendar_doc(campaign_id=campaign_id, gm_id=gm_id, now=now)
            cal_result = db.calendars.insert_one(cal_doc)
            calendar_id = cal_result.inserted_id
            print(f"    calendar   inserted 1")

            event_docs = build_event_docs(
                campaign_id=campaign_id, calendar_id=calendar_id, gm_id=gm_id, now=now,
                character_ids=character_ids, location_ids=location_ids, race_ids=race_ids,
                player_ids=player_doc_ids, session_ids=list(session_ids.values()),
            )
            if event_docs:
                # Mongoose pluralizes model('Event') to the `events` collection.
                db.events.insert_many(event_docs)
            print(f"    events     inserted {len(event_docs)}")

        print()

    # Update GM user's campaign list.
    db.users.update_one(
        {"_id": gm_id},
        {"$push": {
            "campaigns": {
                "$each": [
                    {"campaignId": cid, "joinedAt": now, "status": "active"}
                    for cid in campaign_ids
                ],
            },
        }},
    )
    # Mirror campaign references onto each player user too, so their
    # campaign list shows them on first login.
    for pu in player_users:
        db.users.update_one(
            {"_id": pu["_id"]},
            {"$push": {
                "campaigns": {
                    "$each": [
                        {"campaignId": cid, "joinedAt": now, "status": "active"}
                        for cid in campaign_ids
                    ],
                },
            }},
        )

    print(
        f"Updated {1 + len(player_users)} users with "
        f"{len(campaign_ids)} campaign reference(s) each."
    )
    print(
        f"\nDone. {len(campaign_ids)} test campaigns seeded with sessions, characters, "
        f"4 players each, and SRD monsters in the stock test campaign."
    )

    client.close()


if __name__ == "__main__":
    main()
