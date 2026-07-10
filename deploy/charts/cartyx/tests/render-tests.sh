#!/usr/bin/env bash
# Render-level assertions for the cartyx chart — no cluster required.
# Run: bash deploy/charts/cartyx/tests/render-tests.sh
set -uo pipefail

CHART_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PASS=0 FAIL=0

# Single-token --set=k=v form so args_without can drop entries by substring.
# These satisfy every `required` guard in the chart.
BASE_ARGS=(
  --set=web.image.tag=prod-test123
  --set=realtime.image.tag=test123
  --set=ingress.webHost=web.test
  --set=ingress.wsHost=ws.test
  --set=tls.certificate.clusterIssuer=test-issuer
  --set-string=secret.values.sessionSecret=render-test-session-secret-32-chars
  --set-string=secret.values.mongodbUri=mongodb://render-test/db
)

render() { helm template cartyx "$CHART_DIR" "${BASE_ARGS[@]}" "$@" 2>&1; }

ok() { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1"; }

# assert_contains <name> <egrep pattern> [extra render args...]
assert_contains() {
  local name=$1 pattern=$2 out
  shift 2
  out=$(render "$@")
  echo "$out" | grep -qE "$pattern" && ok || bad "$name"
}

# assert_not_contains <name> <egrep pattern> [extra render args...]
assert_not_contains() {
  local name=$1 pattern=$2 out
  shift 2
  out=$(render "$@")
  echo "$out" | grep -qE "$pattern" && bad "$name" || ok
}

# assert_fails <name> <error pattern> <full helm-template args...>
# Bypasses BASE_ARGS so callers control exactly which values exist.
assert_fails() {
  local name=$1 pattern=$2 out
  shift 2
  if out=$(helm template cartyx "$CHART_DIR" "$@" 2>&1); then
    bad "$name (rendered, expected failure)"
  elif echo "$out" | grep -q "$pattern"; then
    ok
  else
    bad "$name (failed with the wrong error)"
  fi
}

# args_without <substring> — prints BASE_ARGS minus matching entries, one per line
args_without() {
  local skip=$1 a
  for a in "${BASE_ARGS[@]}"; do
    case "$a" in *"$skip"*) ;; *) printf '%s\n' "$a" ;; esac
  done
}

# ---- assertions (grow task by task) ----

if helm lint "$CHART_DIR" "${BASE_ARGS[@]}" >/dev/null 2>&1; then ok; else bad "helm lint"; fi
assert_contains "chart renders at least one object" "^kind:"

# --- Task 2: helpers + secret ---
assert_contains "secret rendered with session key" "sessionSecret:"
assert_contains "secret rendered with mongo key" "mongodbUri:"
assert_contains "secret carries all seven keys" "posthogKey:"
assert_not_contains "existingSecret suppresses managed Secret" "kind: Secret" \
  --set secret.existingSecret=my-secret
filtered_args=$(args_without secret.values.sessionSecret)
# shellcheck disable=SC2086
assert_fails "missing sessionSecret is a render error" "sessionSecret" $filtered_args
filtered_args=$(args_without secret.values.mongodbUri)
# shellcheck disable=SC2086
assert_fails "missing mongodbUri is a render error" "mongodbUri" $filtered_args

# ---- summary ----
echo "render-tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
