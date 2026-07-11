# Observability Platform (Phase 5) — Design

**Date:** 2026-07-11
**Status:** Approved
**Supersedes:** the Phase 5 section of `2026-07-07-selfhost-migration-roadmap.md` where they differ (packaging approach and metrics engine changed; intent unchanged).

## Goal

Replace PostHog (account dead; packages already removed in PR #504, wrappers left as
no-ops) with a self-hosted observability platform on the z440 k3s cluster:

- **Error tracking** — GlitchTip (Sentry-protocol)
- **Logs** — VictoriaLogs, 90-day retention
- **Pod/app metrics** — VictoriaMetrics, 30-day retention
- **Product analytics** — Umami
- **Single pane** — Grafana with dashboards and Discord alerting

Full stack ships in one phase. Feature flags are NOT part of this design — they became
plain baked `VITE_PUBLIC_FF_*` booleans in PR #490; the earlier Unleash idea is dropped.

## Decisions (from brainstorming)

| Decision       | Choice                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope          | Full stack, one phase                                                                                                                        |
| Packaging      | Per-component HelmReleases in **cartyx-infrastructure** (headlamp pattern), NOT an umbrella chart in the app repo                            |
| Metrics engine | VictoriaMetrics single (not Prometheus/kube-prometheus-stack) — Prometheus-compatible, far lighter on RAM                                    |
| Collector      | One Alloy instance ships both logs → VictoriaLogs and metrics → VictoriaMetrics                                                              |
| Exposure       | All three web surfaces public via Cloudflare Tunnel; each UI has its own login; Cloudflare Access can be layered later                       |
| Alerting       | Grafana → Discord webhook contact point                                                                                                      |
| Env separation | One platform stack serves dev + prod; separation inside tools (two GlitchTip projects, two Umami websites, namespace labels on logs/metrics) |

## Architecture

Everything lives in a new `platform` namespace, deployed by Flux from a new
`platform/` directory in cartyx-infrastructure — one file per component, each a
HelmRepository + HelmRelease with inline values (or plain manifests where a chart
adds nothing), wired into the cluster Kustomization like `infrastructure/`.

### Components (~1.7 Gi total memory budget; requests/limits on everything)

| Component          | Source                                                              | Purpose                                                                                                                                                       | Storage (k3s local-path) |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Postgres 17        | plain StatefulSet manifest, `postgres:17-alpine`                    | shared DB; init script creates `umami` + `glitchtip` databases/users                                                                                          | 10 Gi PVC                |
| GlitchTip          | official Helm chart                                                 | error ingest + UI; web + worker + bundled Redis; external Postgres                                                                                            | —                        |
| Umami              | community chart (fallback: plain Deployment if the chart fights us) | analytics ingest + UI                                                                                                                                         | —                        |
| VictoriaLogs       | `victoria-logs-single` chart, `-retentionPeriod=90d`                | log store                                                                                                                                                     | 20 Gi PVC                |
| VictoriaMetrics    | `victoria-metrics-single` chart, 30d retention                      | metrics store                                                                                                                                                 | 10 Gi PVC                |
| Alloy              | Grafana `alloy` chart                                               | single collector: pod logs → VictoriaLogs (Loki-compatible push); scrapes kubelet/cAdvisor, kube-state-metrics, app `/metrics` → VictoriaMetrics remote-write | —                        |
| kube-state-metrics | prometheus-community chart                                          | pod status/restart/OOM metrics for alerting                                                                                                                   | —                        |
| Grafana            | grafana chart                                                       | dashboards, Explore, alerting                                                                                                                                 | 2 Gi PVC                 |

Postgres is a plain manifest deliberately: the Bitnami chart is a supply-chain
liability post-Broadcom, and a StatefulSet + Service + init ConfigMap is ~100 lines
on a single-node cluster. No operator.

### Data flow

- Browsers → `glitchtip.cartyx.io` (Sentry DSN ingest) and `umami.cartyx.io/api/send` — public.
- Alloy → VictoriaLogs / VictoriaMetrics — in-cluster only.
- Grafana reads VictoriaMetrics, VictoriaLogs, and both Postgres schemas (read-only SQL datasources for event/error panels).

## Exposure

Three public hostnames through the existing Cloudflare Tunnel → Traefik path:

- `glitchtip.cartyx.io` — UI + ingest (same host, path-based)
- `umami.cartyx.io` — UI + `/script.js` + `/api/send`
- `grafana.cartyx.io` — UI only

