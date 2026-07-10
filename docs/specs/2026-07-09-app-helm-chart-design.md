# App Helm Chart + Auto-Deploy — Design (Phase 3)

**Status:** approved design, pre-implementation
**Roadmap:** `2026-07-07-selfhost-migration-roadmap.md` Phase 3, plus the auto-deploy half of Phase 4 pulled forward (owner decision, 2026-07-09). Phase 4 shrinks to DNS cutover + PartyKit/Vercel teardown.

## Goal

One Helm chart (`deploy/charts/cartyx`) deploying both app services — web (TanStack Start/Nitro) and realtime (ws service) — installed as two releases (`cartyx-prod`, `cartyx-dev` namespaces) on the home-lab k3s cluster, deployed automatically by GitHub Actions on merge to `main` / `dev`. Nothing runs from a laptop.

**Acceptance:** merge to `dev` auto-deploys `dev.cartyx.io` + `dev-ws.cartyx.io`; merge to `main` auto-deploys `app.cartyx.io` + `ws.cartyx.io`; WebSockets work through Traefik; dice rolls relay in prod.

## Decisions (settled during brainstorming — do not re-litigate)

| Decision         | Choice                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chart lineage    | Fresh `deploy/charts/cartyx`; `deploy/charts/cartyx-realtime` deleted in the same PR                                                                                                                                                                                                              |
| Chart shape      | Flat single chart, explicit per-service templates, component-keyed values (`web:`, `realtime:`)                                                                                                                                                                                                   |
| Releases         | Release name `cartyx` in namespaces `cartyx-prod` and `cartyx-dev`                                                                                                                                                                                                                                |
| Hostnames        | prod: `app.cartyx.io` / `ws.cartyx.io`; dev: `dev.cartyx.io` / `dev-ws.cartyx.io`                                                                                                                                                                                                                 |
| Dev-site APP_ENV | `staging` (prod-like cookies/uploads/secret enforcement; distinct analytics/DB-policy label)                                                                                                                                                                                                      |
| Deploy bridge    | GitHub-hosted runners → ghcr.io images → `tailscale/github-action` (ephemeral key) → `helm upgrade` against the k3s API over the tailnet. The LAN/laptop path and build-on-the-box were considered and rejected (public repo makes a self-hosted runner risky; laptop installs rejected by owner) |
| Registry         | ghcr.io, **public** images (repo is public; `VITE_PUBLIC_*` ships to browsers anyway) → no imagePullSecret anywhere                                                                                                                                                                               |
| Image tags       | Immutable git-sha tags: `cartyx-web:prod-<sha>` / `cartyx-web:dev-<sha>` / `cartyx-realtime:<sha>`. Committed values files carry `tag: ""` with a `required` guard — every install states tags explicitly; `latest` never deploys                                                                 |
| Secrets          | GitHub **Environments** (`dev`, `production`), injected per-deploy via `--set-string`; chart also supports `existingSecret`                                                                                                                                                                       |
| TLS              | cert-manager `Certificate` template per release (two SANs) against the existing ClusterIssuer (name is a values knob; runbook starts with `kubectl get clusterissuer`)                                                                                                                            |
| Health endpoints | Traefik middleware 403s `/healthz` + `/readyz` from outside; kubelet probes hit pods directly. Toggleable, default on                                                                                                                                                                             |
| Realtime rollout | `strategy: Recreate` (single pod, in-memory rooms; rolling update would split players across two pods)                                                                                                                                                                                            |
| Phase 0 status   | Done: k3s up, Traefik, cert-manager + working certs, DNS records exist. Box is on the LAN; Tailscale (re)enters only as the CI deploy path                                                                                                                                                        |

## Chart layout

```
deploy/charts/cartyx/
├── Chart.yaml                  # name: cartyx, version 0.1.0
├── .helmignore
├── values.yaml                 # structure + production-shaped safe defaults
├── values-prod.yaml            # app/ws hosts, APP_ENV=production, web 512Mi / realtime 256Mi
├── values-dev.yaml             # dev/dev-ws hosts, APP_ENV=staging, web 384Mi / realtime 192Mi
├── values-local.yaml           # kind: NodePorts, ingress+certificate+middleware disabled, pullPolicy Never
└── templates/
    ├── _helpers.tpl            # cartyx.fullname, cartyx.labels, per-component selectorLabels
    ├── web-deployment.yaml
    ├── web-service.yaml        # ClusterIP :3000
    ├── realtime-deployment.yaml
    ├── realtime-service.yaml   # ClusterIP :1999
    ├── ingress.yaml            # ONE Ingress, two host rules (web host → web svc, ws host → realtime svc)
    ├── middleware.yaml         # traefik.io/v1alpha1 Middleware blocking /healthz + /readyz externally
    ├── certificate.yaml        # cert-manager Certificate covering the release's two hosts
    └── secret.yaml             # one shared Secret, skipped when existingSecret is set
```

Resources render as `cartyx-web` / `cartyx-realtime` in both namespaces.

