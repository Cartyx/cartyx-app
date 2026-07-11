# Observability — UIs, URLs, and credentials

The self-hosted observability platform (Phase 5 of the self-host migration)
runs in the `platform` namespace on the k3s cluster. Three web UIs are exposed
through the Cloudflare Tunnel; everything else is in-cluster only.

All credential-reading commands below assume:

```bash
export KUBECONFIG=~/.kube/cartyx.yaml
```

## The three UIs

| URL                           | What it is                                | Login                                                                   |
| ----------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| <https://grafana.cartyx.io>   | Dashboards, log search, metrics, alerting | `admin` / secret `grafana-admin`                                        |
| <https://glitchtip.cartyx.io> | Error tracking (Sentry-compatible)        | `alabeau@gmail.com` / secret `platform`, key `glitchtip-admin-password` |
| <https://umami.cartyx.io>     | Product analytics (page views + events)   | `admin` / secret `platform`, key `umami-admin-password`                 |

Read a password (example — Grafana):

```bash
kubectl -n platform get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d; echo
# GlitchTip / Umami:
kubectl -n platform get secret platform -o jsonpath='{.data.glitchtip-admin-password}' | base64 -d; echo
kubectl -n platform get secret platform -o jsonpath='{.data.umami-admin-password}' | base64 -d; echo
```

If you change a password in an app's UI, patch the matching secret key so the
recorded value stays true (the GlitchTip/Umami keys are record-keeping only —
no manifest consumes them; Grafana's secret IS consumed by the chart, so for
Grafana patch the secret and restart the deployment instead).

## Grafana — the single pane

- **Dashboards** (provisioned, don't hand-edit — they reset on restart):
  _Kubernetes / Views / Global_ and _/ Pods_ (cluster + pod CPU/memory/restarts),
  and _Cartyx Product_ (Umami events + GlitchTip error groups, last 24 h, via
  SQL against the platform Postgres).
- **Logs**: Explore → datasource **VictoriaLogs**. Use exact stream selectors
  like `{namespace="prod", pod=~"cartyx-web.*"}` — free-text terms such as
  `namespace:prod` match inside other pods' JSON log bodies too.
- **Metrics**: Explore → datasource **VictoriaMetrics** (Prometheus-compatible;
  e.g. `container_memory_working_set_bytes{namespace="prod"}`).
- **Alerting**: four provisioned rules (pod crash-looping, container memory
  above 90 % of limit, disk above 80 %, log pipeline silent 15 min) route to
  the **#cartyx-alerts** Discord channel via webhook. Test it: Alerting →
  Contact points → discord → Test.

## GlitchTip — errors

- Organization `cartyx`, projects **cartyx-prod** and **cartyx-dev** — browser
  and server exceptions from each environment arrive in the matching project
  (the app's `captureException` wrappers use per-env Sentry DSNs baked at
  image build).
- Self-registration is **off**. To add a user: set
  `ENABLE_USER_REGISTRATION: "True"` in `platform/glitchtip.yaml`
  (cartyx-infrastructure), let Flux reconcile, register, flip it back.

## Umami — analytics

- Websites **cartyx-prod** (app.cartyx.io) and **cartyx-dev** (dev.cartyx.io).
- Browser events arrive via the `script.js` tag injected on React routes;
  server events arrive via the app's `serverCaptureEvent` wrapper (they show
  hostname `server`, url `/server` — filter them out of page-view analyses).
- Known gap: the static landing page at `/` (public/index.html) carries no
  tracker yet, so top-of-funnel visits to the root URL are not counted.

## Where things live

- Deployment manifests: cartyx-infrastructure repo, `platform/` directory
  (one file per component). Ops details, secret inventory, and gotchas: that
  repo's README, "Platform (observability)" section.
- App-side wrappers: `app/utils/telemetry-client.ts` (browser) and
  `app/server/utils/telemetry.ts` (server). Both are no-ops when their env
  vars are absent, so local dev and CI send nothing.
- Design and plan: `docs/specs/2026-07-11-observability-platform-design.md`
  and `…-plan.md`.
