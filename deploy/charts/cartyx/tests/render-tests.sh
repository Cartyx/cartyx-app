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

if lint_out=$(helm lint "$CHART_DIR" "${BASE_ARGS[@]}" 2>&1); then ok; else
  bad "helm lint"
  echo "$lint_out"
fi
assert_contains "chart renders at least one object" "^kind:"

# --- Task 2: helpers + secret ---
assert_contains "secret rendered with session key" "sessionSecret:"
assert_contains "secret rendered with mongo key" "mongodbUri:"
assert_contains "secret carries all six keys" "r2SecretAccessKey:"
assert_not_contains "existingSecret suppresses managed Secret" "kind: Secret" \
  --set secret.existingSecret=my-secret
filtered_args=$(args_without secret.values.sessionSecret)
# shellcheck disable=SC2086
assert_fails "missing sessionSecret is a render error" "sessionSecret" $filtered_args
filtered_args=$(args_without secret.values.mongodbUri)
# shellcheck disable=SC2086
assert_fails "missing mongodbUri is a render error" "mongodbUri" $filtered_args

# --- Task 3: realtime deployment + service ---
assert_contains "realtime deployment exists" "name: cartyx-realtime"
assert_contains "realtime uses Recreate" "type: Recreate"
assert_contains "realtime checksum annotation" "checksum/secret:"
assert_contains "realtime drops capabilities" "drop:"
assert_contains "realtime seccomp profile" "type: RuntimeDefault"
assert_contains "realtime probe timeout tuned" "timeoutSeconds: 3"
assert_fails "realtime replicas>1 refused" "not supported" \
  "${BASE_ARGS[@]}" --set=realtime.replicaCount=2
filtered_args=$(args_without realtime.image.tag)
# shellcheck disable=SC2086
assert_fails "missing realtime tag is a render error" "realtime.image.tag" $filtered_args
assert_contains "realtime NodePort honored" "nodePort: 30199" \
  --set realtime.service.type=NodePort --set realtime.service.nodePort=30199

# --- Task 4: web deployment + service ---
assert_contains "web deployment exists" "name: cartyx-web"
assert_contains "web readiness hits /readyz" "path: /readyz"
assert_contains "web readiness timeout above the 2s mongo bound" "timeoutSeconds: 5"
assert_contains "web gets in-cluster realtime host" "value: \"cartyx-realtime:1999\""
assert_contains "web APP_ENV from values" "name: APP_ENV"
assert_not_contains "empty web env values are omitted" "name: CDN_URL"
assert_contains "non-empty web env values render" "value: \"https://cdn.test\"" \
  --set web.env.CDN_URL=https://cdn.test
assert_contains "web reads r2 secret" "key: r2SecretAccessKey"
filtered_args=$(args_without web.image.tag)
# shellcheck disable=SC2086
assert_fails "missing web tag is a render error" "web.image.tag" $filtered_args

# --- Task 5: ingress + health block + certificate ---
assert_contains "ingress has web host rule" "host: web.test"
assert_contains "ingress has ws host rule" "host: ws.test"
assert_contains "ingress tls secret" "secretName: cartyx-tls"
assert_contains "ingress uses websecure entrypoint" "router.entrypoints: websecure"
assert_contains "health block middleware rendered" "kind: Middleware"
assert_contains "health block route matches both paths" "/readyz"
assert_not_contains "health block toggles off" "kind: Middleware" \
  --set ingress.blockHealthEndpoints=false
assert_not_contains "ingress toggles off" "kind: Ingress" \
  --set ingress.enabled=false
assert_contains "certificate covers both hosts" "kind: Certificate"
assert_not_contains "certificate toggles off" "kind: Certificate" \
  --set tls.certificate.enabled=false
filtered_args=$(args_without tls.certificate.clusterIssuer)
# shellcheck disable=SC2086
assert_fails "missing clusterIssuer is a render error" "clusterIssuer" $filtered_args
filtered_args=$(args_without ingress.webHost)
# shellcheck disable=SC2086
assert_fails "missing webHost is a render error" "webHost" $filtered_args

# --- Task 6: environment values files ---
prod_args=$(args_without ingress.)
render_env() { # render_env <values file> — env values files against BASE_ARGS minus hosts
  # shellcheck disable=SC2086
  helm template cartyx "$CHART_DIR" $prod_args -f "$CHART_DIR/$1" 2>&1
}
prod_out=$(render_env values-prod.yaml)
dev_out=$(render_env values-dev.yaml)
echo "$prod_out" | grep -q "host: app.cartyx.io" && ok || bad "values-prod resolves prod hosts"
echo "$dev_out" | grep -q "host: dev-ws.cartyx.io" && ok || bad "values-dev resolves dev ws host"
echo "$dev_out" | grep -q 'value: "staging"' && ok || bad "values-dev sets APP_ENV=staging"
echo "$dev_out" | grep -q "memory: 384Mi" && ok || bad "values-dev web memory limit"
# Certs are infra-owned on z440: no Certificate object, infra secret names.
echo "$prod_out" | grep -q "kind: Certificate" && bad "values-prod must not issue certs" || ok
echo "$prod_out" | grep -q "secretName: prod-cartyx-tls" && ok || bad "values-prod uses infra tls secret"
echo "$dev_out" | grep -q "secretName: dev-cartyx-tls" && ok || bad "values-dev uses infra tls secret"
# App Secret is out-of-band on z440: no managed Secret, refs point at 'cartyx'.
echo "$prod_out" | grep -q "kind: Secret" && bad "values-prod must not manage the Secret" || ok
# Discriminating existingSecret check: render under a release name whose
# fullname is NOT 'cartyx' (esrel -> esrel-cartyx), scope the grep to
# secretKeyRef blocks — only the existingSecret wiring can produce
# 'name: cartyx' there; labels and a fullname-derived managed Secret cannot.
# shellcheck disable=SC2086
esrel_out=$(helm template esrel "$CHART_DIR" $prod_args -f "$CHART_DIR/values-prod.yaml" 2>&1)
echo "$esrel_out" | grep -A2 "secretKeyRef:" | grep -qE "name: cartyx$" && ok || bad "values-prod refs existingSecret cartyx"

# --- Task 9: values-local ---
local_args=$(args_without ingress.)
# shellcheck disable=SC2086
if helm template cartyx "$CHART_DIR" $local_args -f "$CHART_DIR/values-local.yaml" 2>&1 |
  grep -q "nodePort: 30320"; then ok; else bad "values-local web NodePort"; fi
# shellcheck disable=SC2086
if helm template cartyx "$CHART_DIR" $local_args -f "$CHART_DIR/values-local.yaml" 2>&1 |
  grep -qE "kind: (Ingress|Certificate|Middleware)"; then bad "values-local disables ingress stack"; else ok; fi

# ---- summary ----
echo "render-tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