## Values shape

```yaml
web:
  image: { repository: ghcr.io/biozal/cartyx-web, tag: '', pullPolicy: IfNotPresent }
  replicaCount: 1
  resources:
    requests: { cpu: 100m, memory: 192Mi }
    limits: { memory: 512Mi } # no CPU limits anywhere (event-loop throttling)
  env: # plain (non-secret) env as a map
    APP_ENV: production
    PORT: '3000'
    BASE_URL: https://app.cartyx.io
    # OAuth client IDs, R2_ACCOUNT_ID, R2_BUCKET, CDN_URL, POSTHOG_HOST, ...
realtime:
  image: { repository: ghcr.io/biozal/cartyx-realtime, tag: '', pullPolicy: IfNotPresent }
  replicaCount: 1 # template keeps the Phase 1 fail guard for >1
  resources:
    requests: { cpu: 50m, memory: 128Mi }
    limits: { memory: 256Mi }
  env: { PORT: '1999' }
ingress:
  enabled: true
  className: traefik
  webHost: app.cartyx.io
  wsHost: ws.cartyx.io
  blockHealthEndpoints: true # renders middleware.yaml + annotation
tls:
  secretName: cartyx-tls
  certificate:
    enabled: true
    clusterIssuer: '' # required when enabled
secret:
  create: true
  existingSecret: '' # set → secret.yaml not rendered, deployments reference this name
  values: # all empty in committed files; injected per-deploy
    sessionSecret: '' # required
    mongodbUri: '' # required
    googleClientSecret: ''
    githubClientSecret: ''
    r2AccessKeyId: ''
    r2SecretAccessKey: ''
    posthogKey: ''
```

`values-prod.yaml` / `values-dev.yaml` override hostnames, `APP_ENV`, `BASE_URL`, and memory limits only. `web.image.tag` / `realtime.image.tag` stay `""` everywhere — the deploy workflow passes `--set web.image.tag=...`.

## Env / secret split (web pod)

| Source                   | Variables                                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| values `web.env` (plain) | `APP_ENV`, `PORT`, `BASE_URL`, `GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `CDN_URL`, `POSTHOG_HOST`, optional `SERVER_SHUTDOWN_TIMEOUT` override |
| Secret `cartyx`          | `SESSION_SECRET`, `MONGODB_URI`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `POSTHOG_KEY`                                  |
| Set by the chart itself  | `REALTIME_INTERNAL_HOST=cartyx-realtime:1999` (server-side broadcasts reach realtime in-cluster; the PR #490 carry-forward)                                                 |

Realtime pod: `PORT` plain; `SESSION_SECRET`, `MONGODB_URI` from the same Secret. Apple OAuth is omitted (optional in `.env.example`, unused; add to the Secret later if adopted). Client-side PostHog + feature flags are **not** chart values — they're baked into the image (below).

Phase 1 behaviors that must not regress: `checksum/secret` pod annotation (auto-restart on secret change — chart-managed Secret only; with `existingSecret` the workflow's immutable image tags force rollouts anyway), `replicaCount > 1` fail guard on realtime, `--set-string` comma/backslash escaping wherever secrets pass through helm.

## Probes, strategy, hardening

- **web**: liveness `GET /healthz` (no I/O) — `initialDelay 5, period 15, timeout 3, failureThreshold 3`; readiness `GET /readyz` (Mongo ping, 2s server-side bound) — `initialDelay 5, period 10, timeout 5, failureThreshold 3`. Timeout deliberately > the 2s bound so a slow Atlas moment marks unready instead of killing the pod.
- **realtime**: `/healthz` for both probes (no `/readyz` exists), same timeout/threshold tuning as Phase 1 plus `timeout 3, failureThreshold 3`.
- **Strategies**: realtime `Recreate`; web default `RollingUpdate`.
- **Container securityContext** (both): `runAsNonRoot`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`. `readOnlyRootFilesystem` deferred — Nitro/node may write `/tmp`; revisit later.
- Images already carry `--max-old-space-size=400` (web CMD) and `SERVER_SHUTDOWN_TIMEOUT=10` (seconds, srvx).

## CI/CD — `.github/workflows/deploy.yml`

Triggers: `push` to `dev` and `main`; `workflow_dispatch` (manual runs — including the very first install; `--create-namespace` handles bootstrap).

Per run (environment = `dev` for dev branch, `production` for main):

1. **Build & push** (hosted runner, `docker/build-push-action` or plain docker):
   - `ghcr.io/biozal/cartyx-realtime:<sha>` from `realtime/`.
   - `ghcr.io/biozal/cartyx-web:{prod|dev}-<sha>` from `Dockerfile.web` with the env's build args. Build args live in two committed dotenv-format files — `deploy/build/web-prod.args`, `deploy/build/web-dev.args` — holding `VITE_PUBLIC_PARTYKIT_HOST` (`ws.cartyx.io` / `dev-ws.cartyx.io`), the five `VITE_PUBLIC_FF_*` booleans, and `VITE_PUBLIC_POSTHOG_KEY/HOST`. Flag flip = one-line PR + redeploy. Values files comment-point here so nobody hunts for flags in Helm values.
   - Push with `GITHUB_TOKEN` (`packages: write`); images public.
