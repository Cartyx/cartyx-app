---
name: platform-ops
description: Use when operating the observability platform — reading Grafana/GlitchTip/Umami credentials, testing or editing alerts, restoring a Postgres backup, adding a GlitchTip user, debugging missing logs/metrics/events, or editing anything under platform/ in cartyx-infrastructure.
---

# Platform Ops (observability stack)

Everything runs in namespace `platform` on the k3s cluster, Flux-reconciled
from the `platform/` directory of github.com/biozal/cartyx-infrastructure
(one file per component). Always: `export KUBECONFIG=~/.kube/cartyx.yaml`.
User docs: `docs/observability.md`. Ops details: infra repo README,
"Platform (observability)" section.

## Credentials

| UI                  | Login               | Password location                                 |
| ------------------- | ------------------- | ------------------------------------------------- |
| grafana.cartyx.io   | `admin`             | Secret `grafana-admin`, key `admin-password`      |
| glitchtip.cartyx.io | `alabeau@gmail.com` | Secret `platform`, key `glitchtip-admin-password` |
| umami.cartyx.io     | `admin`             | Secret `platform`, key `umami-admin-password`     |

```bash
kubectl -n platform get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d
```

Rotation nuance: Grafana's secret is chart-consumed — patch + rollout restart
rotates it. GlitchTip/Umami keys are RECORD-KEEPING only (accounts were
bootstrapped by hand); rotate in the app's UI, then patch the secret key to
match.

## Backups and restore

Nightly CronJob `postgres-backup` (03:00) dumps `umami` + `glitchtip` gzipped
to the private R2 bucket `cartyx-backups` (prefix `postgres/`), creds in
Secret `platform-backup`.

```bash
# manual backup now:
kubectl -n platform create job --from=cronjob/postgres-backup backup-now
# restore (example: glitchtip) — scale the consumer down first, then pipe the dump in:
kubectl -n platform scale deploy/glitchtip-web --replicas=0
gunzip -c glitchtip-YYYY-MM-DD.sql.gz | kubectl -n platform exec -i postgres-0 -- psql -U glitchtip -d glitchtip
kubectl -n platform scale deploy/glitchtip-web --replicas=1
```

Full restore runbook (incl. drop/recreate for a corrupted db): infra repo README.

## Alerts

Four+ provisioned Grafana rules → Discord contact point (#cartyx-alerts,
webhook in Secret `platform` key `DISCORD_WEBHOOK_URL`). Rules live in
`platform/grafana.yaml` `alerting:` block. Test delivery: Grafana UI →
Alerting → Contact points → discord → Test.

Editing rules: every rule needs `noDataState: OK` — the expressions return an
EMPTY vector when healthy; the Grafana default maps empty→NoData→permanent
DatasourceNoData spam. Datasource uids are fixed: `victoriametrics`,
`victorialogs`, `umami-db`, `glitchtip-db`.

## Debugging missing data

- **No logs/metrics at all**: `kubectl -n platform logs ds/alloy`. If the
  pipeline "reverted to defaults", someone mis-nested the config — in
  `platform/alloy.yaml` the `configMap:` block MUST stay nested under
  `alloy:`; a mis-nest is silently accepted and replaces the whole River
  pipeline with chart defaults. (Happened once.)
- **Server events missing from Umami but curl returns 200**: Umami's isbot
  filter discards bot-looking User-Agents WITHOUT an error. Server code must
  send the browser-style UA constant in `app/server/utils/telemetry.ts`.
- **LogsQL surprises**: free-text terms (`namespace:prod`) match inside other
  pods' JSON log bodies. Use exact stream selectors: `{namespace="prod"}`.
- **Grafana stuck rolling**: it's pinned to `deploymentStrategy: Recreate`
  (RWO PVC). If a rollout wedges anyway: scale to 0 then 1.

## Adding a GlitchTip user

Registration is off. In `platform/glitchtip.yaml` set
`ENABLE_USER_REGISTRATION: "True"`, commit, let Flux reconcile, register the
user, flip it back to `"False"`.

## Cluster facts

- k3s `local-path` storage enforces NO PVC quotas — declared sizes are hints.
  Store-size alerts (`store-size-vl`/`store-size-vm`) watch real usage.
- The `flux` CLI is not installed; reconcile via
  `kubectl annotate <kind> -n flux-system <name> reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite`
  (gitrepository `flux-system`, kustomization `platform`).
- Public ingest (`umami …/api/send`, GlitchTip DSN) is rate-limited at
  Cloudflare: 50 POSTs/10 s per IP to `/api/*` on either host.
