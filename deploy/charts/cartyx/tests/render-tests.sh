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
  --set=audioWorker.image.tag=test123
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

# --- Task 12: telemetry env (GLITCHTIP_DSN / UMAMI_WEBSITE_ID / UMAMI_HOST) ---
assert_not_contains "empty GLITCHTIP_DSN is omitted" "name: GLITCHTIP_DSN"
assert_not_contains "empty UMAMI_WEBSITE_ID is omitted" "name: UMAMI_WEBSITE_ID"
assert_not_contains "empty UMAMI_HOST is omitted" "name: UMAMI_HOST"
assert_contains "non-empty GLITCHTIP_DSN renders" "name: GLITCHTIP_DSN" \
  --set web.env.GLITCHTIP_DSN=https://key@glitchtip.test/1
assert_contains "non-empty UMAMI_WEBSITE_ID renders" "name: UMAMI_WEBSITE_ID" \
  --set web.env.UMAMI_WEBSITE_ID=test-website-id
assert_contains "non-empty UMAMI_HOST renders" "name: UMAMI_HOST" \
  --set web.env.UMAMI_HOST=http://umami.platform.svc:3000
prod_out=$(render_env values-prod.yaml)
dev_out=$(render_env values-dev.yaml)
echo "$prod_out" | grep -q "value: \"https://1fd010e17ff4468fa6e3b07c94fcd31b@glitchtip.cartyx.io/1\"" \
  && ok || bad "values-prod GLITCHTIP_DSN resolves"
echo "$dev_out" | grep -q "value: \"4cde88ee-3ef0-4104-adb0-6247d4ecbb30\"" \
  && ok || bad "values-dev UMAMI_WEBSITE_ID resolves"
echo "$prod_out" | grep -q "value: \"http://umami.platform.svc:3000\"" \
  && ok || bad "values-prod UMAMI_HOST resolves"
echo "$dev_out" | grep -q "value: \"http://umami.platform.svc:3000\"" \
  && ok || bad "values-dev UMAMI_HOST resolves"

# --- Task 12 (audio plan): audio-worker deployment ---
assert_contains "audio-worker deployment exists" "name: cartyx-audio-worker"
assert_contains "audio-worker poll interval env renders" "name: POLL_INTERVAL_MS"
# Both timeouts are resilience knobs the worker degrades badly without: no
# FFMPEG_TIMEOUT_MS and a hung ffmpeg wedges the single sequential loop (and
# therefore the stale-row reaper) until a manual restart; no UPLOAD_TIMEOUT_MS
# and rows abandoned in `uploading` never resolve. Assert the values too — a
# bare name would still render if values.yaml dropped the entry, since Helm
# emits an empty string for a missing key.
assert_contains "audio-worker ffmpeg timeout env renders" "name: FFMPEG_TIMEOUT_MS"
assert_contains "audio-worker ffmpeg timeout has a value" '"300000"'
assert_contains "audio-worker upload-stale timeout env renders" "name: UPLOAD_TIMEOUT_MS"
assert_contains "audio-worker upload-stale timeout has a value" '"900000"'
# CPU limit is the whole point of this deployment (ffmpeg is CPU-bound and
# must not starve SSR) — "cpu:" alone would pass even with no limits block
# at all, since web/realtime both set cpu under requests. "4" is the one cpu
# value in the entire chart that only the audio-worker limits block sets, and
# it stays discriminating now that audioWorker requests.cpu is "1": a chart
# that dropped the limits block entirely would still render `cpu: "1"` from
# the requests side, so asserting on that value would prove nothing. The
# scoped limits-block check in group B below pins the pairing.
assert_contains "audio-worker gets a cpu limit (bulk imports must not starve SSR)" \
  'cpu: "4"'
filtered_args=$(args_without audioWorker.image.tag)
# shellcheck disable=SC2086
assert_fails "missing audioWorker.image.tag is a render error" "audioWorker.image.tag" $filtered_args

# --- Adversarial review, group B: worker resilience ---
# Scoped to the audio-worker manifest: a whole-chart grep for "Recreate" or
# "livenessProbe" passes on realtime's, which proves nothing about this pod.
worker_out=$(render -s templates/audio-worker-deployment.yaml)
env_value() { echo "$worker_out" | grep -A1 "name: $1$" | grep 'value:' | tr -dc '0-9'; }

# B4: the default RollingUpdate starts the new pod before the old one exits, so
# every deploy runs two claiming workers at replicas: 1.
echo "$worker_out" | grep -q "type: Recreate" && ok || bad "audio-worker uses Recreate"
# B11: default grace is 30s, shorter than a legitimate transcode — every
# rollout SIGKILLed a live job and burned one of its three attempts.
echo "$worker_out" | grep -q "terminationGracePeriodSeconds: 900" && ok ||
  bad "audio-worker sets a termination grace period longer than a transcode"
