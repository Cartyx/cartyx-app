#!/usr/bin/env bash
set -euo pipefail

# Local kind deploy for the Cartyx realtime service.
#   deploy-kind.sh up     (default) build image, load into kind, helm upgrade, verify
#   deploy-kind.sh down   delete the kind cluster

CLUSTER=cartyx-local
NAMESPACE=cartyx-local
RELEASE=cartyx-realtime
IMAGE=cartyx-realtime:local

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
CHART_DIR="$REPO_ROOT/deploy/charts/cartyx-realtime"
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

down() {
  require_tools
  if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
    log "Deleting kind cluster '$CLUSTER'..."
    kind delete cluster --name "$CLUSTER"
  else
    log "Cluster '$CLUSTER' not found; nothing to do."
  fi
}

up() {
  require_tools

  local session_secret mongodb_uri
  session_secret=$(read_env_value SESSION_SECRET || true)
  [ -n "${session_secret:-}" ] || die "SESSION_SECRET is empty or missing in $ENV_FILE. It MUST match the value the app signs party tokens with."
  mongodb_uri=$(read_env_value MONGODB_URI || true)
  if [ -z "${mongodb_uri:-}" ]; then
    log "MONGODB_URI not set in .env — the service will use in-memory history (lost on restart)."
  else
    # Redact credentials before logging: only print what follows the last
    # "@" (host/db/params). If there's no "@" the whole string could be an
    # unauthenticated URI *or* a credential with no host separator, so don't
    # print any of it.
    if [[ "$mongodb_uri" == *@* ]]; then
      log "MONGODB_URI set — persisting history to ...@${mongodb_uri##*@}"
    else
      log "MONGODB_URI set — persisting history to the configured database."
    fi
  fi

  if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
    log "Creating kind cluster '$CLUSTER' (host port 1999 -> NodePort 30199)..."
    kind create cluster --config "$KIND_CONFIG"
  else
    log "Reusing existing kind cluster '$CLUSTER'."
  fi

  log "Building image $IMAGE..."
  docker build -t "$IMAGE" "$REPO_ROOT/realtime"

  log "Loading image into kind..."
  kind load docker-image "$IMAGE" --name "$CLUSTER"

  # helm's --set-string parser treats commas and backslashes as structural
  # (list/nested-key separators), so escape them before passing values like a
  # replica-set URI (mongodb://h1:27017,h2:27017/db).
  local session_secret_esc mongodb_uri_esc
  session_secret_esc="${session_secret//\\/\\\\}"
  session_secret_esc="${session_secret_esc//,/\\,}"
  mongodb_uri_esc="${mongodb_uri:-}"
  mongodb_uri_esc="${mongodb_uri_esc//\\/\\\\}"
  mongodb_uri_esc="${mongodb_uri_esc//,/\\,}"

  log "Deploying with Helm..."
  helm upgrade --install "$RELEASE" "$CHART_DIR" \
    -f "$CHART_DIR/values-local.yaml" \
    --namespace "$NAMESPACE" --create-namespace \
    --set-string secret.sessionSecret="$session_secret_esc" \
    --set-string secret.mongodbUri="$mongodb_uri_esc"

  # Image tag is the constant "local" with pullPolicy: Never, so a second `up`
  # with a changed .env renders a byte-identical manifest and helm won't roll
  # a new ReplicaSet on its own. Force a restart so the pod always picks up
  # the freshly-loaded image and current secret values.
  log "Restarting pods to pick up latest image/secrets..."
  kubectl -n "$NAMESPACE" rollout restart "deploy/$RELEASE"

  log "Waiting for rollout..."
  kubectl -n "$NAMESPACE" rollout status "deploy/$RELEASE" --timeout=90s

  log "Verifying /healthz on http://localhost:1999 ..."
  local ok=0 attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS -o /dev/null "http://localhost:1999/healthz" 2>/dev/null; then
      ok=1
      break
    fi
    log "Attempt $attempt/10: not ready yet, retrying..."
    sleep 2
  done
  [ "$ok" -eq 1 ] || die "Service did not answer /healthz. Check: kubectl -n $NAMESPACE logs deploy/$RELEASE"
  log "Ready. Realtime service is reachable at http://localhost:1999"
  log "Point the web app at it: VITE_PUBLIC_PARTYKIT_HOST=localhost:1999 (already the default), then 'npm run dev'."
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  *) die "Unknown command '${1}'. Usage: deploy-kind.sh [up|down]" ;;
esac
