#!/usr/bin/env python3
"""
Wipe all campaign-related data from the dev database.

Usage:
    scripts/.venv/bin/python scripts/dev_clear.py            # interactive confirmation
    scripts/.venv/bin/python scripts/dev_clear.py --force     # skip confirmation

Shortcut:
    npm run dev:clear
    npm run dev:clear -- --force

Safety: refuses to run if NODE_ENV is "production" or if the MONGODB_URI
contains "prod" anywhere in the string.
"""

import os
import re
import sys
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
# Collections to wipe — everything tied to campaigns
# ---------------------------------------------------------------------------

COLLECTIONS_TO_CLEAR = [
    "campaigns",
    "sessions",
    "characters",
    "players",
    "messages",
    "dicerolls",
    "notes",
    "races",
    "rules",
    "gmscreens",
    "tags",
    # Campaign-scoped entities added since this script's first version.
    # Keep this in sync with `CAMPAIGN_SCOPED_COLLECTIONS` in
    # `scripts/dev-fixtures/helpers.ts`.
    "location",
    "locationtype",
    "tabletopscreen",
    "tabletopplayerstate",
    "sessionevent",
    "map",
    "mapToken",
    "monsters",
]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    uri = require_mongo_uri()
    force = "--force" in sys.argv

    if not force:
        print("\nThis will DELETE all data from the following collections:")
        for c in COLLECTIONS_TO_CLEAR:
            print(f"  - {c}")
        masked = re.sub(r"//[^@]+@", "//<credentials>@", uri)
        print(f"\nTarget: {masked}\n")

        answer = input("Proceed? (y/N) ").strip().lower()
        if answer != "y":
            print("Aborted.")
            return

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

    existing = {c["name"] for c in db.list_collections()}

    total_deleted = 0
    for name in COLLECTIONS_TO_CLEAR:
        if name not in existing:
            print(f"  skip  {name} (does not exist)")
            continue
        result = db[name].delete_many({})
        total_deleted += result.deleted_count
        print(f"  clear {name} — {result.deleted_count} documents removed")

    # Clear campaign references from users (but don't delete users)
    user_result = db.users.update_many({}, {"$set": {"campaigns": []}})
    print(f"  patch users — cleared campaign refs from {user_result.modified_count} user(s)")

    # Clean up seed images from public/uploads/campaigns/
    uploads_dir = REPO_ROOT / "public" / "uploads" / "campaigns"
    if uploads_dir.is_dir():
        seed_files = [f for f in uploads_dir.iterdir() if f.name.startswith("seed-")]
        for f in seed_files:
            f.unlink()
        if seed_files:
            print(f"  clean {len(seed_files)} seed image(s) from public/uploads/campaigns/")

    print(f"\nDone. {total_deleted} documents deleted across {len(COLLECTIONS_TO_CLEAR)} collections.")

    client.close()


if __name__ == "__main__":
    main()