# The CPU numbers, scoped to this manifest and to the block each one belongs
# in. `limits.cpu` is what keeps a bulk import off the web pod's cores; it is
# ALSO what decides whether a legitimate 30-minute transcode finishes inside
# FFMPEG_TIMEOUT_MS (measured in-pod: 205s for the aac leg at cpu 1 against a
# 300s timeout — a 1.46x margin, where a SIGKILL costs three attempts).
# `requests.cpu` is the share weight under contention: at 100m the worker was
# outweighed by the web pod and lost the core it needs continuously.
echo "$worker_out" | grep -A2 "limits:" | grep -q 'cpu: "4"' && ok ||
  bad "audio-worker limits.cpu is 4 (measured worst-case transcode + margin)"
echo "$worker_out" | grep -A2 "requests:" | grep -q 'cpu: "1"' && ok ||
  bad "audio-worker requests.cpu reserves the core a transcode uses"
# B7: no port, so the only liveness signal is the heartbeat file's age.
echo "$worker_out" | grep -q "dist/healthcheck.js" && ok ||
  bad "audio-worker has an exec liveness probe on the heartbeat"
echo "$worker_out" | grep -q "name: HEARTBEAT_MAX_AGE_MS" && ok ||
  bad "audio-worker heartbeat threshold is configured"
# B2: without these the AWS SDK has no request timeout at all.
echo "$worker_out" | grep -q "name: S3_REQUEST_TIMEOUT_MS" && ok ||
  bad "audio-worker R2 request timeout renders"
echo "$worker_out" | grep -q "name: S3_CONNECT_TIMEOUT_MS" && ok ||
  bad "audio-worker R2 connect timeout renders"
# B8: worker errors must reach GlitchTip like every other service's.
echo "$worker_out" | grep -q "name: GLITCHTIP_DSN" && bad "empty GLITCHTIP_DSN reaches the worker" || ok
render -s templates/audio-worker-deployment.yaml --set web.env.GLITCHTIP_DSN=https://k@gt.test/1 |
  grep -q "name: GLITCHTIP_DSN" && ok || bad "audio-worker receives GLITCHTIP_DSN when set"

# B5: the relationship, not the literals. One asset spawns SEVEN capped ffmpeg
# children, so a claim timeout below 7x FFMPEG_TIMEOUT_MS tells the reaper to
# revoke the claims of healthy workers mid-transcode.
claim_ms=$(env_value CLAIM_TIMEOUT_MS)
ffmpeg_ms=$(env_value FFMPEG_TIMEOUT_MS)
heartbeat_ms=$(env_value HEARTBEAT_MAX_AGE_MS)
if [ "$claim_ms" -ge $((ffmpeg_ms * 7)) ]; then ok; else
  bad "CLAIM_TIMEOUT_MS ($claim_ms) must clear 7 x FFMPEG_TIMEOUT_MS ($ffmpeg_ms)"
fi
# The heartbeat threshold has to sit above one bounded stage (or the probe kills
# healthy transcodes) and below the claim budget (or it never fires first).
if [ "$heartbeat_ms" -gt "$ffmpeg_ms" ] && [ "$heartbeat_ms" -lt "$claim_ms" ]; then ok; else
  bad "HEARTBEAT_MAX_AGE_MS ($heartbeat_ms) must sit between one ffmpeg stage and the claim budget"
fi

# --- Adversarial review, group D: config that was read but not wired ---
# All three were read from the environment by the worker and settable NOWHERE,
# so changing any of them meant a code change, a CI run, an image push and a
# Flux reconcile. LOG_LEVEL in particular is the 2am lever: without it you
# cannot raise the worker to debug at all.
# Assert the VALUES too, not just the names — Helm renders an empty string for
# a missing values.yaml key, and the deployment's `range` drops empty values,
# so a name-only assertion would still pass with the entry deleted.
echo "$worker_out" | grep -q "name: LOG_LEVEL" && ok ||
  bad "audio-worker log level is settable without an image rebuild"
echo "$worker_out" | grep -A1 "name: LOG_LEVEL$" | grep -q 'value: "info"' && ok ||
  bad "audio-worker LOG_LEVEL has a value"
echo "$worker_out" | grep -q "name: RETRY_BACKOFF_MS" && ok ||
  bad "audio-worker retry backoff base renders"
echo "$worker_out" | grep -q "name: RETRY_BACKOFF_MAX_MS" && ok ||
  bad "audio-worker retry backoff cap renders"
