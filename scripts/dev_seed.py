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
                "notes": "Veteran miner turned adventurer. Seeking revenge against the orcs that destroyed his clan.",
                "tags": ["npc", "ally"],
            },
            {
                "firstName": "Elara",
                "lastName": "Moonwhisper",
                "race": "Elf",
                "characterClass": "Wizard",
                "notes": "Scholar from Neverwinter Academy studying ancient dwarven magic.",
                "tags": ["npc", "quest-giver"],
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
        for pu in player_users:
            pc = random_pc(rng)
            picture = PLAYER_IMAGES[image_cursor % len(PLAYER_IMAGES)]
            image_cursor += 1
            db.players.insert_one({
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
            print(f"    player    {pc['firstName']} {pc['lastName']} "
                  f"({pc['race']} {pc['characterClass']}) — {pu['email']}")

        # Insert sessions
        sessions = defn["sessions"]
        session_ids: dict[int, ObjectId] = {}
        for sess in sessions:
            start_offset_days = sess.get("start_offset_days", len(sessions) - sess["number"])
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
            print(f"    session #{sess['number']}  {sess['name']} [{sess['status']}]"
                  f"{' (active)' if sess['status'] == 'active' else ''}")

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

        # Insert any seed locations defined for this campaign
        for loc in defn.get("locations", []):
            db.location.insert_one({
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
            print(f"    location  {loc['name']} ({loc['locationType']})")

        # Insert characters
        for char in defn["characters"]:
            db.characters.insert_one({
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
                "location": "",
                "link": "",
                "age": None,
                "createdAt": now,
                "updatedAt": now,
            })
            print(f"    character  {char['firstName']} {char['lastName']} ({char['race']} {char['characterClass']})")

        # Bulk / stock test campaign — pile in SRD races, rules, hundreds
        # of monsters (base + variants), and hundreds of NPC characters so
        # every list page, search, filter, and drag-to-token surface is
        # exercisable at realistic scale from a fresh seed.
        if defn.get("bulk_test_campaign"):
            n_races = import_srd_races(db, campaign_id=campaign_id, gm_id=gm_id, now=now)
            n_rules = import_srd_rules(db, campaign_id=campaign_id, gm_id=gm_id, now=now)
            print(f"    SRD races  imported {n_races} from docs/srd/races")
            print(f"    SRD rules  imported {n_rules} from docs/srd/rules")

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
