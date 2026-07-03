#!/usr/bin/env python3
"""
Reset the dev environment to a clean slate.

Wipes EVERYTHING tied to the previous environment so tests start fresh:
  - every MongoDB collection except `users` — chat messages, dice rolls,
    campaigns, sessions, characters, monsters, maps, tokens, GM screens, notes,
    and anything else. User accounts are PRESERVED (and their campaign
    references reset) because the seed requires a GM user to exist and you need
    to stay logged in.
  - all locally-served upload files under public/uploads/.
  - all objects in the R2 (S3) object store.

Enumerating live collections (rather than a hardcoded list) means new
collections are wiped automatically and name drift can't leave data behind.

Usage:
    scripts/.venv/bin/python scripts/dev_clear.py            # interactive confirmation
    scripts/.venv/bin/python scripts/dev_clear.py --force    # skip confirmation

Shortcut:
    npm run dev:clear
    npm run dev:clear -- --force

Safety: refuses to run if NODE_ENV is "production", if MONGODB_URI contains
"prod", or if R2_BUCKET contains "prod".
"""

import os
import re
import shutil
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import ConfigurationError

from r2_util import get_r2_client, r2_env

load_dotenv()

# Repo root anchored to this script's location (scripts/ is one level down)
REPO_ROOT = Path(__file__).resolve().parent.parent

# Collections we never wipe. Users are identity, not test data: the seed needs
# a GM user to exist and you need to stay logged in across a reset.
PRESERVE_COLLECTIONS = {"users"}


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


def get_db(uri: str):
    client: MongoClient = MongoClient(uri)
    db_name = os.environ.get("MONGODB_DB")
    if db_name:
        return client, client[db_name]
    try:
        return client, client.get_default_database()
    except ConfigurationError:
        sys.exit(
            "MONGODB_URI does not include a database name and MONGODB_DB is not set.\n"
            "Either add a database name to the URI (e.g. mongodb+srv://…/cartyx) "
            "or set MONGODB_DB=cartyx in your .env file."
        )


# ---------------------------------------------------------------------------
# Clear steps
# ---------------------------------------------------------------------------

def clear_database(db) -> int:
    """Delete every document from every collection except preserved ones."""
    total = 0
    for name in sorted(db.list_collection_names()):
        if name in PRESERVE_COLLECTIONS or name.startswith("system."):
            print(f"  keep  {name}")
            continue
        result = db[name].delete_many({})
        total += result.deleted_count
        print(f"  clear {name} — {result.deleted_count} documents removed")
    # Reset campaign references on the preserved users (don't delete users).
    user_result = db.users.update_many({}, {"$set": {"campaigns": []}})
    print(f"  patch users — cleared campaign refs from {user_result.modified_count} user(s)")
    return total


def clear_local_uploads() -> int:
    """Remove every locally-served upload under public/uploads/ (keep the dir)."""
    uploads_dir = REPO_ROOT / "public" / "uploads"
    if not uploads_dir.is_dir():
        print("  skip  public/uploads/ (does not exist)")
        return 0
    removed = 0
    for entry in uploads_dir.iterdir():
        if entry.is_dir():
            shutil.rmtree(entry)
        else:
            entry.unlink()
        removed += 1
    print(f"  clear public/uploads/ — {removed} entr(ies) removed")
    return removed


def clear_r2_bucket() -> int:
    """Delete every object in the R2 bucket. No-op if R2 isn't configured."""
    env = r2_env()  # shared env detection + prod-bucket guard (r2_util)
    if not env:
        print("  skip  R2 (not configured — R2_* env vars missing)")
        return 0
    bucket = env["R2_BUCKET"]

    s3 = get_r2_client(env)
    deleted = 0
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket):
        objs = page.get("Contents", [])
        # delete_objects accepts up to 1000 keys per request.
        for i in range(0, len(objs), 1000):
            batch = [{"Key": o["Key"]} for o in objs[i : i + 1000]]
            if not batch:
                continue
            s3.delete_objects(Bucket=bucket, Delete={"Objects": batch, "Quiet": True})
            deleted += len(batch)
    print(f"  clear R2 bucket '{bucket}' — {deleted} object(s) removed")
    return deleted


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    uri = require_mongo_uri()
    force = "--force" in sys.argv
    bucket = os.environ.get("R2_BUCKET") or "(not configured)"

    if not force:
        print("\nThis will PERMANENTLY DELETE, for a clean test environment:")
        print("  - every MongoDB collection except `users`")
        print("  - all files under public/uploads/")
        print(f"  - all objects in the R2 bucket '{bucket}'")
        masked = re.sub(r"//[^@]+@", "//<credentials>@", uri)
        print(f"\nMongo target: {masked}\n")
        if input("Proceed? (y/N) ").strip().lower() != "y":
            print("Aborted.")
            return

    client, db = get_db(uri)
    try:
        print("\nDatabase:")
        total = clear_database(db)
        print("\nLocal uploads:")
        clear_local_uploads()
        print("\nR2 object store:")
        clear_r2_bucket()
        print(
            f"\nDone. {total} documents deleted; public/uploads/ and the R2 bucket emptied. "
            "User accounts preserved."
        )
    finally:
        client.close()


if __name__ == "__main__":
    main()