Setup: DNS records via the Cloudflare API token (`~/.cloudflare/cartyx-token`),
hostname routes in `infrastructure/cloudflared.yaml`, one cert-manager Certificate
`platform-cartyx-tls` with the three SANs from ClusterIssuer `letsencrypt-prod`
(no shared wildcard, per infra README). Each chart's ingress enabled with its host
and that TLS secret.

## Secrets

One `platform` Secret, created out-of-band with kubectl (never in git/CI), same
convention as the app namespaces. Contents: Postgres superuser + per-DB passwords,
GlitchTip `SECRET_KEY` + database URL, Umami `APP_SECRET` + database URL, Grafana
admin password, Discord webhook URL. HelmReleases consume via
`existingSecret`/`valuesFrom`. Rotation = kubectl patch + rollout restart.

## App code changes (one PR to dev)

The no-op wrappers from PR #504 keep their exported APIs; call sites change only
import paths.

- Rename `app/utils/posthog-client.ts` → `app/utils/telemetry-client.ts` and
  `app/server/utils/posthog.ts` → `app/server/utils/telemetry.ts` (mechanical import
  update across ~60 files).
- **Client:** `captureException` → `@sentry/browser` initialized with
  `VITE_PUBLIC_GLITCHTIP_DSN`, `environment: APP_ENV`; `captureEvent` →
  `window.umami.track(name, data)`; Umami `script.js` tag (with
  `data-website-id` = `VITE_PUBLIC_UMAMI_WEBSITE_ID`) injected in `__root`.
  PostHogProvider passthrough becomes a small TelemetryProvider.
- **Server:** `captureException` → `@sentry/node` with runtime `GLITCHTIP_DSN`;
  `captureEvent` → `POST https://umami.cartyx.io/api/send` (Umami requires a
  User-Agent header). Server env is live — no rebuild to rotate.
- **No-op guarantee:** when the env vars are absent (local dev, CI), every wrapper
  stays a no-op. Same DX as today; e2e untouched.
- **Env plumbing:** the two `VITE_PUBLIC_*` values are client-baked → Dockerfile
  build args + `web-{dev,prod}.args` + CI, like the FF booleans. dev and prod get
  separate GlitchTip DSNs and Umami website IDs. Server DSN via chart values.
- Rewrite the PostHog paragraph in `app/routes/privacy.tsx` (self-hosted analytics,
  no third party).
- New deps `@sentry/browser`, `@sentry/node` must clear the npm one-week rule at
  implementation time; pin versions known to work against GlitchTip.
- Tests: unit tests for both wrappers (routing/payloads against mocks).

## Grafana content (provisioned, not hand-clicked)

- **Datasources:** VictoriaMetrics (prometheus type), VictoriaLogs (its Grafana
  plugin — must be installed/allow-listed in grafana.ini), Postgres read-only ×2
  (umami, glitchtip schemas).
- **Dashboards:** (1) cluster/pod health — CPU, memory vs limits, restarts, PVC
  usage by namespace; (2) Cartyx app health — web/realtime pods, log volume, error
  rate; (3) product — Umami pageviews/events + GlitchTip error groups via SQL.
- **Alerts** (Discord contact point, starter set): crash-looping pod; container
  memory >90% of limit; PVC >80%; log pipeline silent 15 min.

## Rollout order (each step verified before the next)

1. DNS + tunnel routes + namespace + secrets + Certificate
2. Postgres (both DBs exist)
3. VictoriaLogs + VictoriaMetrics + kube-state-metrics + Alloy (logs and metrics flowing)
4. Grafana (datasources green, Explore works)
5. GlitchTip + Umami (create 2 projects / 2 websites; note DSNs + IDs)
6. App code-swap PR → dev, verify, promote to main
7. Dashboards + alert rules, then a test alert to Discord

## Acceptance

- Grafana shows pod metrics, live logs, error groups, and event counts.
- A thrown test error (dev and prod) appears in GlitchTip.
- A page view appears in Umami.
- PostHog packages removed (done — PR #504).
- A test alert lands in Discord.

## Risks

- **GlitchTip chart quality** — least-polished chart of the set; fallback is plain
  manifests (image is well-documented).
- **VictoriaLogs Grafana plugin** — needs explicit plugin install/allow-list.
- **CSP** — if the app sets a Content-Security-Policy, `umami.cartyx.io` and the
  GlitchTip host need allow-listing (script-src / connect-src).
- **Box memory** — limits everywhere; the new dashboards watch exactly this. Dev
  namespace limits already protect prod.
- **Sentry SDK ↔ GlitchTip compat** — pin SDK versions GlitchTip documents as supported.
