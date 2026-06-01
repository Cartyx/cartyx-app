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

import os
import re
import secrets
import sys
from datetime import datetime, timedelta, timezone
from html import escape
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import ConfigurationError

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
            {"name": "Goblin Arrows", "number": 1, "status": "completed"},
            {"name": "The Spider's Web", "number": 2, "status": "completed"},
            {"name": "Wave Echo Cave", "number": 3, "status": "not_started"},
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

    for defn in CAMPAIGNS:
        # Generate and save placeholder image
        svg = generate_campaign_svg(defn["name"], defn["colors"])
        filename = f"seed-{secrets.token_hex(4)}.svg"
        image_path = save_image(svg, filename)
        print(f"  image  {image_path}")

        # Insert campaign
        invite_code = secrets.token_hex(4)
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
            "members": [{"userId": gm_id, "role": "gm", "joinedAt": now}],
            "createdAt": now,
            "updatedAt": now,
        })
        campaign_id = result.inserted_id
        campaign_ids.append(campaign_id)
        print(f"  campaign  {defn['name']} ({campaign_id})")

        # Insert sessions
        sessions = defn["sessions"]
        for sess in sessions:
            start_date = now - timedelta(weeks=len(sessions) - sess["number"])
            db.sessions.insert_one({
                "campaignId": campaign_id,
                "name": sess["name"],
                "gm": gm_id,
                "number": sess["number"],
                "startDate": start_date,
                "status": sess["status"],
                "createdAt": now,
                "updatedAt": now,
            })
            print(f"    session #{sess['number']}  {sess['name']} [{sess['status']}]")

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
                "picture": "",
                "pictureCrop": None,
                "location": "",
                "link": "",
                "age": None,
                "createdAt": now,
                "updatedAt": now,
            })
            print(f"    character  {char['firstName']} {char['lastName']} ({char['race']} {char['characterClass']})")

        print()

    # Update user's campaign list
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
    print(f"Updated GM user with {len(campaign_ids)} campaign references.")
    print(f"\nDone. 3 test campaigns seeded with sessions, characters, and images.")

    client.close()


if __name__ == "__main__":
    main()
