#!/usr/bin/env bash
set -euo pipefail

# Local kind deploy for the Cartyx app chart (web + realtime).
#   deploy-kind.sh up     (default) build image, load into kind, helm upgrade, verify
#   deploy-kind.sh down   delete the kind cluster

CLUSTER=cartyx-local
NAMESPACE=cartyx-local
RELEASE=cartyx
WEB_IMAGE=cartyx-web:local
REALTIME_IMAGE=cartyx-realtime:local

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
CHART_DIR="$REPO_ROOT/deploy/charts/cartyx"
KIND_CONFIG="$SCRIPT_DIR/kind-config.yaml"
ENV_FILE="$REPO_ROOT/.env"

log() { printf '\033[1;36m[kind-deploy]\033[0m %s\n' "$1"; }
die() { printf '\033[1;31m[kind-deploy] ERROR:\033[0m %s\n' "$1" >&2; exit 1; }

require_tools() {
  local missing=0 tool
  for tool in docker kind kubectl helm curl; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      printf 'Missing required tool: %s\n' "$tool" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || die "Install the missing tools (see deploy/local/README.md) and retry."
}

# Read KEY=value from the repo-root .env without exporting the whole file.
# Mirrors dotenv/compose semantics: tolerates an optional leading "export ",
# strips a trailing " #comment" from unquoted values (but never from inside
# quotes, and never when the "#" isn't preceded by whitespace), then strips
# a single layer of surrounding quotes. Last occurrence of KEY wins.
read_env_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 1
  sed -n "s/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}${key}=//p" "$ENV_FILE" \
    | tr -d '\r' \
    | tail -n1 \
    | sed "/^[\"']/!s/[[:space:]]\\{1,\\}#.*\$//" \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# helm's --set-string parser treats commas and backslashes as structural
# (list/nested-key separators) — escape values like replica-set URIs.
esc() {
  local v="${1//\\/\\\\}"
  printf '%s' "${v//,/\\,}"
}

down() {
  require_tools
  if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
    log "Deleting kind cluster '$CLUSTER'..."
    kind delete cluster --name "$CLUSTER"
  else
    log "Cluster '$CLUSTER' not found; nothing to do."
  fi
}

verify_endpoint() {
  local url=$1 name=$2 attempt
  log "Verifying $name at $url ..."
  for attempt in $(seq 1 15); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then return 0; fi
    log "Attempt $attempt/15: not ready yet, retrying..."
    sleep 2
  done
  die "$name did not answer at $url. Check: kubectl -n $NAMESPACE get pods; kubectl -n $NAMESPACE logs deploy/$RELEASE-web"
}

up() {
  require_tools

  local session_secret mongodb_uri
  session_secret=$(read_env_value SESSION_SECRET || true)
  [ -n "${session_secret:-}" ] || die "SESSION_SECRET is empty or missing in $ENV_FILE. It MUST match the value the app signs party tokens with."
  mongodb_uri=$(read_env_value MONGODB_URI || true)
  [ -n "${mongodb_uri:-}" ] || die "MONGODB_URI is empty or missing in $ENV_FILE. The web app cannot pass /readyz without MongoDB (name a dedicated database in the URI path, e.g. .../cartyx_local)."
  # Redact credentials before logging: only print what follows the last "@".
  if [[ "$mongodb_uri" == *@* ]]; then
    log "MONGODB_URI set — using ...@${mongodb_uri##*@}"
  else
    log "MONGODB_URI set — using the configured database."
  fi

  if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
    log "Creating kind cluster '$CLUSTER' (host 1999 -> realtime, host 3200 -> web)..."
    kind create cluster --config "$KIND_CONFIG"
  else
    log "Reusing existing kind cluster '$CLUSTER'."
  fi

  log "Building realtime image $REALTIME_IMAGE..."
  docker build -t "$REALTIME_IMAGE" "$REPO_ROOT/realtime"

  log "Building web image $WEB_IMAGE (client env baked at build time)..."
  docker build -f "$REPO_ROOT/Dockerfile.web" \
    --build-arg VITE_PUBLIC_PARTYKIT_HOST=localhost:1999 \
    -t "$WEB_IMAGE" "$REPO_ROOT"

  log "Loading images into kind..."
  kind load docker-image "$REALTIME_IMAGE" --name "$CLUSTER"
  kind load docker-image "$WEB_IMAGE" --name "$CLUSTER"

  # Optional web config/secrets passed through from .env when present.
  # (bash 3.2: expand with ${arr[@]+...} so an empty array survives set -u.)
  local extra_sets=()
  add_env() {
    local key=$1 val
    val=$(read_env_value "$key" || true)
    if [ -n "$val" ]; then extra_sets+=(--set-string "web.env.$key=$(esc "$val")"); fi
  }
  add_secret() {
    local key=$1 helm_key=$2 val
    val=$(read_env_value "$key" || true)
    if [ -n "$val" ]; then extra_sets+=(--set-string "secret.values.$helm_key=$(esc "$val")"); fi
  }
  add_env GOOGLE_CLIENT_ID
  add_env GITHUB_CLIENT_ID
  add_env R2_ACCOUNT_ID
  add_env R2_BUCKET
  add_env CDN_URL
  add_secret GOOGLE_CLIENT_SECRET googleClientSecret
  add_secret GITHUB_CLIENT_SECRET githubClientSecret
  add_secret R2_ACCESS_KEY_ID r2AccessKeyId
  add_secret R2_SECRET_ACCESS_KEY r2SecretAccessKey

  log "Deploying with Helm..."
  helm upgrade --install "$RELEASE" "$CHART_DIR" \
    -f "$CHART_DIR/values-local.yaml" \
    --namespace "$NAMESPACE" --create-namespace \
    --set-string secret.values.sessionSecret="$(esc "$session_secret")" \
    --set-string secret.values.mongodbUri="$(esc "$mongodb_uri")" \
    ${extra_sets[@]+"${extra_sets[@]}"}

  # Tags are the constant "local" with pullPolicy: Never, so a re-run with a
  # changed .env can render byte-identical manifests and helm won't roll new
  # ReplicaSets on its own. Force restarts so pods pick up the freshly-loaded
  # images and current secret values.
  log "Restarting pods to pick up latest images/secrets..."
  kubectl -n "$NAMESPACE" rollout restart "deploy/$RELEASE-web" "deploy/$RELEASE-realtime"

  log "Waiting for rollouts..."
  kubectl -n "$NAMESPACE" rollout status "deploy/$RELEASE-realtime" --timeout=90s
  kubectl -n "$NAMESPACE" rollout status "deploy/$RELEASE-web" --timeout=180s

  verify_endpoint "http://localhost:1999/healthz" "realtime"
  verify_endpoint "http://localhost:3200/healthz" "web"
  verify_endpoint "http://localhost:3200/readyz" "web readiness (Mongo ping)"
  log "Ready. Web: http://localhost:3200  Realtime: localhost:1999"
  log "Note: OAuth logins need the :3200 redirect URI registered (see deploy/local/README.md)."
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  *) die "Unknown command '${1}'. Usage: deploy-kind.sh [up|down]" ;;
esac
