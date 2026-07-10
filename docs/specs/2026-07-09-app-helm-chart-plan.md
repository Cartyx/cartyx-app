# App Helm Chart + Auto-Deploy — Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Helm chart (`deploy/charts/cartyx`) deploying web + realtime as two releases (`cartyx-prod` / `cartyx-dev` namespaces), auto-deployed by GitHub Actions on merge to `main` / `dev` via ghcr.io + Tailscale.

**Architecture:** Flat single chart with per-service templates and component-keyed values (`web:`, `realtime:`). A render-test script (`helm template` + grep assertions) is the chart's test suite, wired into CI. A new `deploy.yml` workflow builds/pushes images and runs `helm upgrade` against the k3s API over the tailnet, with secrets from GitHub Environments. The local kind path upgrades from realtime-only to the full chart; the Phase 1 `cartyx-realtime` chart is deleted.

**Tech Stack:** Helm 3, k3s (Traefik v3 ingress, cert-manager), GitHub Actions, Docker, kind, bash.

**Spec:** `docs/specs/2026-07-09-app-helm-chart-design.md` (approved, committed as f766e85).

## Global Constraints

- Work happens on branch `app-helm-chart` (already created off fresh `origin/dev`); the PR targets `dev`, never `main`.
- Never commit a `.env` or any secret value; committed values files carry `""` for secrets and image tags.
- `deploy/charts/` is in `.prettierignore` (Helm `{{ }}` is not valid YAML) — chart files are exempt from prettier; everything else (workflows, kind-config, md) gets auto-formatted by the lefthook pre-commit hook.
- `deploy/local/deploy-kind.sh` must stay macOS bash 3.2 compatible (no `mapfile`, no `${var,,}`; guard empty-array expansion with `${arr[@]+"${arr[@]}"}`).
- Do not regress Phase 1 chart behaviors: realtime `replicaCount > 1` fail guard, `checksum/secret` pod annotation, `--set-string` comma/backslash escaping for secrets.
- No CPU limits on any container (event-loop throttling). Memory limits: web 512Mi prod / 384Mi dev; realtime 256Mi prod / 192Mi dev.
- No new npm dependencies anywhere in this plan (supply-chain rule is moot but stated).
- Resource naming: release `cartyx` → Deployments/Services `cartyx-web` and `cartyx-realtime`; Secret/Ingress/Certificate `cartyx`; Middleware/IngressRoute `cartyx-block-health`.
- Secret keys (exact, camelCase): `sessionSecret`, `mongodbUri`, `googleClientSecret`, `githubClientSecret`, `r2AccessKeyId`, `r2SecretAccessKey`, `posthogKey`.
- Image refs: `ghcr.io/biozal/cartyx-web` (tags `prod-<sha7>` / `dev-<sha7>` / `local`), `ghcr.io/biozal/cartyx-realtime` (tags `<sha7>` / `local`).
- Verify helm is installed before Task 1: `helm version --short` (if missing: `brew install helm`).

---

### Task 1: Chart scaffold + render-test harness

**Files:**

- Create: `deploy/charts/cartyx/Chart.yaml`
- Create: `deploy/charts/cartyx/.helmignore`
- Create: `deploy/charts/cartyx/values.yaml`
- Create: `deploy/charts/cartyx/tests/render-tests.sh`

**Interfaces:**

- Produces: the values schema every later template consumes (exact keys below), and the test harness functions `render`, `assert_contains`, `assert_not_contains`, `assert_fails`, `args_without`, plus the `BASE_ARGS` array that satisfies every `required` guard. Later tasks append assertions between the `---- assertions ----` marker and the summary lines.

- [ ] **Step 1: Write the failing test (harness + first assertions)**

Create `deploy/charts/cartyx/tests/render-tests.sh`:

```bash
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
  local name=$1 pattern=$2
  shift 2
  render "$@" | grep -qE "$pattern" && ok || bad "$name"
}

# assert_not_contains <name> <egrep pattern> [extra render args...]
assert_not_contains() {
  local name=$1 pattern=$2
  shift 2
  render "$@" | grep -qE "$pattern" && bad "$name" || ok
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

# ---- summary ----
echo "render-tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh`
Expected: fails immediately — the chart directory doesn't exist yet (`helm lint` FAIL, `assert_contains` FAIL, exit 1).

- [ ] **Step 3: Create the chart scaffold**

`deploy/charts/cartyx/Chart.yaml`:

```yaml
apiVersion: v2
name: cartyx
description: Cartyx app chart — web (TanStack Start/Nitro) + realtime (ws) as one release per environment
type: application
version: 0.1.0
appVersion: '0.1.0'
```

`deploy/charts/cartyx/.helmignore`:

```
.DS_Store
*.swp
*.tmp
tests/
```

`deploy/charts/cartyx/values.yaml`:

```yaml
# Production-shaped defaults for the cartyx app chart (web + realtime).
# Per-environment overrides: values-prod.yaml / values-dev.yaml.
# Local kind overrides: values-local.yaml.
#
# Image tags are REQUIRED at install time (immutable git-sha tags, e.g.
# prod-a1b2c3d) — committed files never pin a tag and `latest` never deploys.
# Secret values are injected at deploy time (GitHub Environment secrets via
# helm --set-string) and are never committed.

web:
  image:
    repository: ghcr.io/biozal/cartyx-web
    tag: ''
    pullPolicy: IfNotPresent
  replicaCount: 1
  service:
    type: ClusterIP
    nodePort: null # honored only when type is NodePort
  resources:
    requests:
      cpu: 100m
      memory: 192Mi
    limits:
      memory: 512Mi # no CPU limit — avoids event-loop throttling
  # Plain (non-secret) server-read env, live at deploy time. Empty values are
  # omitted from the pod. VITE_PUBLIC_* client values are NOT here — they are
  # baked into the image at build time from deploy/build/web-<env>.args, so a
  # client flag/host change means an image rebuild, not a helm change.
  env:
    APP_ENV: production
    PORT: '3000'
    BASE_URL: ''
    GOOGLE_CLIENT_ID: ''
    GITHUB_CLIENT_ID: ''
    R2_ACCOUNT_ID: ''
    R2_BUCKET: ''
    CDN_URL: ''
    POSTHOG_HOST: 'https://app.posthog.com'

realtime:
  image:
    repository: ghcr.io/biozal/cartyx-realtime
    tag: ''
    pullPolicy: IfNotPresent
  # MUST stay 1: rooms and relay state live in per-pod in-memory maps with no
  # cross-pod sharing or sticky session routing. Scaling this out silently
  # splits clients into disjoint rooms. Raising it requires sticky routing or
  # external room state (e.g. Redis) first. The deployment template enforces
  # this with a `fail` guard.
  replicaCount: 1
  service:
    type: ClusterIP
    nodePort: null
  resources:
    requests:
      cpu: 50m
      memory: 128Mi
    limits:
      memory: 256Mi
  env:
    PORT: '1999'

ingress:
  enabled: true
  className: traefik
  webHost: '' # e.g. app.cartyx.io — required when ingress.enabled
  wsHost: '' # e.g. ws.cartyx.io — required when ingress.enabled
  # 403 /healthz + /readyz at the ingress (Traefik Middleware + IngressRoute).
  # Kubelet probes hit pods directly and are unaffected.
  blockHealthEndpoints: true

tls:
  secretName: cartyx-tls
  certificate:
    enabled: true # cert-manager Certificate covering [webHost, wsHost]
    clusterIssuer: '' # required when enabled — find it: kubectl get clusterissuer

secret:
  create: true
  # Name of a pre-created Secret holding the same keys; when set, the chart
  # does not manage a Secret and the checksum-restart behavior is inert
  # (immutable image tags force rollouts anyway).
  existingSecret: ''
  values:
    sessionSecret: '' # required; >=32 chars when APP_ENV is production/staging
    mongodbUri: '' # required
    googleClientSecret: ''
    githubClientSecret: ''
    r2AccessKeyId: ''
    r2SecretAccessKey: ''
    posthogKey: ''

nameOverride: ''
fullnameOverride: ''
```

