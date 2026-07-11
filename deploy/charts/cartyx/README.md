# cartyx Helm chart

Deploys the Cartyx app — `web` (TanStack Start/Nitro, port 3000) and
`realtime` (ws service, port 1999) — as ONE release per environment on the
Flux-managed k3s cluster (`z440`, github.com/biozal/cartyx-infrastructure):

| Release               | Namespace      | Values file         | Hosts                                |
| --------------------- | -------------- | ------------------- | ------------------------------------ |
| `cartyx` (prod)       | `prod`         | `values-prod.yaml`  | `app.cartyx.io` / `ws.cartyx.io`     |
| `cartyx` (dev site)   | `dev`          | `values-dev.yaml`   | `dev.cartyx.io` / `dev-ws.cartyx.io` |
| `cartyx` (local kind) | `cartyx-local` | `values-local.yaml` | `localhost:3200` / `localhost:1999`  |

**How a deploy works:** merge to `dev`/`main` → `.github/workflows/deploy.yml`
builds + pushes images to ghcr.io and commits the new tags to the
`HelmRelease` files in cartyx-infrastructure → Flux reconciles within a
minute. CI never talks to the cluster; **nothing deploys from a laptop.**
Render tests: `bash deploy/charts/cartyx/tests/render-tests.sh` (also in CI).

The infra repo owns: namespaces (`dev`, `prod`), per-env TLS Certificates
(`prod-cartyx-tls` / `dev-cartyx-tls` — do NOT enable this chart's
Certificate there), the Cloudflare tunnel, and the Flux `HelmRelease` +
`GitRepository` objects that consume this chart from this repo's `dev`/`main`
branches.

## Client-baked vs server env

`VITE_PUBLIC_*` values (feature flags, the browser-facing ws host) are
compiled into the client bundle when the image is
built, from `deploy/build/web-<env>.args`. **Changing one = edit that file,
merge, let the workflow rebuild.** Server-read env (`MONGODB_URI`,
`SESSION_SECRET`, OAuth, R2, `APP_ENV`, `BASE_URL`) is live: plain values in
`values-<env>.yaml`, secrets in the `cartyx` Secret (below).

## One-time setup

1.  **App Secret** (from the box or any kubectl with cluster access — never
    in git, matching the infra repo's out-of-band pattern):

        kubectl -n prod create secret generic cartyx \
          --from-literal=sessionSecret='...' \
          --from-literal=mongodbUri='...' \
          --from-literal=googleClientSecret='...' \
          --from-literal=githubClientSecret='...' \
          --from-literal=r2AccessKeyId='...' \
          --from-literal=r2SecretAccessKey='...'

    Repeat with `-n dev` and the dev-site values (dev Mongo DB, dev OAuth
    client secrets if separate). `sessionSecret` must be ≥32 chars — the app
    refuses to boot in production/staging otherwise.

2.  **Deploy PAT**: fine-grained PAT scoped to `biozal/cartyx-infrastructure`
    only, permission Contents: read+write → this repo's Actions secret
    `INFRA_REPO_TOKEN`.
3.  **Values files**: fill in `GOOGLE_CLIENT_ID` / `GITHUB_CLIENT_ID` /
    `R2_ACCOUNT_ID` / `R2_BUCKET` / `CDN_URL` in `values-prod.yaml` +
    `values-dev.yaml` (public identifiers — committing them is fine).
4.  **OAuth redirect URIs**: register `https://app.cartyx.io/auth/callback/*`
    and `https://dev.cartyx.io/auth/callback/*` with Google/GitHub.
5.  **Infra repo PR**: merge the cartyx-infrastructure change that replaces
    the whoami placeholders with the `HelmRelease` + `GitRepository` objects.
6.  **First deploy**: merge to `dev` (or Actions → Deploy → Run workflow on
    `dev`). ⚠️ The first push creates the ghcr packages **private** — open
    github.com/biozal?tab=packages → `cartyx-web` and `cartyx-realtime` →
    settings → visibility **public** (private packages would need an
    imagePullSecret this chart deliberately doesn't carry). Flux retries on
    its interval; force it from the box with
    `flux reconcile helmrelease cartyx -n dev`.
7.  Verify dev, then merge to `main` for prod.

## Operations

- **Rotate a secret**: `kubectl -n <env> edit secret cartyx` (or delete +
  recreate), then `kubectl -n <env> rollout restart deploy/cartyx-web
deploy/cartyx-realtime` — the checksum auto-restart only covers the
  chart-managed (kind) Secret, not `existingSecret`.
- **Flip a client feature flag**: edit `deploy/build/web-<env>.args`, merge.
- **Roll back**: revert the tag-bump commit in cartyx-infrastructure (Flux
  reconciles the old tags back), or re-run Deploy from the last good commit.
- **Watch a rollout**: on the box, `flux get helmreleases -A` and
  `kubectl -n <env> get pods -w`.
- **Realtime is single-replica by design** (in-memory rooms); the chart
  refuses `replicaCount > 1` and uses a Recreate strategy (a deploy = a few
  seconds of WebSocket disconnect; clients reconnect via partysocket).

## Troubleshooting

| Symptom                                         | Cause / fix                                                                                                                                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ErrImagePull` on first install                 | ghcr package is private (fresh packages default private). Make it public — setup step 6.                                                                                                            |
| Pods stuck `ContainerCreating`                  | The `cartyx` Secret doesn't exist in that namespace yet (setup step 1) — expected Flux behavior per the infra README.                                                                               |
| HelmRelease render error `... is required`      | An image tag went missing — check the `values:` block (marker comments intact?) in the infra repo's helmrelease.yaml; the CI sed anchors on `# ci:web-tag` / `# ci:realtime-tag`.                   |
| `/healthz` from the internet returns 403        | By design (`ingress.blockHealthEndpoints`). Probe in-cluster: `kubectl -n <env> run hc --rm -i --restart=Never --image=curlimages/curl -- curl -fsS http://cartyx-web:3000/readyz`.                 |
| Health block objects rejected by the API server | Traefik v2 CRDs use `ipWhiteList` instead of `ipAllowList` (check: `kubectl -n kube-system describe deploy traefik \| grep -i image`). Edit `templates/middleware.yaml` accordingly or upgrade k3s. |
| WebSockets fail but the site loads              | Check the Cloudflare tunnel hostname routes cover `ws.` / `dev-ws.` and that cloudflared pods are Ready (`kubectl -n cloudflare get pods`); WebSockets ride the tunnel like everything else.        |
| Web pod restarts under load                     | Liveness only probes `/healthz` (no I/O) — check `kubectl top pod` for memory against the 512Mi/384Mi limits; the Node heap is capped at 400MB via the image CMD.                                   |
| Deploy green but site serves the old version    | CI can't see the cluster — check `flux get helmreleases -A` on the box; the HelmRelease may have failed upgrade (`kubectl -n <env> describe helmrelease cartyx`).                                   |
