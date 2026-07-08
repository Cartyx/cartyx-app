# Running Cartyx Realtime Locally

Two ways to run the `realtime/` WebSocket service (the PartyKit replacement) on your
machine, both against Docker Desktop:

| Path               | Use when                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| **docker-compose** | You just want the service running, no Kubernetes. Fastest.                                                 |
| **kind**           | You want to test the real Kubernetes manifests, probes, and the Helm chart before they hit a real cluster. |

Both run the same image built from `realtime/Dockerfile` and both read secrets from
the repo-root `.env`.

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
- **`MONGODB_URI` (optional)** — where chat/dice history is persisted. Leave it unset
  to use in-memory history (fine for quick testing; lost on restart). If you point it
  at MongoDB Atlas, **name a dedicated database in the URI path** so it stays out of
  the app's data:
  ```
  MONGODB_URI=mongodb+srv://USER:PASS@cluster.mongodb.net/cartyx_local
  ```
  The service uses whatever database the URI names.

## Path A — docker-compose

```bash
docker compose -f deploy/local/compose.yaml up --build
```

Verify in another terminal:

```bash
curl http://localhost:1999/healthz   # -> ok
```

Stop:

```bash
docker compose -f deploy/local/compose.yaml down
```

## Path B — kind

```bash
./deploy/local/deploy-kind.sh          # up (default)
```

This creates a single-node kind cluster `cartyx-local` (mapping host port `1999` to
the service's NodePort `30199`), builds the image, loads it into the cluster, deploys
the Helm chart with your `.env` secrets, and waits until `/healthz` answers.

Tear down (deletes the cluster):

```bash
./deploy/local/deploy-kind.sh down
```

## Connect the web app

The realtime service is reachable at `localhost:1999` in both paths, which is already
the web app's default (`VITE_PUBLIC_PARTYKIT_HOST=localhost:1999`). Just run the app:

```bash
npm run dev
```

Open a campaign session in two browser windows and do a dice roll — it should relay
between them, and chat history should return on reload (when `MONGODB_URI` is set).

## Verify

```bash
curl http://localhost:1999/healthz            # -> ok (200)
```

For an authenticated WebSocket smoke test you need a valid party token signed with the
same `SESSION_SECRET`; the easiest full check is the two-browser flow above.

## Teardown

- compose: `docker compose -f deploy/local/compose.yaml down`
- kind: `./deploy/local/deploy-kind.sh down`

## Troubleshooting

| Symptom                                              | Cause & fix                                                                                                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every connection returns `401`                       | `SESSION_SECRET` in `.env` doesn't match the app's. Make them identical and redeploy.                                                                                  |
| Pod stuck `ErrImageNeverPull`                        | kind didn't get the image. Re-run `./deploy/local/deploy-kind.sh` (it rebuilds and `kind load`s); the chart uses `pullPolicy: Never` so the image must be side-loaded. |
| `port 1999 already in use`                           | The compose path and the kind path both bind host `1999`. Stop one before starting the other (`docker compose ... down` / `deploy-kind.sh down`).                      |
| Rollout times out                                    | Inspect logs: `kubectl -n cartyx-local logs deploy/cartyx-realtime`.                                                                                                   |
| `SESSION_SECRET is empty or missing` from the script | The repo-root `.env` has no `SESSION_SECRET`. Add it (matching the app's).                                                                                             |