- [ ] **Step 4: Run the tests**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh`
Expected: `helm lint` passes; "chart renders at least one object" still FAILS (no templates yet — that's the failing test Task 2 turns green). Output: `render-tests: 1 passed, 1 failed`, exit 1.

- [ ] **Step 5: Commit**

```bash
git add deploy/charts/cartyx
git commit -m "feat(chart): cartyx chart scaffold, values schema, render-test harness"
```

---

### Task 2: Helpers + Secret template

**Files:**

- Create: `deploy/charts/cartyx/templates/_helpers.tpl`
- Create: `deploy/charts/cartyx/templates/secret.yaml`
- Modify: `deploy/charts/cartyx/tests/render-tests.sh` (append assertions)

**Interfaces:**

- Consumes: values schema from Task 1.
- Produces: named templates `cartyx.name`, `cartyx.fullname`, `cartyx.labels`, `cartyx.web.selectorLabels`, `cartyx.realtime.selectorLabels`, `cartyx.secretName` (resolves to `existingSecret` when set, else the fullname). Secret object named `{{ cartyx.fullname }}` with the seven camelCase keys. All later templates use exactly these.

- [ ] **Step 1: Write the failing tests**

Append under the `---- assertions ----` marker in `render-tests.sh` (keep the Task 1 lines; everything lands before the `---- summary ----` block):

```bash
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
```

(Word-splitting `$filtered_args` unquoted is deliberate — the entries are single tokens with no spaces.)

- [ ] **Step 2: Run to verify the new assertions fail**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh`
Expected: the four `assert_contains`/`assert_fails` secret assertions FAIL (no templates exist); `existingSecret suppresses` passes vacuously.

- [ ] **Step 3: Write the templates**

`deploy/charts/cartyx/templates/_helpers.tpl`:

```
{{- define "cartyx.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cartyx.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "cartyx.labels" -}}
app.kubernetes.io/name: {{ include "cartyx.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{- define "cartyx.web.selectorLabels" -}}
app.kubernetes.io/name: {{ include "cartyx.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: web
{{- end -}}

{{- define "cartyx.realtime.selectorLabels" -}}
app.kubernetes.io/name: {{ include "cartyx.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: realtime
{{- end -}}

{{- define "cartyx.secretName" -}}
{{- if .Values.secret.existingSecret -}}
{{- .Values.secret.existingSecret -}}
{{- else -}}
{{- include "cartyx.fullname" . -}}
{{- end -}}
{{- end -}}
```

`deploy/charts/cartyx/templates/secret.yaml`:

```
{{- if and .Values.secret.create (not .Values.secret.existingSecret) }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "cartyx.fullname" . }}
  labels:
    {{- include "cartyx.labels" . | nindent 4 }}
type: Opaque
stringData:
  sessionSecret: {{ required "secret.values.sessionSecret is required — inject at deploy time with --set-string" .Values.secret.values.sessionSecret | quote }}
  mongodbUri: {{ required "secret.values.mongodbUri is required — inject at deploy time with --set-string" .Values.secret.values.mongodbUri | quote }}
  googleClientSecret: {{ .Values.secret.values.googleClientSecret | quote }}
  githubClientSecret: {{ .Values.secret.values.githubClientSecret | quote }}
  r2AccessKeyId: {{ .Values.secret.values.r2AccessKeyId | quote }}
  r2SecretAccessKey: {{ .Values.secret.values.r2SecretAccessKey | quote }}
  posthogKey: {{ .Values.secret.values.posthogKey | quote }}
{{- end }}
```

- [ ] **Step 4: Run the tests**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh`
Expected: all assertions pass, including Task 1's "renders at least one object". `render-tests: 8 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add deploy/charts/cartyx
git commit -m "feat(chart): helpers and shared Secret with required guards + existingSecret"
```

---

### Task 3: Realtime Deployment + Service

**Files:**

- Create: `deploy/charts/cartyx/templates/realtime-deployment.yaml`
- Create: `deploy/charts/cartyx/templates/realtime-service.yaml`
- Modify: `deploy/charts/cartyx/tests/render-tests.sh` (append assertions)

**Interfaces:**

- Consumes: `cartyx.fullname`, `cartyx.labels`, `cartyx.realtime.selectorLabels`, `cartyx.secretName` (Task 2); values `realtime.*` (Task 1).
- Produces: Deployment + Service both named `{{ cartyx.fullname }}-realtime` (→ `cartyx-realtime`), Service port = `realtime.env.PORT` (1999). Task 4's `REALTIME_INTERNAL_HOST` and Task 5's ingress backend rely on this name and port.

- [ ] **Step 1: Write the failing tests**

Append to the assertions section:

```bash
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh`
Expected: all nine new assertions FAIL; earlier ones still pass.

- [ ] **Step 3: Write the templates**

`deploy/charts/cartyx/templates/realtime-deployment.yaml`:

```
{{- if gt (int .Values.realtime.replicaCount) 1 }}
{{- fail "realtime.replicaCount > 1 is not supported: rooms are per-pod in-memory state with no sticky routing" }}
{{- end }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "cartyx.fullname" . }}-realtime
  labels:
    {{- include "cartyx.labels" . | nindent 4 }}
    app.kubernetes.io/component: realtime
