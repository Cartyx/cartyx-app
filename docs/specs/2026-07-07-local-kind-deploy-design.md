# Local kind + docker-compose deploy for the realtime service — Design

**Date:** 2026-07-07
**Status:** Approved
**Branch:** `realtime-service` (PR #489) — this is dev/test tooling for the service that PR introduces; it deploys an image built from `realtime/`, which is not yet on `dev`, so it lives on the same branch.

## Goal

Give a developer two one-command ways to run the `realtime/` WebSocket service locally against their machine's Docker Desktop, plus documentation:

1. **docker-compose** — quick path, no Kubernetes.
2. **kind (Kubernetes in Docker)** — k8s-fidelity path via a Helm chart, single-node cluster in Docker Desktop.

Scope is **realtime-only** (the web app is not dockerized until Phase 2). The Helm chart authored here is reused by the production Phase 3 work.

## Decisions (from brainstorming)

| Decision             | Choice                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Scope                | Realtime service only                                                                                                 |
| Database             | Real MongoDB Atlas via `MONGODB_URI` in the developer's `.env`, isolated to a dedicated DB name (`/cartyx_local`)     |
| Image flow (kind)    | `docker build` → `kind load docker-image` (no registry)                                                               |
| Manifests            | Helm chart now (`deploy/charts/cartyx-realtime/`), reused for production                                              |
| Cluster reachability | kind `extraPortMappings` host `1999` → NodePort `30199`, so the web app reaches `localhost:1999` with no port-forward |
| Branch               | `realtime-service` (PR #489)                                                                                          |

## Constraints

- The realtime service verifies party-token JWTs with `SESSION_SECRET`; it MUST match the value the app signs tokens with, or every connection returns 401. Both local paths source it from the repo-root `.env`.
- `MONGODB_URI` must name a dedicated database in its path (`…mongodb.net/cartyx_local`) so the service's `realtime_room_messages` collection stays out of the app's dev database. The service uses `mongo.db()` (no arg), so the DB name comes from the URI path.
- Secrets are never committed. They are injected at deploy time from `.env`.
- The developer's box may lack Docker/kind (as the authoring box does); nothing in the repo should require them at build/lint time — only at actual run time.
- Node/image details are fixed by the existing `realtime/Dockerfile` (multi-stage `node:22-alpine`, non-root, `EXPOSE 1999`, `/healthz`).

## Deliverables & file structure

```
deploy/
  charts/
    cartyx-realtime/
      Chart.yaml
      values.yaml              # production-shaped defaults
      values-local.yaml        # local overrides: tag=local, pullPolicy=Never, Service NodePort 30199
      .helmignore
      templates/
        _helpers.tpl           # name/label helpers
        deployment.yaml        # 1 replica, /healthz probes, env from Secret, resources
        service.yaml           # type from values (ClusterIP default; NodePort local)
        secret.yaml            # SESSION_SECRET + MONGODB_URI, values-driven (empty by default)
  local/
    kind-config.yaml           # 1-node cluster; extraPortMappings 1999 -> nodePort 30199
    compose.yaml               # builds realtime/, ports 1999:1999, env_file ../../.env, /healthz healthcheck
    deploy-kind.sh             # up (default) / down; build, load, helm upgrade, verify
    README.md                  # the how-to-run-locally documentation
```

### Helm chart: `deploy/charts/cartyx-realtime/`

**Responsibility:** deploy one instance of the realtime service. Single Deployment + Service + Secret. Not an umbrella; Phase 3 may compose it.

`values.yaml` (production-shaped defaults):

```yaml
replicaCount: 1
image:
  repository: cartyx-realtime
  tag: latest
  pullPolicy: IfNotPresent
service:
  type: ClusterIP
  port: 1999 # matches container EXPOSE 1999 and the client's default host
  nodePort: null # only used when type: NodePort
resources:
  requests: { cpu: 50m, memory: 128Mi }
  limits: { memory: 256Mi } # no CPU limit (avoids event-loop throttling)
env:
  PORT: '1999'
# Secret values — empty here; injected at deploy time from .env, never committed.
secret:
  sessionSecret: ''
  mongodbUri: ''
```

`values-local.yaml`:

```yaml
image:
  tag: local
  pullPolicy: Never # kind uses the side-loaded image; never try to pull
service:
  type: NodePort
  nodePort: 30199 # paired with kind-config.yaml host mapping 1999 -> 30199
```

`templates/deployment.yaml` requirements:

- 1 replica; container port 1999.
- `livenessProbe` and `readinessProbe`: HTTP GET `/healthz`, port 1999 (readiness initialDelay short, liveness slightly longer).
- `SESSION_SECRET` and `MONGODB_URI` sourced via `valueFrom.secretKeyRef` to the chart's Secret; `PORT` from `.Values.env.PORT`.
- resources from values; `securityContext` runs as non-root (image already sets `USER node`; add `runAsNonRoot: true`).

`templates/secret.yaml`:

- `Opaque` Secret with `sessionSecret` and `mongodbUri` keys, values from `.Values.secret.*`.
- `MONGODB_URI` key is omitted from the Secret only if `mongodbUri` is empty — but the Deployment always references `SESSION_SECRET` (required) and references `MONGODB_URI` optionally (the service falls back to in-memory when unset). Simplest correct behavior: always create both keys; an empty `mongodbUri` yields the in-memory fallback, which the service already handles.

`templates/service.yaml`:

- `type: .Values.service.type`; when `NodePort`, set `nodePort: .Values.service.nodePort`.

### `deploy/local/kind-config.yaml`

Single-node cluster named via the script. One `extraPortMappings` entry: `containerPort: 30199` (the NodePort) → `hostPort: 1999`, so `localhost:1999` on the host reaches the service. Protocol TCP.

### `deploy/local/compose.yaml`

- One service `realtime`, `build: { context: ../../realtime }`.
- `ports: ["1999:1999"]`.
- `env_file: ../../.env` (supplies `SESSION_SECRET`, `MONGODB_URI`).
- `environment: PORT=1999`.
- `healthcheck`: `CMD` node one-liner (or `wget`-free — the alpine image has no curl) hitting `http://localhost:1999/healthz`; use `node -e "fetch('http://localhost:1999/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`.
- `restart: unless-stopped`.

### `deploy/local/deploy-kind.sh`

POSIX-ish bash, `set -euo pipefail`. Subcommands:

- `up` (default):
  1. Preflight: `command -v docker kind kubectl helm` — fail with an install hint (point at README) if any missing. Require repo-root `.env` to exist and contain a non-empty `SESSION_SECRET`; read `SESSION_SECRET` and `MONGODB_URI` from it (without exporting the whole file).
  2. Create kind cluster `cartyx-local` with `kind-config.yaml` if `kind get clusters` doesn't list it.
  3. `docker build -t cartyx-realtime:local "$REPO_ROOT/realtime"`.
  4. `kind load docker-image cartyx-realtime:local --name cartyx-local`.
  5. `helm upgrade --install cartyx-realtime "$REPO_ROOT/deploy/charts/cartyx-realtime" -f values-local.yaml -n cartyx-local --create-namespace --set-string secret.sessionSecret="$SESSION_SECRET" --set-string secret.mongodbUri="$MONGODB_URI"`.
  6. `kubectl -n cartyx-local rollout status deploy/cartyx-realtime --timeout=90s`.
  7. Verify: curl `http://localhost:1999/healthz` (retry a few times), print success + next steps (point the web app at `localhost:1999`).
- `down`: `kind delete cluster --name cartyx-local`.

Secrets are passed via `--set-string` from the local `.env`; the script never writes them to a file.

### `deploy/local/README.md`

Sections:

1. **Overview** — the two paths and when to use each (compose = quick service; kind = manifest/probe fidelity).
2. **Prerequisites** — Docker Desktop (with Kubernetes not required — kind provides its own), and `brew install kind kubectl helm`. Version note.
3. **Environment** — `SESSION_SECRET` MUST equal the app's; how to confirm. `MONGODB_URI` with the `/cartyx_local` dedicated-DB recommendation and why (Atlas isolation).
4. **Path A — docker-compose**: `docker compose -f deploy/local/compose.yaml up --build`; verify `/healthz`; stop.
5. **Path B — kind**: `./deploy/local/deploy-kind.sh`; what it does; verify; `./deploy/local/deploy-kind.sh down`.
6. **Connect the web app** — set `VITE_PUBLIC_PARTYKIT_HOST=localhost:1999` (already the default), `npm run dev`, do a dice roll.
7. **Verify** — `curl localhost:1999/healthz`; optional `npx wscat` with a token.
8. **Teardown** — compose down / cluster down.
9. **Troubleshooting** — 401 on every connection → `SESSION_SECRET` mismatch; `ImagePullBackOff` → ensure `pullPolicy: Never` + image was `kind load`ed; `port 1999 already in use` → stop compose before kind or vice-versa; rollout timeout → `kubectl -n cartyx-local logs deploy/cartyx-realtime`.

## Testing / verification

Infrastructure code — no unit tests. Verification that CAN run on a Docker-less box:

- `helm lint deploy/charts/cartyx-realtime` and `helm lint … -f values-local.yaml` — clean.
- `helm template … -f values-local.yaml` — renders; assert (grep) the NodePort 30199, `pullPolicy: Never`, `/healthz` probe path, and the two secret keys are present.
- `docker compose -f deploy/local/compose.yaml config` — validates compose syntax (does not build).
- `shellcheck deploy/local/deploy-kind.sh` — clean.

If `helm`/`shellcheck` are absent on the authoring box, the plan notes the exact commands and defers them, and the actual cluster/compose run is a documented human verification step (like the Dockerfile task).

## Out of scope

- Web app container / compose / chart (Phase 2 dockerizes web; then it joins compose + a chart).
- Production Helm values, ingress, cert-manager, CI deploy (Phases 3–4).
- Local Mongo container (developer chose Atlas via env).
- A local image registry (chose `kind load`).
