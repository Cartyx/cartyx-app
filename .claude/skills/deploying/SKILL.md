---
name: deploying
description: Use when a merge isn't showing up on dev/app.cartyx.io, a Deploy workflow failed, you need to promote dev to production, rotate a client-baked env var, or diagnose any stage of the CI→ghcr→Flux pipeline.
---

# Deploying Cartyx

## The pipeline

Merge to `dev` or `main` fires `.github/workflows/deploy.yml`:

1. Build + push `ghcr.io/biozal/cartyx-{web,realtime}` images
   (web build args from `deploy/build/web-<env>.args`)
2. Commit new tags into `biozal/cartyx-infrastructure`
   `apps/<env>/helmrelease.yaml`, anchored on the `# ci:web-tag` /
   `# ci:realtime-tag` marker comments — never rename those
3. Flux on the cluster reconciles within ~1 min and rolls the pods

CI never holds cluster credentials; the infra-repo commit is the only handoff.

## Diagnosing "merged but site unchanged"

Work down the stages; stop at the first broken one:

```bash
gh run list --branch dev --workflow Deploy --limit 3   # did CI run/pass?
gh run view <id> --log-failed                          # which step died?
# did the tag-bump commit land?
gh api repos/biozal/cartyx-infrastructure/commits --jq '.[0].commit.message'
# cluster side (flux CLI is NOT installed — use kubectl annotate):
export KUBECONFIG=~/.kube/cartyx.yaml
kubectl annotate gitrepository -n flux-system flux-system \
  reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
kubectl -n <env> annotate helmrelease cartyx \
  reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
kubectl -n <env> get helmrelease cartyx          # Ready? chart version?
kubectl -n <env> get pods                        # image tag matches merge SHA?
kubectl -n <env> rollout status deploy/cartyx-web
```

App-repo sources reconcile via GitRepositories `cartyx-app-dev` /
`cartyx-app-main` (namespace flux-system) — annotate those to force-fetch a
just-pushed commit.

## Promotion to prod

```bash
gh pr create --base main --head dev --title "chore: promote dev → main (…)" --body "…"
gh pr merge --merge --admin <number>   # main requires a review; admin merge is repo practice
```

Then watch the main Deploy run, force the prod reconcile (pattern above with
`cartyx-app-main` + `-n prod`), and smoke: `curl -s -o /dev/null -w '%{http_code}' https://app.cartyx.io/`
plus whatever the change touched.

## Known transient failure

`unknown blob` during the ghcr image push (often right after a cross-repo
layer mount): the build is fine, the registry raced. Fix:

```bash
gh run rerun <run-id> --failed
```

## Client-baked vs runtime env

- `VITE_PUBLIC_*` values are compiled into the client bundle at IMAGE BUILD:
  they live in `deploy/build/web-{dev,prod}.args` + `Dockerfile.web` ARGs.
  Changing one = edit args file, merge, let CI rebuild. A chart-values change
  CANNOT do it.
- Server-read env (chart `values-<env>.yaml` → pod env) is live: edit values,
  merge, Flux rolls it. Secrets rotate via `kubectl patch` + rollout restart
  (the chart's `existingSecret` bypasses checksum auto-restart).

## Quick reference

| Thing                             | Where                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| Kubeconfig                        | `~/.kube/cartyx.yaml` (server 192.168.1.130:6443)                                   |
| Namespaces                        | `dev`, `prod` (app), `platform` (observability)                                     |
| Chart + render tests              | `deploy/charts/cartyx/`, `tests/render-tests.sh`                                    |
| Infra repo (Flux source of truth) | github.com/biozal/cartyx-infrastructure                                             |
| Hostnames                         | app/ws/dev/dev-ws/grafana/glitchtip/umami.cartyx.io via Cloudflare Tunnel → Traefik |