spec:
  replicas: {{ .Values.realtime.replicaCount }}
  # Recreate, not RollingUpdate: room state is in-memory in a single pod; a
  # rolling update would briefly run two pods and split connected players
  # into disjoint rooms.
  strategy:
    type: Recreate
  selector:
    matchLabels:
      {{- include "cartyx.realtime.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      annotations:
        checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
      labels:
        {{- include "cartyx.realtime.selectorLabels" . | nindent 8 }}
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: realtime
          image: "{{ .Values.realtime.image.repository }}:{{ required "realtime.image.tag is required — set an immutable git-sha tag at install time" .Values.realtime.image.tag }}"
          imagePullPolicy: {{ .Values.realtime.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
          ports:
            - name: ws
              containerPort: {{ .Values.realtime.env.PORT | int }}
          env:
            - name: PORT
              value: {{ .Values.realtime.env.PORT | quote }}
            - name: SESSION_SECRET
              valueFrom:
                secretKeyRef:
                  name: {{ include "cartyx.secretName" . }}
                  key: sessionSecret
            - name: MONGODB_URI
              valueFrom:
                secretKeyRef:
                  name: {{ include "cartyx.secretName" . }}
                  key: mongodbUri
          livenessProbe:
            httpGet:
              path: /healthz
              port: ws
            initialDelaySeconds: 5
            periodSeconds: 15
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /healthz
              port: ws
            initialDelaySeconds: 2
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          resources:
            {{- toYaml .Values.realtime.resources | nindent 12 }}
```

`deploy/charts/cartyx/templates/realtime-service.yaml`:

```
apiVersion: v1
kind: Service
metadata:
  name: {{ include "cartyx.fullname" . }}-realtime
  labels:
    {{- include "cartyx.labels" . | nindent 4 }}
    app.kubernetes.io/component: realtime
spec:
  type: {{ .Values.realtime.service.type }}
  selector:
    {{- include "cartyx.realtime.selectorLabels" . | nindent 4 }}
  ports:
    - name: ws
      port: {{ .Values.realtime.env.PORT | int }}
      targetPort: ws
      {{- if and (eq .Values.realtime.service.type "NodePort") .Values.realtime.service.nodePort }}
      nodePort: {{ .Values.realtime.service.nodePort }}
      {{- end }}
```

- [ ] **Step 4: Run the tests**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh`
Expected: all pass (`17 passed, 0 failed`), exit 0.

- [ ] **Step 5: Commit**

```bash
git add deploy/charts/cartyx
git commit -m "feat(chart): realtime Deployment (Recreate, hardened, replica guard) + Service"
```

---

### Task 4: Web Deployment + Service

**Files:**

- Create: `deploy/charts/cartyx/templates/web-deployment.yaml`
- Create: `deploy/charts/cartyx/templates/web-service.yaml`
- Modify: `deploy/charts/cartyx/tests/render-tests.sh` (append assertions)

**Interfaces:**

- Consumes: helpers (Task 2); realtime Service name + port (Task 3) for `REALTIME_INTERNAL_HOST`; values `web.*` (Task 1).
- Produces: Deployment + Service named `{{ cartyx.fullname }}-web` (→ `cartyx-web`), Service port = `web.env.PORT` (3000). Task 5's ingress backend and the workflows' `rollout status deploy/cartyx-web` rely on these names.

- [ ] **Step 1: Write the failing tests**

Append:

```bash
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh`
Expected: the new assertions FAIL ("empty web env values are omitted" passes vacuously); earlier ones pass.

- [ ] **Step 3: Write the templates**

`deploy/charts/cartyx/templates/web-deployment.yaml`:

```
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "cartyx.fullname" . }}-web
  labels:
    {{- include "cartyx.labels" . | nindent 4 }}
    app.kubernetes.io/component: web
spec:
  replicas: {{ .Values.web.replicaCount }}
  selector:
    matchLabels:
      {{- include "cartyx.web.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      annotations:
        checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
      labels:
        {{- include "cartyx.web.selectorLabels" . | nindent 8 }}
    spec:
      securityContext:
        runAsNonRoot: true
        # Dockerfile.web runs as the `node` user (uid 1000).
        runAsUser: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: web
          image: "{{ .Values.web.image.repository }}:{{ required "web.image.tag is required — set an immutable git-sha tag at install time" .Values.web.image.tag }}"
          imagePullPolicy: {{ .Values.web.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
          ports:
            - name: http
              containerPort: {{ .Values.web.env.PORT | int }}
          env:
            {{- range $key, $value := .Values.web.env }}
            {{- if $value }}
            - name: {{ $key }}
              value: {{ $value | quote }}
            {{- end }}
            {{- end }}
            # Server-side broadcasts (map:active-changed) reach the realtime
            # service by its in-cluster Service DNS name; the browser-facing
            # VITE_PUBLIC_PARTYKIT_HOST is baked into the client bundle and
            # is wrong inside the pod.
            - name: REALTIME_INTERNAL_HOST
              value: {{ printf "%s-realtime:%s" (include "cartyx.fullname" .) (.Values.realtime.env.PORT | toString) | quote }}
            - name: SESSION_SECRET
              valueFrom:
                secretKeyRef:
                  name: {{ include "cartyx.secretName" . }}
                  key: sessionSecret
            - name: MONGODB_URI
              valueFrom:
                secretKeyRef:
                  name: {{ include "cartyx.secretName" . }}
                  key: mongodbUri
            # The remaining secret keys are optional features (OAuth, R2,
            # PostHog). `optional: true` lets an existingSecret omit them.
            - name: GOOGLE_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: {{ include "cartyx.secretName" . }}
                  key: googleClientSecret
                  optional: true
            - name: GITHUB_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: {{ include "cartyx.secretName" . }}
                  key: githubClientSecret
                  optional: true
            - name: R2_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: {{ include "cartyx.secretName" . }}
                  key: r2AccessKeyId
                  optional: true
            - name: R2_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ include "cartyx.secretName" . }}
                  key: r2SecretAccessKey
                  optional: true
            - name: POSTHOG_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ include "cartyx.secretName" . }}
                  key: posthogKey
                  optional: true
          livenessProbe:
            # /healthz does no I/O; a Mongo outage must not restart the pod.
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 15
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            # /readyz pings Mongo with a 2s server-side bound; timeoutSeconds
            # sits above it so a slow Atlas moment marks the pod unready
            # instead of racing the probe.
            httpGet:
              path: /readyz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          resources:
            {{- toYaml .Values.web.resources | nindent 12 }}
```

`deploy/charts/cartyx/templates/web-service.yaml`:

```
apiVersion: v1
kind: Service
metadata:
  name: {{ include "cartyx.fullname" . }}-web
  labels:
    {{- include "cartyx.labels" . | nindent 4 }}
    app.kubernetes.io/component: web
spec:
  type: {{ .Values.web.service.type }}
  selector:
    {{- include "cartyx.web.selectorLabels" . | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.web.env.PORT | int }}
      targetPort: http
      {{- if and (eq .Values.web.service.type "NodePort") .Values.web.service.nodePort }}
      nodePort: {{ .Values.web.service.nodePort }}
      {{- end }}
```

- [ ] **Step 4: Run the tests**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh`
Expected: all pass (`26 passed, 0 failed`), exit 0.

- [ ] **Step 5: Commit**

```bash
git add deploy/charts/cartyx
git commit -m "feat(chart): web Deployment (readyz probe, in-cluster realtime host) + Service"
```

---

### Task 5: Ingress, health-block middleware, Certificate

**Files:**

- Create: `deploy/charts/cartyx/templates/ingress.yaml`
- Create: `deploy/charts/cartyx/templates/middleware.yaml`
- Create: `deploy/charts/cartyx/templates/certificate.yaml`
- Modify: `deploy/charts/cartyx/tests/render-tests.sh` (append assertions)

**Interfaces:**

- Consumes: service names/ports from Tasks 3–4; values `ingress.*`, `tls.*` (Task 1).
- Produces: Ingress `cartyx`, Certificate `cartyx` (writes `tls.secretName`), Traefik `Middleware` + `IngressRoute` both `cartyx-block-health`. Nothing later consumes these by name except the runbook.

**Design note (refines the spec):** a plain Ingress annotation can't scope a middleware to two paths, so the health block is a Traefik `IngressRoute` matching `Host && (Path(/healthz) || Path(/readyz))` at explicit `priority: 100` (outranking the host-only routers from the Ingress), carrying an `ipAllowList` middleware whose source range (`255.255.255.255/32`) matches no real client → every external hit gets 403. k3s ships these CRDs (`traefik.io/v1alpha1`, Traefik v3). If the box's Traefik is still v2, the CRD field is `ipWhiteList` — runbook troubleshooting covers it.

- [ ] **Step 1: Write the failing tests**

Append:

```bash
# --- Task 5: ingress + health block + certificate ---
assert_contains "ingress has web host rule" "host: web.test"
assert_contains "ingress has ws host rule" "host: ws.test"
assert_contains "ingress tls secret" "secretName: cartyx-tls"
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh`
Expected: the positive assertions and both `assert_fails` FAIL; the three `assert_not_contains` pass vacuously.

- [ ] **Step 3: Write the templates**

`deploy/charts/cartyx/templates/ingress.yaml`:

```
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "cartyx.fullname" . }}
  labels:
    {{- include "cartyx.labels" . | nindent 4 }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  tls:
    - hosts:
        - {{ required "ingress.webHost is required when ingress.enabled" .Values.ingress.webHost }}
        - {{ required "ingress.wsHost is required when ingress.enabled" .Values.ingress.wsHost }}
      secretName: {{ .Values.tls.secretName }}
  rules:
    - host: {{ .Values.ingress.webHost }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "cartyx.fullname" . }}-web
                port:
                  number: {{ .Values.web.env.PORT | int }}
    - host: {{ .Values.ingress.wsHost }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "cartyx.fullname" . }}-realtime
                port:
                  number: {{ .Values.realtime.env.PORT | int }}
{{- end }}
```

`deploy/charts/cartyx/templates/middleware.yaml`:

```
{{- if and .Values.ingress.enabled .Values.ingress.blockHealthEndpoints }}
# Blocks /healthz and /readyz from the public internet: the IngressRoute
# below outranks the host-only routers created from the Ingress (priority
# 100 > rule-length defaults), and its ipAllowList matches no real source
# address, so Traefik answers 403 before any backend is reached. Kubelet
# probes talk to the pod IP directly and never traverse the ingress.
# Traefik v2 note: the CRD field there is `ipWhiteList` (same shape).
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: {{ include "cartyx.fullname" . }}-block-health
  labels:
    {{- include "cartyx.labels" . | nindent 4 }}
spec:
  ipAllowList:
    sourceRange:
      - 255.255.255.255/32
---
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: {{ include "cartyx.fullname" . }}-block-health
  labels:
    {{- include "cartyx.labels" . | nindent 4 }}
spec:
  entryPoints:
    - websecure
  routes:
    - kind: Rule
      match: (Host(`{{ .Values.ingress.webHost }}`) || Host(`{{ .Values.ingress.wsHost }}`)) && (Path(`/healthz`) || Path(`/readyz`))
      priority: 100
      middlewares:
        - name: {{ include "cartyx.fullname" . }}-block-health
      services:
        # Never reached — the middleware 403s first — but the CRD requires one.
        - name: {{ include "cartyx.fullname" . }}-web
          port: {{ .Values.web.env.PORT | int }}
  tls:
    secretName: {{ .Values.tls.secretName }}
{{- end }}
```

`deploy/charts/cartyx/templates/certificate.yaml`:

```
{{- if .Values.tls.certificate.enabled }}
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: {{ include "cartyx.fullname" . }}
  labels:
    {{- include "cartyx.labels" . | nindent 4 }}
spec:
  secretName: {{ .Values.tls.secretName }}
  issuerRef:
    kind: ClusterIssuer
    name: {{ required "tls.certificate.clusterIssuer is required when tls.certificate.enabled — find it with: kubectl get clusterissuer" .Values.tls.certificate.clusterIssuer }}
  dnsNames:
    - {{ required "ingress.webHost is required" .Values.ingress.webHost }}
    - {{ required "ingress.wsHost is required" .Values.ingress.wsHost }}
{{- end }}
```

- [ ] **Step 4: Run the tests**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh`
Expected: all pass (`37 passed, 0 failed`), exit 0.

- [ ] **Step 5: Commit**

```bash
git add deploy/charts/cartyx
git commit -m "feat(chart): Ingress (web+ws hosts), health-endpoint 403 block, cert-manager Certificate"
```

---

### Task 6: Environment values files + web build-args files

**Files:**

- Create: `deploy/charts/cartyx/values-prod.yaml`
- Create: `deploy/charts/cartyx/values-dev.yaml`
- Create: `deploy/build/web-prod.args`
- Create: `deploy/build/web-dev.args`
- Modify: `deploy/charts/cartyx/tests/render-tests.sh` (append assertions)

**Interfaces:**

- Consumes: values schema (Task 1).
- Produces: the `-f` files the deploy workflow (Task 8) passes as `deploy/charts/cartyx/values-$DEPLOY_ENV.yaml`, and the build-arg files it reads as `deploy/build/web-$DEPLOY_ENV.args` (`DEPLOY_ENV` ∈ `prod`|`dev`; plain `KEY=VALUE` lines, `#` comments).

- [ ] **Step 1: Write the failing tests**

Append:

```bash
# --- Task 6: environment values files ---
prod_args=$(args_without ingress.)
# shellcheck disable=SC2086
if helm template cartyx "$CHART_DIR" $prod_args -f "$CHART_DIR/values-prod.yaml" 2>&1 |
  grep -q "host: app.cartyx.io"; then ok; else bad "values-prod resolves prod hosts"; fi
# shellcheck disable=SC2086
if helm template cartyx "$CHART_DIR" $prod_args -f "$CHART_DIR/values-dev.yaml" 2>&1 |
  grep -q "host: dev-ws.cartyx.io"; then ok; else bad "values-dev resolves dev ws host"; fi
# shellcheck disable=SC2086
if helm template cartyx "$CHART_DIR" $prod_args -f "$CHART_DIR/values-dev.yaml" 2>&1 |
  grep -q 'value: "staging"'; then ok; else bad "values-dev sets APP_ENV=staging"; fi
# shellcheck disable=SC2086
if helm template cartyx "$CHART_DIR" $prod_args -f "$CHART_DIR/values-dev.yaml" 2>&1 |
  grep -q "memory: 384Mi"; then ok; else bad "values-dev web memory limit"; fi
```

- [ ] **Step 2: Run to verify they fail**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh`
Expected: the four new checks FAIL (files don't exist; helm errors on missing `-f`).

- [ ] **Step 3: Write the files**

`deploy/charts/cartyx/values-prod.yaml`:

```yaml
# Production release: helm -n cartyx-prod -f values-prod.yaml
# Image tags and secret values are injected by .github/workflows/deploy.yml.
# Client-baked VITE_PUBLIC_* values live in deploy/build/web-prod.args.
web:
  env:
    APP_ENV: production
    BASE_URL: https://app.cartyx.io
    # OAuth client IDs are public identifiers (they appear in every auth
    # redirect URL) — fill in and commit; the SECRETS live in the GitHub
    # `production` Environment.
    GOOGLE_CLIENT_ID: ''
    GITHUB_CLIENT_ID: ''
    R2_ACCOUNT_ID: ''
    R2_BUCKET: ''
    CDN_URL: ''

ingress:
  webHost: app.cartyx.io
  wsHost: ws.cartyx.io

tls:
  certificate:
    clusterIssuer: '' # fill in once: kubectl get clusterissuer
```

`deploy/charts/cartyx/values-dev.yaml`:

```yaml
# Dev-site release: helm -n cartyx-dev -f values-dev.yaml
# APP_ENV is `staging`, not `development`: prod-like cookies/uploads/secret
# enforcement, but labeled distinctly for analytics and DB policy. The
# `development` value would enable laptop-only local-disk upload fallbacks.
web:
  env:
    APP_ENV: staging
    BASE_URL: https://dev.cartyx.io
    GOOGLE_CLIENT_ID: ''
    GITHUB_CLIENT_ID: ''
    R2_ACCOUNT_ID: ''
    R2_BUCKET: ''
    CDN_URL: ''
  resources:
    limits:
      memory: 384Mi

realtime:
  resources:
    limits:
      memory: 192Mi

ingress:
  webHost: dev.cartyx.io
  wsHost: dev-ws.cartyx.io

tls:
  certificate:
    clusterIssuer: '' # fill in once: kubectl get clusterissuer
```

`deploy/build/web-prod.args`:

```
# Client-baked build args for the PROD web image (ghcr.io/biozal/cartyx-web:prod-<sha>).
# KEY=VALUE lines; consumed as --build-arg by .github/workflows/deploy.yml.
# These compile into the browser bundle — changing one requires an image
# rebuild + redeploy (merge to main), not a helm change.
VITE_PUBLIC_PARTYKIT_HOST=ws.cartyx.io
VITE_PUBLIC_FF_CHAT=true
VITE_PUBLIC_FF_DICE=true
VITE_PUBLIC_FF_WIKI=true
VITE_PUBLIC_FF_NOTES=true
VITE_PUBLIC_FF_SETTINGS=true
# PostHog browser key is publishable (it ships in the bundle); fill in.
VITE_PUBLIC_POSTHOG_KEY=
VITE_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

`deploy/build/web-dev.args`:

```
# Client-baked build args for the DEV web image (ghcr.io/biozal/cartyx-web:dev-<sha>).
# KEY=VALUE lines; consumed as --build-arg by .github/workflows/deploy.yml.
VITE_PUBLIC_PARTYKIT_HOST=dev-ws.cartyx.io
VITE_PUBLIC_FF_CHAT=true
VITE_PUBLIC_FF_DICE=true
VITE_PUBLIC_FF_WIKI=true
VITE_PUBLIC_FF_NOTES=true
VITE_PUBLIC_FF_SETTINGS=true
VITE_PUBLIC_POSTHOG_KEY=
VITE_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

- [ ] **Step 4: Run the tests**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh`
Expected: all pass (`41 passed, 0 failed`), exit 0.

- [ ] **Step 5: Commit**

```bash
git add deploy/charts/cartyx deploy/build
git commit -m "feat(deploy): prod/dev values files and client build-arg files"
```

---

### Task 7: CI — helm job + e2e feature-flag fix

**Files:**

- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `deploy/charts/cartyx/tests/render-tests.sh` (Task 1–6).
- Produces: a `helm` CI job later PRs rely on; corrected e2e env.

**Why the flag fix belongs here:** PR #490 switched `VITE_PUBLIC_FF_*` to strict booleans (`parseBooleanFlag` in `app/utils/featureFlags.tsx:40-42` accepts only `'true'`/`'1'`), but the e2e job env still passes PostHog-era flag _names_ (`cartyx-dice-dev`, …) — those now parse as **disabled**, the gated inspector tabs never render, and the e2e job fails (it was red on #490: `E2E (Playwright) FAILURE`). This PR touches ci.yml anyway; fix it here so this PR's own e2e can gate it.

- [ ] **Step 1: Fix the e2e flag env**

In `.github/workflows/ci.yml`, replace lines 133–140 (the comment block starting `# Feature-flag NAMES must be present…` and the five `VITE_PUBLIC_FF_*` entries):

```yaml
# Inspector feature flags are plain booleans baked in at build time
# since #490 (parseBooleanFlag in app/utils/featureFlags.tsx accepts
# only 'true'/'1'). They must be 'true' here or the gated inspector
# tabs never render — the Wiki tab being absent is what times out
# every calendar/locations/lore spec.
VITE_PUBLIC_FF_DICE: 'true'
VITE_PUBLIC_FF_CHAT: 'true'
VITE_PUBLIC_FF_WIKI: 'true'
VITE_PUBLIC_FF_NOTES: 'true'
VITE_PUBLIC_FF_SETTINGS: 'true'
```

Then update the stale sentence in the `VITE_PUBLIC_POSTHOG_KEY` comment just below: replace the clause `and feature flags never resolve without an initialized client — so flag-gated UI (e.g. the dice toolbar button) would never render in e2e.` with `PostHog no longer gates feature flags (they are baked booleans since #490), but specs that exercise analytics mocking still need an initialized client.` — keep the rest of that comment (the `mockPostHog` host-matching part is still true).

- [ ] **Step 2: Add the helm job**

Append at the end of `.github/workflows/ci.yml` (same indentation level as `build:`):

```yaml
helm:
  name: Helm chart
  runs-on: ubuntu-latest
  permissions:
    contents: read
  steps:
    - name: Checkout code
      uses: actions/checkout@v7

    - name: Chart render tests (includes helm lint)
      # helm ships preinstalled on ubuntu-latest runners.
      run: bash deploy/charts/cartyx/tests/render-tests.sh
```

- [ ] **Step 3: Validate**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh` (still green) and `npx prettier --check .github/workflows/ci.yml`
Expected: render tests exit 0; prettier clean (run `npx prettier --write .github/workflows/ci.yml` if not).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: helm chart render-test job; fix e2e VITE_PUBLIC_FF_* to booleans (#490 follow-through)"
```

---

### Task 8: Deploy workflow

**Files:**

- Create: `.github/workflows/deploy.yml`

**Interfaces:**

- Consumes: chart + values files (Tasks 1–6), `deploy/build/web-{prod,dev}.args` (Task 6), `Dockerfile.web`, `realtime/Dockerfile`.
- Produces: the deploy pipeline. Expects GitHub Environments `production` and `dev`, each with secrets `MONGODB_URI`, `SESSION_SECRET`, `GOOGLE_CLIENT_SECRET`, `OAUTH_GITHUB_CLIENT_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `POSTHOG_KEY`; repo-level secrets `TS_AUTHKEY`, `KUBECONFIG_B64`. (GitHub forbids secret names starting with `GITHUB_`, hence `OAUTH_GITHUB_CLIENT_SECRET`.)

- [ ] **Step 1: Write the workflow**

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [dev, main]
  workflow_dispatch: # manual deploys, including the very first install

# One deploy at a time per branch; queued pushes wait (never cancel a deploy
# mid-helm-upgrade).
concurrency:
  group: deploy-${{ github.ref_name }}
  cancel-in-progress: false

jobs:
  deploy:
    name: Build & deploy (${{ github.ref_name == 'main' && 'prod' || 'dev' }})
    runs-on: ubuntu-latest
    # Guard manual dispatches from feature branches.
    if: contains(fromJSON('["dev", "main"]'), github.ref_name)
    environment: ${{ github.ref_name == 'main' && 'production' || 'dev' }}
    permissions:
      contents: read
      packages: write
    env:
      DEPLOY_ENV: ${{ github.ref_name == 'main' && 'prod' || 'dev' }}
      WEB_HOST: ${{ github.ref_name == 'main' && 'app.cartyx.io' || 'dev.cartyx.io' }}
      REGISTRY: ghcr.io/${{ github.repository_owner }}
    steps:
      - name: Checkout code
        uses: actions/checkout@v7

      - name: Log in to ghcr.io
        run: echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "${{ github.actor }}" --password-stdin

      - name: Compute image tags
        id: tags
        run: |
          SHA=${GITHUB_SHA::7}
          {
            echo "sha=$SHA"
            echo "webtag=$DEPLOY_ENV-$SHA"
            echo "realtime=$REGISTRY/cartyx-realtime:$SHA"
            echo "web=$REGISTRY/cartyx-web:$DEPLOY_ENV-$SHA"
          } >> "$GITHUB_OUTPUT"

      - name: Build and push realtime image
        run: |
          docker build \
            --label "org.opencontainers.image.source=https://github.com/${{ github.repository }}" \
            -t "${{ steps.tags.outputs.realtime }}" realtime
          docker push "${{ steps.tags.outputs.realtime }}"

      - name: Build and push web image
        # VITE_PUBLIC_* are baked into the client bundle HERE. Changing a
        # feature flag or the ws host = edit deploy/build/web-$DEPLOY_ENV.args
        # and merge — a helm-only change cannot do it.
        run: |
          args=()
          while IFS= read -r line; do
            case "$line" in ''|'#'*) continue ;; esac
            args+=(--build-arg "$line")
          done < "deploy/build/web-$DEPLOY_ENV.args"
          docker build -f Dockerfile.web "${args[@]}" \
            --label "org.opencontainers.image.source=https://github.com/${{ github.repository }}" \
            -t "${{ steps.tags.outputs.web }}" .
          docker push "${{ steps.tags.outputs.web }}"

      - name: Connect to the tailnet
        uses: tailscale/github-action@v3
        with:
          authkey: ${{ secrets.TS_AUTHKEY }}

      - name: Write kubeconfig
        run: |
          mkdir -p ~/.kube
          echo "${{ secrets.KUBECONFIG_B64 }}" | base64 -d > ~/.kube/config
          chmod 600 ~/.kube/config
          kubectl version # fails fast if the k3s API is unreachable over the tailnet

      - name: Helm upgrade
        env:
          SESSION_SECRET: ${{ secrets.SESSION_SECRET }}
          MONGODB_URI: ${{ secrets.MONGODB_URI }}
          GOOGLE_CLIENT_SECRET: ${{ secrets.GOOGLE_CLIENT_SECRET }}
          # GitHub forbids secret names starting with GITHUB_, and custom
          # GITHUB_* env vars are reserved by Actions — hence this naming.
          OAUTH_GITHUB_CLIENT_SECRET: ${{ secrets.OAUTH_GITHUB_CLIENT_SECRET }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          POSTHOG_KEY: ${{ secrets.POSTHOG_KEY }}
        run: |
          # helm --set-string treats commas/backslashes as structural — escape
          # them (same rule as deploy/local/deploy-kind.sh; replica-set Mongo
          # URIs contain commas).
          esc() {
            local v="${1//\\/\\\\}"
            printf '%s' "${v//,/\\,}"
          }
          helm upgrade --install cartyx deploy/charts/cartyx \
            --namespace "cartyx-$DEPLOY_ENV" --create-namespace \
            -f "deploy/charts/cartyx/values-$DEPLOY_ENV.yaml" \
            --set web.image.tag="${{ steps.tags.outputs.webtag }}" \
            --set realtime.image.tag="${{ steps.tags.outputs.sha }}" \
            --set-string secret.values.sessionSecret="$(esc "$SESSION_SECRET")" \
            --set-string secret.values.mongodbUri="$(esc "$MONGODB_URI")" \
            --set-string secret.values.googleClientSecret="$(esc "$GOOGLE_CLIENT_SECRET")" \
            --set-string secret.values.githubClientSecret="$(esc "$OAUTH_GITHUB_CLIENT_SECRET")" \
            --set-string secret.values.r2AccessKeyId="$(esc "$R2_ACCESS_KEY_ID")" \
            --set-string secret.values.r2SecretAccessKey="$(esc "$R2_SECRET_ACCESS_KEY")" \
            --set-string secret.values.posthogKey="$(esc "$POSTHOG_KEY")" \
            --wait --timeout 5m

      - name: Verify in-cluster health
        run: |
          NS="cartyx-$DEPLOY_ENV"
          kubectl -n "$NS" rollout status deploy/cartyx-web --timeout=120s
          kubectl -n "$NS" rollout status deploy/cartyx-realtime --timeout=120s
          # /healthz + /readyz are 403'd at the ingress by design — probe the
          # Services from inside the cluster instead.
          kubectl -n "$NS" run "deploy-healthcheck-${{ steps.tags.outputs.sha }}" \
            --rm -i --restart=Never --image=curlimages/curl:8.11.1 -- \
            sh -c "curl -fsS http://cartyx-web:3000/readyz && curl -fsS http://cartyx-realtime:1999/healthz"

      - name: Verify public site
        # Fails if DNS for the host doesn't point at the box, TLS is broken,
        # or the app isn't serving. This IS the phase acceptance check.
        run: |
          code=$(curl -fsS -o /dev/null -w '%{http_code}' "https://$WEB_HOST/")
          echo "https://$WEB_HOST/ -> $code"
```

- [ ] **Step 2: Validate**

Run: `npx prettier --check .github/workflows/deploy.yml` (write if needed) and eyeball `git diff --staged` after adding — no secrets inline, every `${{ secrets.* }}` flows through `env:` into `run:` via shell vars (never string-interpolated into the script body except the login/kubeconfig steps where GitHub masks them).
Expected: prettier clean.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat(deploy): auto-deploy workflow — build/push ghcr images, helm upgrade over Tailscale"
```

---

### Task 9: Local kind path on the new chart; retire the old chart

**Files:**

- Create: `deploy/charts/cartyx/values-local.yaml`
- Modify: `deploy/local/kind-config.yaml`
- Modify: `deploy/local/deploy-kind.sh` (rewrite of `up()`, constants)
- Modify: `deploy/local/README.md`
- Delete: `deploy/charts/cartyx-realtime/` (entire directory)
- Modify: `deploy/charts/cartyx/tests/render-tests.sh` (append assertions)

**Interfaces:**

- Consumes: full chart (Tasks 1–6).
- Produces: `deploy-kind.sh up` deploying release `cartyx` into namespace `cartyx-local` with images `cartyx-web:local` / `cartyx-realtime:local`; web on host port **3200**, realtime on **1999** (unchanged).

- [ ] **Step 1: Write the failing render tests for values-local**

Append:

```bash
# --- Task 9: values-local ---
local_args=$(args_without ingress.)
# shellcheck disable=SC2086
if helm template cartyx "$CHART_DIR" $local_args -f "$CHART_DIR/values-local.yaml" 2>&1 |
  grep -q "nodePort: 30320"; then ok; else bad "values-local web NodePort"; fi
# shellcheck disable=SC2086
if helm template cartyx "$CHART_DIR" $local_args -f "$CHART_DIR/values-local.yaml" 2>&1 |
  grep -qE "kind: (Ingress|Certificate|Middleware)"; then bad "values-local disables ingress stack"; else ok; fi
```

Run: `bash deploy/charts/cartyx/tests/render-tests.sh` — the first new check FAILS (file missing).

- [ ] **Step 2: Write `deploy/charts/cartyx/values-local.yaml`**

```yaml
# Local kind overrides (deploy/local/deploy-kind.sh). Images are built
# locally and side-loaded with `kind load`; never pulled.
web:
  image:
    repository: cartyx-web
    tag: local
    pullPolicy: Never
  service:
    type: NodePort
    nodePort: 30320 # paired with deploy/local/kind-config.yaml: host 3200 -> 30320
  env:
    APP_ENV: development
    BASE_URL: http://localhost:3200

realtime:
  image:
    repository: cartyx-realtime
    tag: local
    pullPolicy: Never
  service:
    type: NodePort
    nodePort: 30199 # paired with kind-config.yaml: host 1999 -> 30199

# No Traefik / cert-manager in kind — NodePort access only.
ingress:
  enabled: false
tls:
  certificate:
    enabled: false
```

Run: `bash deploy/charts/cartyx/tests/render-tests.sh` — all pass (`43 passed, 0 failed`).

- [ ] **Step 3: Add the web port mapping to `deploy/local/kind-config.yaml`**

Append under the existing `extraPortMappings:` entry:

```yaml
# Host localhost:3200 -> Service NodePort 30320 -> web container 3000.
# 3000 stays free for `vite dev`, 3100 for the compose stack.
- containerPort: 30320
  hostPort: 3200
  protocol: TCP
```

- [ ] **Step 4: Rewrite `deploy/local/deploy-kind.sh`**

Keep the header comment style, `log`/`die`/`require_tools`/`read_env_value` and `down()` exactly as they are. Replace the constants block and `up()`:

Constants block (top of file, replacing the old one):

```bash
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
```

Also update the file's usage header comment: `# Local kind deploy for the Cartyx app chart (web + realtime).`

New helper (place after `read_env_value`):

```bash
# helm's --set-string parser treats commas and backslashes as structural
# (list/nested-key separators) — escape values like replica-set URIs.
esc() {
  local v="${1//\\/\\\\}"
  printf '%s' "${v//,/\\,}"
}
```

New `up()` (complete replacement):

```bash
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
    --build-arg VITE_PUBLIC_FF_CHAT=true \
    --build-arg VITE_PUBLIC_FF_DICE=true \
    --build-arg VITE_PUBLIC_FF_WIKI=true \
    --build-arg VITE_PUBLIC_FF_NOTES=true \
    --build-arg VITE_PUBLIC_FF_SETTINGS=true \
    --build-arg VITE_PUBLIC_POSTHOG_KEY="$(read_env_value VITE_PUBLIC_POSTHOG_KEY || true)" \
    --build-arg VITE_PUBLIC_POSTHOG_HOST="$(read_env_value VITE_PUBLIC_POSTHOG_HOST || true)" \
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
  add_secret POSTHOG_KEY posthogKey

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
```

New helper (place before `up()`):

```bash
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
```

- [ ] **Step 5: Delete the old chart**

```bash
git rm -r deploy/charts/cartyx-realtime
```

Then verify nothing else references it: `grep -rn "cartyx-realtime" --include="*.sh" --include="*.md" --include="*.yaml" --include="*.yml" deploy/ .github/ | grep -v "charts/cartyx/"` — remaining hits must only be the _image/deployment name_ `cartyx-realtime` (still correct), never the chart path `charts/cartyx-realtime`.

- [ ] **Step 6: Update `deploy/local/README.md`**

Exact edits:

1. Kind row of the top table (line 8): replace the sentence `Realtime-only until Phase 3.` with `Deploys the full app chart (web + realtime) — the same manifests as production.`
2. Paragraph at lines 10–14: replace the final sentence `The kind path still only deploys `realtime` — it is unchanged.` with `The kind path deploys the same two services from the `deploy/charts/cartyx` Helm chart: web on host port **3200**, realtime on **1999**.`
3. Environment section (lines 40–47): change the `MONGODB_URI` bullet from **optional** to **required for the kind path** — new text: `**`MONGODB_URI`** — required for the kind path (the web app can't pass `/readyz` without it) and recommended for compose. Point it at a **dedicated database in the URI path** so it stays out of the app's data:` (keep the code example).
4. Path B section (lines 76–78): replace the sentence describing what the script does with: `This creates a single-node kind cluster `cartyx-local`(host`1999`→ realtime NodePort`30199`, host `3200`→ web NodePort`30320`), builds both images, loads them into the cluster, deploys the `cartyx`Helm chart with your`.env` secrets, and waits until web and realtime answer their health endpoints.`
5. Verify section (lines 106–109): add a line `curl http://localhost:3200/healthz            # -> {"status":"ok"} (200, web, kind only)`.
6. Troubleshooting table: in the `Rollout times out` row (line 127), replace the command with `kubectl -n cartyx-local logs deploy/cartyx-web` and add `(or deploy/cartyx-realtime)`. In the `redirect_uri_mismatch` row (line 131), after `the stack serves on host **3100**` add `(compose) or **3200** (kind)`.

- [ ] **Step 7: Test end-to-end on kind**

Run: `bash -n deploy/local/deploy-kind.sh` (syntax) then `./deploy/local/deploy-kind.sh up`
Expected: cluster created/reused, both images build (web takes minutes), rollouts complete, all three `verify_endpoint` checks pass, "Ready." logged. Then open `http://localhost:3200` in a browser — the app serves. Tear down: `./deploy/local/deploy-kind.sh down`.

- [ ] **Step 8: Run the full render tests + commit**

Run: `bash deploy/charts/cartyx/tests/render-tests.sh` → exit 0.

```bash
git add -A deploy/local deploy/charts
git commit -m "feat(deploy): kind path deploys the full cartyx chart (web on :3200); retire cartyx-realtime chart"
```

---

### Task 10: Chart README (runbook), roadmap update, final verification

**Files:**

- Create: `deploy/charts/cartyx/README.md`
- Modify: `docs/specs/2026-07-07-selfhost-migration-roadmap.md`

**Interfaces:**

- Consumes: everything prior; secret names from Task 8.
- Produces: the operator runbook; roadmap reflecting the Phase 3/4 scope shift.

- [ ] **Step 1: Write `deploy/charts/cartyx/README.md`**

```markdown
# cartyx Helm chart

Deploys the Cartyx app — `web` (TanStack Start/Nitro, port 3000) and
`realtime` (ws service, port 1999) — as ONE release per environment:

| Release               | Namespace      | Values file         | Hosts                                |
| --------------------- | -------------- | ------------------- | ------------------------------------ |
| `cartyx` (prod)       | `cartyx-prod`  | `values-prod.yaml`  | `app.cartyx.io` / `ws.cartyx.io`     |
| `cartyx` (dev site)   | `cartyx-dev`   | `values-dev.yaml`   | `dev.cartyx.io` / `dev-ws.cartyx.io` |
| `cartyx` (local kind) | `cartyx-local` | `values-local.yaml` | `localhost:3200` / `localhost:1999`  |

Deploys run from `.github/workflows/deploy.yml` on merge to `dev` / `main`
(or manually via workflow_dispatch). **Nothing deploys from a laptop.**
Render tests: `bash deploy/charts/cartyx/tests/render-tests.sh` (also in CI).

## Client-baked vs server env

`VITE_PUBLIC_*` values (feature flags, the browser-facing ws host, the
PostHog browser key) are compiled into the client bundle when the image is
built, from `deploy/build/web-<env>.args`. **Changing one = edit that file,
merge, let the workflow rebuild.** Server-read env (`MONGODB_URI`,
`SESSION_SECRET`, OAuth, R2, `APP_ENV`, `BASE_URL`) is live at deploy time
via this chart.

## One-time setup

1. **Tailscale**: install on the box, join the tailnet, note the tailnet IP.
   Bind the k3s API to the tailnet interface / firewall it off the public IP.
2. **CI auth key**: tailnet admin console → ephemeral + reusable auth key
   (tag it, e.g. `tag:ci`) → repo secret `TS_AUTHKEY`.
3. **Kubeconfig**: copy `/etc/rancher/k3s/k3s.yaml`, change `server:` to
   `https://<tailnet-ip>:6443`, then `base64 -w0` the file → repo secret
   `KUBECONFIG_B64`.
4. **GitHub Environments**: create `production` and `dev` (repo Settings →
   Environments). In each, add: `MONGODB_URI`, `SESSION_SECRET`
   (≥32 chars), `GOOGLE_CLIENT_SECRET`, `OAUTH_GITHUB_CLIENT_SECRET`
   (GitHub forbids `GITHUB_*` secret names), `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `POSTHOG_KEY`. Optionally add a
   required-reviewer rule on `production`.
5. **Values files**: fill in `GOOGLE_CLIENT_ID` / `GITHUB_CLIENT_ID` /
   `R2_ACCOUNT_ID` / `R2_BUCKET` / `CDN_URL` in `values-prod.yaml` +
   `values-dev.yaml` (public identifiers — committing them is fine), and
   `VITE_PUBLIC_POSTHOG_KEY` in `deploy/build/web-*.args`.
6. **ClusterIssuer**: `kubectl get clusterissuer` → put the name in both
   values files (`tls.certificate.clusterIssuer`).
7. **OAuth redirect URIs**: register `https://app.cartyx.io/auth/callback/*`
   and `https://dev.cartyx.io/auth/callback/*` with Google/GitHub.
8. **First deploy**: Actions → Deploy → Run workflow on `dev`.
   ⚠️ The first push creates the ghcr packages **private** — after it, open
   github.com/biozal?tab=packages → `cartyx-web` and `cartyx-realtime` →
   settings → change visibility to **public**, then re-run the workflow
   (private packages would need an imagePullSecret the chart deliberately
   doesn't carry). Repeat on `main` once dev verifies.

## Operations

- **Rotate a secret**: update it in the GitHub Environment → re-run Deploy.
  The pod template's secret checksum changes, so pods restart automatically.
- **Flip a client feature flag**: edit `deploy/build/web-<env>.args`, merge.
- **Roll back**: re-run the Deploy workflow from the last good commit
  (workflow_dispatch), or `helm rollback cartyx -n cartyx-<env>` from a
  tailnet machine in an emergency.
- **Realtime is single-replica by design** (in-memory rooms); the chart
  refuses `replicaCount > 1` and uses a Recreate strategy (a deploy = a few
  seconds of WebSocket disconnect; clients reconnect via partysocket).

## Troubleshooting

| Symptom                                            | Cause / fix                                                                                                                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ErrImagePull` on first install                    | ghcr package is private (fresh packages default private). Make it public — setup step 8.                                                                                                            |
| Render error `... is required`                     | An image tag / secret / clusterIssuer wasn't passed. The workflow sets tags+secrets; the issuer lives in the values files.                                                                          |
| `/healthz` from the internet returns 403           | By design (`ingress.blockHealthEndpoints`). Probe in-cluster: `kubectl -n cartyx-<env> run hc --rm -i --restart=Never --image=curlimages/curl -- curl -fsS http://cartyx-web:3000/readyz`.          |
| Health block objects rejected by the API server    | Traefik v2 CRDs use `ipWhiteList` instead of `ipAllowList` (check: `kubectl -n kube-system describe deploy traefik \| grep -i image`). Edit `templates/middleware.yaml` accordingly or upgrade k3s. |
| WebSockets fail through Traefik but the site loads | Confirm `ws.cartyx.io` / `dev-ws.cartyx.io` resolve to the box and are **grey-clouded** in Cloudflare (proxied orange-cloud breaks non-HTTP upgrades on nonstandard setups).                        |
| Web pod restarts under load                        | Liveness only probes `/healthz` (no I/O) — check `kubectl top pod` for memory against the 512Mi/384Mi limits; the Node heap is capped at 400MB via the image CMD.                                   |
```

- [ ] **Step 2: Update the roadmap**

In `docs/specs/2026-07-07-selfhost-migration-roadmap.md`:

1. Under the `### Phase 3 — Helm chart for the app` heading, add as the first line: `Design: `2026-07-09-app-helm-chart-design.md`; plan: `2026-07-09-app-helm-chart-plan.md`. Scope grew during design: the auto-deploy workflow moved here from Phase 4; the box is on the LAN (Tailscale is only the CI deploy path); hostnames are app/ws/dev/dev-ws.cartyx.io.`
2. Replace the Phase 3 bullet `- Install both releases on the cluster manually first (`helm install` from laptop over Tailscale)` with `- Deploys run only via `.github/workflows/deploy.yml` (push to dev/main + workflow_dispatch); secrets in GitHub Environments — nothing installs from a laptop`
3. In Phase 4, replace the first two bullets (the `deploy.yml` bullet and the `Secrets as GitHub Actions secrets` bullet) with a single line: `- deploy.yml + GitHub Environment secrets shipped in Phase 3 — this phase is cutover + teardown only`

- [ ] **Step 3: Final verification sweep**

```bash
bash deploy/charts/cartyx/tests/render-tests.sh   # exit 0
bash -n deploy/local/deploy-kind.sh               # no output
npm test                                          # 1542+ passing
npx prettier --check .github/workflows deploy/local/README.md docs/specs/2026-07-07-selfhost-migration-roadmap.md
git log --oneline origin/dev..HEAD                # ~10 commits, spec first
```

Expected: all green. (Chart files are prettierignored; workflows/md are not.)

- [ ] **Step 4: Commit**

```bash
git add deploy/charts/cartyx/README.md docs/specs/2026-07-07-selfhost-migration-roadmap.md
git commit -m "docs(deploy): cartyx chart runbook; roadmap reflects Phase 3/4 scope shift"
```

---

## Acceptance (from the spec — verified after merge, not in this PR)

The PR itself is gated by CI (render tests, unit, e2e). The phase acceptance runs on real infrastructure after merge to `dev`: the Deploy workflow goes green end-to-end, `dev.cartyx.io` serves over TLS, dice rolls relay through `dev-ws.cartyx.io`, and `/healthz` 403s from the public internet. Then the same on `main`. The one-time setup (chart README steps 1–8) must happen between merge and the first green run — expect the first run to fail at image pull until package visibility is flipped (step 8).

## Out of scope (unchanged from the spec)

DNS cutover + PartyKit/Vercel teardown (Phase 4); two-browser manual verification before cutover; `addStackItem` TOCTOU fix; `location-lightbox.spec.ts` flake; eslint `ignores` for `realtime/dist/`; Phase 5 observability.
