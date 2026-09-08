#!/usr/bin/env bash
# Playwright e2e against the containerized stack (web + realtime) from
# deploy/local/compose.yaml. Run from the REPO ROOT via: npm run e2e:container
# Requires: filled .env (dev Atlas), seeded DB
# (npm run dev:seed), Docker running.
set -euo pipefail

node scripts/dev-data.mjs secrets

COMPOSE=(docker compose --env-file .env -f deploy/local/compose.yaml)

cleanup() { "${COMPOSE[@]}" down; }
trap cleanup EXIT

"${COMPOSE[@]}" up --build --wait
E2E_BASE_URL=http://localhost:3100 npx playwright test "$@"
