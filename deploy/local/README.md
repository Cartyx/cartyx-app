# Running Cartyx Locally

Two ways to run the stack against Docker Desktop:

| Path               | Use when                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **docker-compose** | You want the web app + realtime service running together, no Kubernetes. Fastest.                                                                                                          |
| **kind**           | You want to test the real Kubernetes manifests, probes, and the Helm chart before they hit a real cluster. Deploys the full app chart (web + realtime) — the same manifests as production. |

The docker-compose path runs **two services**: `web` (built from the repo-root
`Dockerfile.web`, served on host port **3100**) and `realtime` (built from
`realtime/Dockerfile`, served on host port **1999**, unchanged from before). The `web`
container depends on `realtime` passing its healthcheck before it starts. The kind
path deploys the same two services from the `deploy/charts/cartyx` Helm chart: web on
host port **3200**, realtime on **1999**.

Both paths read secrets from the repo-root `.env`. For docker-compose specifically,
you must run the command from the **repo root** with `--env-file .env` so the
`VITE_PUBLIC_*` build args (feature flags, PostHog keys) interpolate into the `web`
image at build time — running it any other way, or omitting `--env-file .env`, builds
`web` with those flags unset.

`npm run e2e:container` is the scripted way to bring this stack up, run the
Playwright suite against it, and tear it down.

## Prerequisites

- **Docker Desktop**, running.
- For the kind path: `kind`, `kubectl`, `helm`:
  ```bash
  brew install kind kubectl helm
  ```

## Environment

Both paths read the repo-root `.env`. Two variables matter:

- **`SESSION_SECRET` (required)** — must be **identical** to the value the web app
  signs party tokens with. If it differs, every WebSocket connection is rejected
  with `401`. Copy it from the same `.env` the app uses.
- **`MONGODB_URI`** — required for the kind path (the web app can't pass `/readyz`
  without it) and recommended for compose. Point it at a **dedicated database in the
  URI path** so it stays out of the app's data:
  ```
  MONGODB_URI=mongodb+srv://USER:PASS@cluster.mongodb.net/cartyx_local
  ```
  The service uses whatever database the URI names.

## Path A — docker-compose

Run from the repo root:

```bash
docker compose --env-file .env -f deploy/local/compose.yaml up --build
```

Verify in another terminal:

```bash
curl http://localhost:3100/healthz   # -> {"status":"ok"}
curl http://localhost:1999/healthz   # -> ok
```

Stop:

```bash
docker compose --env-file .env -f deploy/local/compose.yaml down
```

## Path B — kind

```bash
./deploy/local/deploy-kind.sh          # up (default)
```

This creates a single-node kind cluster `cartyx-local` (host `1999` → realtime NodePort
`30199`, host `3200` → web NodePort `30320`), builds both images, loads them into the
cluster, deploys the `cartyx` Helm chart with your `.env` secrets, and waits until web
and realtime answer their health endpoints.

Tear down (deletes the cluster):

```bash
./deploy/local/deploy-kind.sh down
```

## Connect the web app

In the docker-compose path, the `web` service is already wired to the composed
`realtime` service via `localhost:1999` (the host port mapping), so no extra
configuration is needed — just open `http://localhost:3100`.

If instead you're running the web app outside of compose (e.g. `npm run dev`) against
a realtime service from either path, the realtime service is reachable at
`localhost:1999`, which is already the web app's default
(`VITE_PUBLIC_PARTYKIT_HOST=localhost:1999`):

```bash
npm run dev
```

Open a campaign session in two browser windows and do a dice roll — it should relay
between them, and chat history should return on reload (when `MONGODB_URI` is set).

## Verify

```bash
curl http://localhost:3100/healthz            # -> {"status":"ok"} (200, web, docker-compose only)
curl http://localhost:3200/healthz            # -> {"status":"ok"} (200, web, kind only)
curl http://localhost:1999/healthz            # -> ok (200, realtime, both paths)
```

For an authenticated WebSocket smoke test you need a valid party token signed with the
same `SESSION_SECRET`; the easiest full check is the two-browser flow above.

## Teardown

- compose: `docker compose --env-file .env -f deploy/local/compose.yaml down`
- kind: `./deploy/local/deploy-kind.sh down`

## Troubleshooting

| Symptom                                              | Cause & fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every connection returns `401`                       | `SESSION_SECRET` in `.env` doesn't match the app's. Make them identical and redeploy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Pod stuck `ErrImageNeverPull`                        | kind didn't get the image. Re-run `./deploy/local/deploy-kind.sh` (it rebuilds and `kind load`s); the chart uses `pullPolicy: Never` so the image must be side-loaded.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `port 1999 already in use`                           | The compose path and the kind path both bind host `1999`. Stop one before starting the other (`docker compose ... down` / `deploy-kind.sh down`).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `port 3100 already in use`                           | Another compose stack (or leftover container) is holding the port. `docker compose --env-file .env -f deploy/local/compose.yaml down` and retry.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Rollout times out                                    | Inspect logs: `kubectl -n cartyx-local logs deploy/cartyx-web` (or `deploy/cartyx-realtime`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SESSION_SECRET is empty or missing` from the script | The repo-root `.env` has no `SESSION_SECRET`. Add it (matching the app's).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `web` build args come out empty/false                | You ran compose without `--env-file .env`, or not from the repo root. `VITE_PUBLIC_*` args only interpolate when both are true.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `web` container logs show `NODE_ENV=development`     | A pre-existing repo-root `.env` still has a `NODE_ENV=development` line — compose's `env_file` injects it and overrides the image's `NODE_ENV=production`. Harmless for the local stack (`APP_ENV` is set explicitly in `environment:` and takes precedence over `NODE_ENV`), but remove the line — current `.env.example` no longer ships `NODE_ENV`.                                                                                                                                                                                                                    |
| OAuth login fails with `redirect_uri_mismatch`       | The stack serves on host **3100** (compose) or **3200** (kind), so the app requests `http://localhost:3100/auth/callback/...` (or `:3200`), but OAuth clients are typically registered for `localhost:3000` (the dev-server port). Either add the `:3100`/`:3200` redirect URI to the provider (Google allows multiple; GitHub OAuth apps allow only one), or remap for the test run with a compose override file passed as a second `-f`: `services: { web: { ports: ['3000:3000'], environment: { BASE_URL: 'http://localhost:3000' } } }` — needs host port 3000 free. |