2. **Connect**: `tailscale/github-action` with an ephemeral, tagged auth key (GitHub secret); kubeconfig (tailnet IP endpoint) from a GitHub secret.
3. **Deploy**: `helm upgrade --install cartyx deploy/charts/cartyx -n cartyx-{prod|dev} --create-namespace -f values-{prod|dev}.yaml --set web.image.tag=... --set realtime.image.tag=... --set tls.certificate.clusterIssuer=... --set-string secret.values.*=<env secrets>` (with the comma/backslash escaping).
4. **Verify**: `kubectl rollout status` both deployments, then hit `/healthz` in-cluster (`kubectl run --rm` curl one-shot or port-forward — the Traefik middleware 403s health paths at the ingress no matter the source) and curl the public site root for a 200 — fail the run loudly if not green.

GitHub Environment secrets (each of `dev`, `production`): `MONGODB_URI`, `SESSION_SECRET`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `POSTHOG_KEY`. Repo-level secrets: `TS_AUTHKEY` (or OAuth client pair), `KUBECONFIG_B64`. Non-secret per-env config lives in the values files, not GitHub.

**CI addition** (`ci.yml`): a cheap `helm lint deploy/charts/cartyx` + `helm template` render (prod + dev + local values, dummy required values) so a broken chart can't merge.

## One-time setup runbook (documented in `deploy/charts/cartyx/README.md`)

1. Box: install Tailscale, join tailnet, note the tailnet IP.
2. Box: make the k3s API reachable on the tailnet interface (and NOT on the public IP).
3. Build a CI kubeconfig whose server endpoint is the tailnet IP; base64 → `KUBECONFIG_B64` repo secret.
4. Tailnet: create the ephemeral CI auth key (tagged) → `TS_AUTHKEY` repo secret.
5. GitHub: create `dev` + `production` Environments; fill the seven secrets each; optionally add a required-reviewer protection rule on `production`.
6. `kubectl get clusterissuer` → set the name in both values files.
7. First deploy: run `workflow_dispatch` on `dev`, verify, then on `main`.

## Local kind path

`deploy/local/deploy-kind.sh` upgrades from realtime-only to the full chart:

- Builds both images locally (web using `deploy/build/web-dev.args` semantics but `VITE_PUBLIC_PARTYKIT_HOST=localhost:1999`), `kind load`s them, installs `cartyx` with `values-local.yaml`.
- `values-local.yaml`: ingress/certificate/middleware disabled (kind has no Traefik/cert-manager); realtime NodePort 30199 → host 1999 (unchanged); web NodePort 30320 → host **3200** (new kind-config mapping; 3000 stays for `vite dev`, 3100 for compose).
- Now **requires** `MONGODB_URI` in `.env` (web can't pass `/readyz` without Mongo) in addition to `SESSION_SECRET`; passes the OAuth/R2 values through when present.
- `deploy/local/README.md`: drop "realtime-only until Phase 3", document port 3200, note OAuth redirect-URI caveat applies to :3200 like :3100.
- Compose path untouched. kind is a pre-flight for chart changes; the real proof is the cluster.

## Retirement / cleanup (same PR)

- Delete `deploy/charts/cartyx-realtime/`.
- Update every reference: `deploy-kind.sh` (`RELEASE=cartyx`, `CHART_DIR=.../cartyx`, both images), `deploy/local/README.md` troubleshooting table (`kubectl -n cartyx-local logs deploy/cartyx-realtime` still valid as a deployment name; re-check each row).
- `partykit-deploy.yml` stays until cutover (Phase 4 teardown).

## Testing

1. `helm lint` + `helm template` (all three values files) — also wired into CI.
2. Template-level assertions worth eyeballing in review: replica guard fires, `required` guards fire on empty tag/secret/issuer, checksum annotation changes when a secret value changes, `existingSecret` suppresses `secret.yaml`.
3. kind end-to-end: `deploy-kind.sh up` → both pods Ready, web on :3200 serves, dice relay works against localhost realtime.
4. Real cluster via `workflow_dispatch`: dev first (site live, WebSocket relay on `dev-ws.cartyx.io`, `/healthz` 403s from the public internet), then prod.
5. Existing suites stay green: `npm test`, `npm run e2e:container` (compose, unaffected).

## Out of scope (still owed, not this PR)

- DNS cutover, PartyKit/Vercel teardown, `partykit`/`y-partyserver` dep removal — Phase 4.
- Two-browser manual verification (chat/dice/GM-channel/map) before PartyKit cutover — owed to the owner.
- `addStackItem` TOCTOU fix (gmscreens.ts); `location-lightbox.spec.ts` unguarded click; eslint `ignores` missing `realtime/dist/` — separate follow-ups.
- Phase 5 observability platform.
