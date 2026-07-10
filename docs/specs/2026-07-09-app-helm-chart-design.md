# App Helm Chart + Auto-Deploy — Design (Phase 3)

**Status:** approved design, pre-implementation (rev 2: deploy leg pivoted to Flux GitOps after reviewing github.com/biozal/cartyx-infrastructure)
**Roadmap:** `2026-07-07-selfhost-migration-roadmap.md` Phase 3, plus the auto-deploy half of Phase 4 pulled forward (owner decision, 2026-07-09). Phase 4 shrinks to DNS cutover + PartyKit/Vercel teardown.

## Goal

One Helm chart (`deploy/charts/cartyx`) deploying both app services — web (TanStack Start/Nitro) and realtime (ws service) — as one release per environment (`prod` and `dev` namespaces) on the Flux-managed k3s cluster (`z440`). On merge to `dev`/`main`, CI builds and pushes images to ghcr.io and bumps the image tags in the **cartyx-infrastructure** repo; Flux reconciles within a minute. CI never talks to the cluster API; nothing runs from a laptop.

**Acceptance:** merge to `dev` auto-deploys `dev.cartyx.io` + `dev-ws.cartyx.io`; merge to `main` auto-deploys `app.cartyx.io` + `ws.cartyx.io`; WebSockets work through Cloudflare Tunnel + Traefik; dice rolls relay in prod.

## The cluster as it actually is (cartyx-infrastructure repo, cluster `z440`)

