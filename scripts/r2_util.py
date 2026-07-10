"""Shared CDN/R2 helpers for the dev data scripts.

One home for the env detection, the prod-bucket guard, and the boto3 client so
`dev_seed.py`, `dev_clear.py`, and `repair_seed_images.py` cannot drift apart
(e.g. a tightened guard or endpoint change applied to one script but not the
others). Uses the same env vars as the app itself (see
app/server/functions/uploads.ts).

Two configuration levels:
  - `r2_env()`            — the 4 R2_* vars; enough to talk to the bucket
                            (dev_clear only needs this).
  - `r2_env(require_cdn)` — additionally requires CDN_URL; needed by anything
                            that WRITES objects and stores public URLs.
"""

import os
import re
import sys

R2_ENV_KEYS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
CDN_ENV_KEYS = ("CDN_URL",) + R2_ENV_KEYS


def r2_env(require_cdn: bool = False) -> dict[str, str] | None:
    """The R2 (and optionally CDN) env vars, or None unless ALL are present.
    Aborts outright on a production-looking bucket."""
    keys = CDN_ENV_KEYS if require_cdn else R2_ENV_KEYS
    env = {k: os.environ.get(k) or "" for k in keys}
    if not all(env.values()):
        return None
    if re.search(r"prod", env["R2_BUCKET"], re.IGNORECASE):
        sys.exit("R2_BUCKET looks like a production bucket. Aborting.")
    return env


_client = None


def get_r2_client(env: dict[str, str]):
    """Lazily-constructed shared boto3 S3 client for the R2 endpoint."""
    global _client
    if _client is None:
        import boto3  # local import: only needed when R2 is configured

        _client = boto3.client(
            "s3",
            endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=env["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )
    return _client


def cdn_base() -> str | None:
    """Normalized CDN origin (no trailing slash) when fully configured."""
    env = r2_env(require_cdn=True)
    return env["CDN_URL"].rstrip("/") if env else None


def public_url(rel_path: str) -> str:
    """Where the app will serve `rel_path` from: the CDN when configured
    (matching the validation in campaigns.ts — origin must be CDN_URL and the
    path must start with /uploads/), else the path itself for local Vite."""
    base = cdn_base()
    return f"{base}{rel_path}" if base else rel_path


def upload_to_r2(rel_path: str, body: bytes, content_type: str) -> None:
    """Put `body` at the R2 key matching `rel_path` (leading slash stripped),
    so `{CDN_URL}{rel_path}` serves it. Requires CDN/R2 to be configured."""
    env = r2_env(require_cdn=True)
    if not env:
        sys.exit("upload_to_r2 called without full CDN/R2 configuration")
    get_r2_client(env).put_object(
        Bucket=env["R2_BUCKET"],
        Key=rel_path.lstrip("/"),
        Body=body,
        ContentType=content_type,
    )


def list_r2_keys(prefix: str) -> set[str]:
    """Existing R2 keys under `prefix` (used to skip uploads that are already
    present and to spot dangling references). Requires R2 to be configured."""
    env = r2_env()
    if not env:
        sys.exit("list_r2_keys called without R2 configuration")
    keys: set[str] = set()
    paginator = get_r2_client(env).get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=env["R2_BUCKET"], Prefix=prefix):
        for obj in page.get("Contents", []):
            keys.add(obj["Key"])
    return keys