backoff_ms=$(env_value RETRY_BACKOFF_MS)
backoff_max_ms=$(env_value RETRY_BACKOFF_MAX_MS)
# The cap must clear the base or every retry waits the cap, i.e. the backoff
# stops being a backoff. It must also stay under the claim budget, or a row's
# retry delay outlives the reaper window that is supposed to rescue it.
if [ "$backoff_max_ms" -ge "$backoff_ms" ] && [ "$backoff_max_ms" -le "$claim_ms" ]; then ok; else
  bad "RETRY_BACKOFF_MAX_MS ($backoff_max_ms) must sit between the base ($backoff_ms) and the claim budget ($claim_ms)"
fi

# --- Task 11: audio hardening limits (quota, job cap, ingest rate limit) ---
# All four are optional web.env values, same idiom as CDN_URL/GLITCHTIP_DSN
# above: Helm renders '' for an unset key and the deployment's `range` drops
# empty values. The omission checks below cover "unset stays out of the pod
# entirely"; they do NOT, on their own, prove a SET value renders correctly
# (that a `--set` reaches the container with its literal content, not just
# that some `name:` line exists) — that is what the paired name+value checks
# further down are for. Note `--set` injects the key regardless of what
# values.yaml declares, so neither group of checks says anything about the
# values.yaml defaults specifically — that is exercised implicitly by every
# OTHER assertion in this file, which renders without ever unsetting these.
assert_not_contains "empty AUDIO_USER_QUOTA_BYTES is omitted" "name: AUDIO_USER_QUOTA_BYTES"
assert_not_contains "empty MAX_PENDING_JOBS_PER_USER is omitted" "name: MAX_PENDING_JOBS_PER_USER"
assert_not_contains "empty AUDIO_INGEST_RATE_LIMIT_CAPACITY is omitted" \
  "name: AUDIO_INGEST_RATE_LIMIT_CAPACITY"
assert_not_contains "empty AUDIO_INGEST_RATE_LIMIT_REFILL_PER_SEC is omitted" \
  "name: AUDIO_INGEST_RATE_LIMIT_REFILL_PER_SEC"

# Name-value pairing, all four vars in one render: `grep -A1 "name: X$"`
# isolates X's own two-line block (the web-deployment template emits
# `- name: {{ $key }}` immediately followed by `value: {{ $value | quote }}`)
# before checking the value, so this binds the assertion to THIS var's entry
# rather than any line elsewhere in a multi-hundred-line render that happens
# to contain the same digits. `grep -F` (fixed string) rather than `-E` —
# a bare `-E` match on `value: "2.5"` would treat the `.` as "any character"
# and pass even if the rendered value were e.g. "2X5".
name_value_out=$(render \
  --set web.env.AUDIO_USER_QUOTA_BYTES=1073741824 \
  --set web.env.MAX_PENDING_JOBS_PER_USER=5 \
  --set web.env.AUDIO_INGEST_RATE_LIMIT_CAPACITY=120 \
  --set web.env.AUDIO_INGEST_RATE_LIMIT_REFILL_PER_SEC=2.5)
assert_name_value() {
  local var=$1 val=$2
  echo "$name_value_out" | grep -A1 "name: $var$" | grep -qF "value: \"$val\"" && ok ||
    bad "$var renders with its literal value, bound to its own name"
}
assert_name_value AUDIO_USER_QUOTA_BYTES 1073741824
assert_name_value MAX_PENDING_JOBS_PER_USER 5
assert_name_value AUDIO_INGEST_RATE_LIMIT_CAPACITY 120
assert_name_value AUDIO_INGEST_RATE_LIMIT_REFILL_PER_SEC 2.5

# Scoped to each manifest specifically: these must reach the web pod (the
# only reader — app/server/functions/audio.ts and
# app/lib/audio-rate-limits.ts both run in the web image) and must NOT leak
# onto the audio-worker pod, which shares the same top-level `.Values` but
# has its own, separate `env` block.
web_out=$(render -s templates/web-deployment.yaml --set web.env.AUDIO_USER_QUOTA_BYTES=1073741824)
echo "$web_out" | grep -q "name: AUDIO_USER_QUOTA_BYTES" && ok ||
  bad "AUDIO_USER_QUOTA_BYTES reaches the web deployment"
worker_isolation_out=$(render -s templates/audio-worker-deployment.yaml \
  --set web.env.AUDIO_USER_QUOTA_BYTES=1073741824)
echo "$worker_isolation_out" | grep -q "name: AUDIO_USER_QUOTA_BYTES" &&
  bad "AUDIO_USER_QUOTA_BYTES must not leak onto the audio-worker pod" || ok

# ---- summary ----
echo "render-tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