- **Flux** reconciles the infra repo: `clusters/z440/` → `infrastructure/` (namespaces `dev`/`prod`/`cloudflare`, ClusterIssuers `letsencrypt-prod`/`letsencrypt-staging`, cloudflared) → `apps/` (`dependsOn: infrastructure`).
- **Ingress path:** browser → Cloudflare edge → `cloudflared` tunnel connectors (2 replicas) → Traefik (`websecure`, validated against the Let's Encrypt cert by SNI) → the app. No router port-forwarding, no Tailscale.
- **Certificates already exist per environment** (`prod-cartyx-tls` for app+ws, `dev-cartyx-tls` for dev+dev-ws), issued by `letsencrypt-prod`, and are deliberately per-env — the infra README forbids consolidating into a wildcard. The chart must NOT issue certs on this cluster.
- **Secrets are created out-of-band with `kubectl`** on the box and referenced by name; the infra repo is public and carries none. Deploys never inject secrets.
- **Placeholder app manifests** (`apps/{dev,prod}/web.yaml`, `ws.yaml`, `ingress.yaml` running `traefik/whoami`) exist to be replaced by the real thing.
- The infra README's stated deploy flow: _"Push a new image tag to ghcr.io, update the `image:` field here, commit. Flux reconciles within a minute."_

## Decisions (settled during brainstorming — do not re-litigate)

| Decision         | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chart lineage    | Fresh `deploy/charts/cartyx` in the app repo; `deploy/charts/cartyx-realtime` deleted in the same PR                                                                                                                                                                                                                                                                                                                                  |
| Chart shape      | Flat single chart, explicit per-service templates, component-keyed values (`web:`, `realtime:`)                                                                                                                                                                                                                                                                                                                                       |
| Releases         | Flux `HelmRelease` named `cartyx` in namespace `prod` and in namespace `dev` (the infra repo's existing namespaces)                                                                                                                                                                                                                                                                                                                   |
| Hostnames        | prod: `app.cartyx.io` / `ws.cartyx.io`; dev: `dev.cartyx.io` / `dev-ws.cartyx.io` (already wired in the infra repo + Cloudflare tunnel)                                                                                                                                                                                                                                                                                               |
| Dev-site APP_ENV | `staging` (prod-like cookies/uploads/secret enforcement; distinct analytics/DB-policy label)                                                                                                                                                                                                                                                                                                                                          |
| Deploy model     | **Flux GitOps.** `HelmRelease` per env consumes the chart straight from this repo (`GitRepository` source: `dev` branch → dev, `main` → prod, `reconcileStrategy: Revision`). CI builds/pushes images, then commits the new tags to the infra repo's HelmRelease files with a fine-grained PAT. CI-driven `helm upgrade` over Tailscale was designed first and rejected on infra-repo review — CI must never hold cluster credentials |
| Registry         | ghcr.io, **public** images (repo is public; `VITE_PUBLIC_*` ships to browsers anyway) → no imagePullSecret anywhere                                                                                                                                                                                                                                                                                                                   |
| Image tags       | Immutable git-sha tags: `cartyx-web:prod-<sha>` / `cartyx-web:dev-<sha>` / `cartyx-realtime:<sha>`. Committed values files carry `tag: ""` with a `required` guard; the HelmRelease values carry the current tags (CI-bumped); `latest` never deploys                                                                                                                                                                                 |
| Secrets          | Out-of-band `kubectl create secret generic cartyx` in each of `dev`/`prod` (the infra repo's documented pattern). The chart consumes it via `secret.existingSecret: cartyx`; the chart-managed Secret template remains for the local kind path                                                                                                                                                                                        |
| TLS              | Owned by the infra repo (per-env Certificates already issued). Chart Ingress references `tls.secretName` (`prod-cartyx-tls` / `dev-cartyx-tls`); the chart's own Certificate template stays but is **disabled** in values-prod/dev                                                                                                                                                                                                    |
| Health endpoints | Traefik middleware 403s `/healthz` + `/readyz` from outside; kubelet probes hit pods directly. Toggleable, default on                                                                                                                                                                                                                                                                                                                 |
| Realtime rollout | `strategy: Recreate` (single pod, in-memory rooms; rolling update would split players across two pods)                                                                                                                                                                                                                                                                                                                                |
| Phase 0 status   | Done and beyond: k3s + Traefik + cert-manager + Flux + cloudflared live; certs issued; namespaces exist                                                                                                                                                                                                                                                                                                                               |

## Chart layout

```
deploy/charts/cartyx/
├── Chart.yaml                  # name: cartyx, version 0.1.0
├── .helmignore
├── values.yaml                 # structure + production-shaped safe defaults
├── values-prod.yaml            # app/ws hosts, APP_ENV=production, limits 512Mi/256Mi, existingSecret, cert disabled
├── values-dev.yaml             # dev/dev-ws hosts, APP_ENV=staging, limits 384Mi/192Mi, existingSecret, cert disabled
├── values-local.yaml           # kind: NodePorts, ingress+certificate+middleware disabled, chart-managed Secret
└── templates/
    ├── _helpers.tpl            # cartyx.fullname, cartyx.labels, per-component selectorLabels, cartyx.secretName
    ├── web-deployment.yaml
    ├── web-service.yaml        # ClusterIP :3000
    ├── realtime-deployment.yaml
    ├── realtime-service.yaml   # ClusterIP :1999
    ├── ingress.yaml            # ONE Ingress, two host rules (web host → web svc, ws host → realtime svc)
    ├── middleware.yaml         # traefik.io/v1alpha1 Middleware + IngressRoute blocking /healthz + /readyz externally
    ├── certificate.yaml        # cert-manager Certificate — OFF for z440 (infra repo owns certs); kept for other clusters
    └── secret.yaml             # one shared Secret — used by kind; z440 uses existingSecret
```

Resources render as `cartyx-web` / `cartyx-realtime` in both namespaces. The chart Ingress carries the infra repo's Traefik annotations (`router.entrypoints: websecure`, `router.tls: "true"`).

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
  blockHealthEndpoints: true # renders middleware.yaml (Middleware + IngressRoute)
tls:
  secretName: prod-cartyx-tls # dev: dev-cartyx-tls; issued by the infra repo
  certificate:
    enabled: false # z440 certs are infra-owned; enable + set clusterIssuer elsewhere
    clusterIssuer: '' # required when enabled
secret:
  create: true # kind path; z440 sets existingSecret instead
  existingSecret: '' # z440: 'cartyx' (created out-of-band with kubectl)
  values: # all empty in committed files; kind injects from .env
    sessionSecret: '' # required when chart-managed
    mongodbUri: '' # required when chart-managed
    googleClientSecret: ''
    githubClientSecret: ''
    r2AccessKeyId: ''
    r2SecretAccessKey: ''
    posthogKey: ''
```

`values-prod.yaml` / `values-dev.yaml` override hostnames, `APP_ENV`, `BASE_URL`, memory limits, `tls.secretName`, and set `secret.existingSecret: cartyx` + `secret.create: false`. `web.image.tag` / `realtime.image.tag` stay `""` in this repo — the **HelmRelease values in the infra repo** carry the live tags.

## Env / secret split (web pod)

| Source                   | Variables                                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| values `web.env` (plain) | `APP_ENV`, `PORT`, `BASE_URL`, `GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `CDN_URL`, `POSTHOG_HOST`, optional `SERVER_SHUTDOWN_TIMEOUT` override |
| Secret `cartyx`          | `SESSION_SECRET`, `MONGODB_URI`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `POSTHOG_KEY`                                  |
| Set by the chart itself  | `REALTIME_INTERNAL_HOST=cartyx-realtime:1999` (server-side broadcasts reach realtime in-cluster; the PR #490 carry-forward)                                                 |

Realtime pod: `PORT` plain; `SESSION_SECRET`, `MONGODB_URI` from the same Secret. Apple OAuth is omitted (optional in `.env.example`, unused; add to the Secret later if adopted). Client-side PostHog + feature flags are **not** chart values — they're baked into the image (below). On z440 the Secret named `cartyx` is created once per namespace with `kubectl create secret generic` (all seven keys) and referenced via `existingSecret`; rotation = update the Secret + `kubectl rollout restart` (or wait for the next deploy — immutable tags roll pods anyway).

Phase 1 behaviors that must not regress: `checksum/secret` pod annotation (auto-restart on secret change — meaningful for the chart-managed kind Secret), `replicaCount > 1` fail guard on realtime, `--set-string` comma/backslash escaping wherever secrets pass through helm (deploy-kind.sh).

## Probes, strategy, hardening

- **web**: liveness `GET /healthz` (no I/O) — `initialDelay 5, period 15, timeout 3, failureThreshold 3`; readiness `GET /readyz` (Mongo ping, 2s server-side bound) — `initialDelay 5, period 10, timeout 5, failureThreshold 3`. Timeout deliberately > the 2s bound so a slow Atlas moment marks unready instead of killing the pod.
- **realtime**: `/healthz` for both probes (no `/readyz` exists), same timeout/threshold tuning as Phase 1 plus `timeout 3, failureThreshold 3`.
- **Strategies**: realtime `Recreate`; web default `RollingUpdate`.
- **Container securityContext** (both): `runAsNonRoot`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`. `readOnlyRootFilesystem` deferred — Nitro/node may write `/tmp`; revisit later.
- Images already carry `--max-old-space-size=400` (web CMD) and `SERVER_SHUTDOWN_TIMEOUT=10` (seconds, srvx).

## CI/CD — `.github/workflows/deploy.yml` (app repo)

Triggers: `push` to `dev` and `main`; `workflow_dispatch` (guarded to those refs).

1. **Build & push** (hosted runner, `packages: write`):
   - `ghcr.io/biozal/cartyx-realtime:<sha7>` from `realtime/`.
   - `ghcr.io/biozal/cartyx-web:{prod|dev}-<sha7>` from `Dockerfile.web` with the env's build args from committed dotenv-format files `deploy/build/web-{prod,dev}.args` (`VITE_PUBLIC_PARTYKIT_HOST` = `ws.cartyx.io` / `dev-ws.cartyx.io`, the five `VITE_PUBLIC_FF_*` booleans, `VITE_PUBLIC_POSTHOG_KEY/HOST`). Flag flip = one-line PR + merge.
2. **Bump tags in the infra repo**: clone `biozal/cartyx-infrastructure` with a fine-grained PAT (repo secret `INFRA_REPO_TOKEN`, contents:write on that one repo), `sed` the marker-anchored tag lines in `apps/{dev|prod}/helmrelease.yaml`, commit (`deploy(dev): web dev-<sha> ...`), push. This is exactly the flow the infra README documents.
3. **Verify (bounded)**: poll `https://{host}/` until HTTP 200 with a generous timeout. Without cluster credentials CI cannot confirm the rollout picked up the new tag — it catches total breakage, not version skew; Flux (`flux get helmreleases -A`) and the site are the real check. Accepted limitation of the credential-less model.

No Tailscale, no kubeconfig, no GitHub Environments — the only deploy secret is `INFRA_REPO_TOKEN`.

**CI addition** (`ci.yml`): a `helm lint` + render-assertions job (`deploy/charts/cartyx/tests/render-tests.sh`) so a broken chart can't merge. Also fixes the e2e job's `VITE_PUBLIC_FF_*` values (PostHog-era flag names → `'true'`; they parse as disabled since #490's boolean switch).

## Companion changes in cartyx-infrastructure (separate PR, that repo)

- `apps/sources.yaml` (new): two `GitRepository` objects in `flux-system` — `cartyx-app-dev` (branch `dev`) and `cartyx-app-main` (branch `main`), both `https://github.com/biozal/cartyx-app` (public, no auth).
- `apps/dev/helmrelease.yaml` + `apps/prod/helmrelease.yaml` (new): `HelmRelease` `cartyx`, chart path `deploy/charts/cartyx` from the matching source, `reconcileStrategy: Revision`, `valuesFiles: [values.yaml, values-{dev,prod}.yaml]`, inline `values` carrying ONLY the image tags with CI marker comments (`# ci:web-tag`, `# ci:realtime-tag`).
- Delete `apps/{dev,prod}/web.yaml`, `ws.yaml`, `ingress.yaml` (whoami placeholders + static Ingress — the chart owns these now). **Keep** `certificate.yaml`.
- Update both env `kustomization.yaml`s and the README (secret table gains `cartyx` in `dev`/`prod`; deploy flow section points at the app repo's workflow).

## One-time setup runbook (documented in `deploy/charts/cartyx/README.md`)

1. Create the app Secret in each namespace (on the box or any kubectl with cluster access): `kubectl -n prod create secret generic cartyx --from-literal=sessionSecret=... --from-literal=mongodbUri=... --from-literal=googleClientSecret=... --from-literal=githubClientSecret=... --from-literal=r2AccessKeyId=... --from-literal=r2SecretAccessKey=... --from-literal=posthogKey=...` (repeat for `-n dev` with dev values).
2. Fine-grained PAT scoped to `biozal/cartyx-infrastructure` with contents read+write → app-repo secret `INFRA_REPO_TOKEN`.
3. Fill the public identifiers in `values-prod.yaml` / `values-dev.yaml` (`GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `CDN_URL`) and `VITE_PUBLIC_POSTHOG_KEY` in `deploy/build/web-*.args`.
4. Register OAuth redirect URIs for `https://app.cartyx.io` and `https://dev.cartyx.io`.
5. Merge the cartyx-infrastructure PR (HelmRelease + sources + placeholder removal).
6. First deploy: merge to `dev` (or `workflow_dispatch` on `dev`). ⚠️ ghcr packages are created **private** on first push — flip `cartyx-web` + `cartyx-realtime` to public in package settings, then let Flux retry (it re-reconciles on its interval; or `flux reconcile helmrelease cartyx -n dev` from the box).
7. Verify dev, then merge to `main` for prod.

## Local kind path

`deploy/local/deploy-kind.sh` upgrades from realtime-only to the full chart:

- Builds both images locally (web with `VITE_PUBLIC_PARTYKIT_HOST=localhost:1999` + flags `true`), `kind load`s them, installs `cartyx` with `values-local.yaml` — which uses the **chart-managed Secret** (`secret.create: true`) fed from `.env`, exercising the template z440 doesn't.
- `values-local.yaml`: ingress/certificate/middleware disabled (kind has no Traefik/cert-manager); realtime NodePort 30199 → host 1999 (unchanged); web NodePort 30320 → host **3200** (new kind-config mapping; 3000 stays for `vite dev`, 3100 for compose).
- Now **requires** `MONGODB_URI` in `.env` (web can't pass `/readyz` without Mongo) in addition to `SESSION_SECRET`; passes the OAuth/R2 values through when present.
- `deploy/local/README.md`: drop "realtime-only until Phase 3", document port 3200, note OAuth redirect-URI caveat applies to :3200 like :3100.
- Compose path untouched. kind is a pre-flight for chart changes; the real proof is the cluster.

## Retirement / cleanup (same PR)

- Delete `deploy/charts/cartyx-realtime/`.
- Update every reference: `deploy-kind.sh` (`RELEASE=cartyx`, `CHART_DIR=.../cartyx`, both images), `deploy/local/README.md` troubleshooting table.
- `partykit-deploy.yml` stays until cutover (Phase 4 teardown).

## Testing

1. `helm lint` + render assertions (all values files) — also wired into CI.
2. Template-level assertions: replica guard fires, `required` guards fire on empty tag/secret, `existingSecret` suppresses `secret.yaml`, values-prod/dev render with infra cert secret names and NO Certificate object, checksum annotation present.
3. kind end-to-end: `deploy-kind.sh up` → both pods Ready, web on :3200 serves, dice relay works against localhost realtime.
4. Real cluster: merge to `dev` → workflow green → `dev.cartyx.io` serves over TLS through the tunnel, WebSocket relay on `dev-ws.cartyx.io`, `/healthz` 403s publicly. Then `main`.
5. Existing suites stay green: `npm test`, `npm run e2e:container` (compose, unaffected).

## Out of scope (still owed, not this PR)

- DNS cutover, PartyKit/Vercel teardown, `partykit`/`y-partyserver` dep removal — Phase 4.
- Two-browser manual verification (chat/dice/GM-channel/map) before PartyKit cutover — owed to the owner.
- `addStackItem` TOCTOU fix (gmscreens.ts); `location-lightbox.spec.ts` unguarded click; eslint `ignores` missing `realtime/dist/` — separate follow-ups.
- Phase 5 observability platform.
