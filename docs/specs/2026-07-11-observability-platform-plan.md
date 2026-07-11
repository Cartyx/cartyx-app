# Observability Platform (Phase 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the self-hosted observability platform (GlitchTip, Umami, VictoriaLogs, VictoriaMetrics, Alloy, Grafana, shared Postgres) on the z440 k3s cluster and re-point the app's no-op telemetry wrappers at it.

**Architecture:** Per-component Flux HelmReleases (or plain manifests) in a new `platform/` directory of **cartyx-infrastructure**, all in one `platform` namespace; app repo gets one telemetry-swap PR. Spec: `docs/specs/2026-07-11-observability-platform-design.md`.

**Tech Stack:** Flux HelmRelease/Kustomization, Helm charts (victoria-metrics, grafana, glitchtip, prometheus-community, christianhuth), postgres:17-alpine, @sentry/browser, @sentry/node, Umami tracker.

## Global Constraints

- `export KUBECONFIG=~/.kube/cartyx.yaml` for every kubectl/flux/helm command (server https://192.168.1.130:6443).
- Infra work: clone `github.com/biozal/cartyx-infrastructure` to `~/Developer/cartyx-infrastructure` if absent; commit directly to `main` task-by-task (Flux reconciles main; the `platform` Kustomization is isolated from `apps`). Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- App work: branch `phase5-observability` (exists, contains the spec), PR targets `dev`, NEVER main.
- Secrets are created out-of-band with kubectl and NEVER committed to git.
- New npm deps must be published ≥7 days ago (`npm view <pkg> time --json`); repo cooldown also enforces via `npm run check:deps-age`.
- Memory limits on every workload. Retention: VictoriaLogs 90d, VictoriaMetrics 30d.
- App test commands: `npm test` (never bare `npx vitest run`), `npm run typecheck`, `npm run lint`, `bash deploy/charts/cartyx/tests/render-tests.sh` when the chart changes.
- Wrapper APIs that MUST keep their exact signatures (call sites depend on them):
  - client `app/utils/posthog-client.ts`: `captureException(error: unknown, additionalProperties?: Record<string, unknown>): void`, `captureEvent(event: string, properties?: Record<string, unknown>): void`, `capturePageView(url: string): void`
  - server `app/server/utils/posthog.ts`: `serverCaptureException(error: unknown, distinctId?: string, properties?: Record<string, unknown>): Promise<void>`, `serverCaptureEvent(distinctId: string, event: string, properties?: Record<string, unknown>): Promise<void>`, `shutdownPostHog(): Promise<void>`

---

### Task 1: Flux scaffolding — platform namespace + Kustomization

**Files (cartyx-infrastructure):**

- Create: `platform/kustomization.yaml`, `platform/namespace.yaml`
- Create: `clusters/z440/platform.yaml`

**Interfaces:**

- Produces: namespace `platform`; Flux Kustomization `platform` reconciling `./platform`; later tasks add resources to `platform/kustomization.yaml`.

- [ ] **Step 1: Create the manifests**

`platform/namespace.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: platform
```

`platform/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
```

`clusters/z440/platform.yaml` (mirror the shape of `clusters/z440/infrastructure.yaml` — read it first and copy its sourceRef/interval conventions):

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: platform
  namespace: flux-system
spec:
  interval: 10m
  path: ./platform
  prune: true
  sourceRef:
    kind: GitRepository
    name: flux-system
  wait: false
```

- [ ] **Step 2: Commit and push to main**

```bash
cd ~/Developer/cartyx-infrastructure && git pull
git add platform/ clusters/z440/platform.yaml
git commit -m "feat(platform): namespace + Flux Kustomization scaffold"
git push
```

- [ ] **Step 3: Verify Flux reconciles**

```bash
flux reconcile source git flux-system
flux get kustomization platform
kubectl get ns platform
```

Expected: Kustomization `platform` Ready=True; namespace exists.

### Task 2: Platform secrets (out-of-band)

**Interfaces:**

- Produces: Secret `platform/platform` with keys `postgres-password`, `umami-db-password`, `glitchtip-db-password`, `grafana-ro-password`, `umami-app-secret`, `glitchtip-secret-key`, `discord-webhook-url`, `umami-database-url`, `glitchtip-database-url`; Secret `platform/grafana-admin` with keys `admin-user`, `admin-password`.

- [ ] **Step 1: Ask the user for the Discord webhook URL** (they create it: Discord channel → Settings → Integrations → Webhooks → New Webhook → Copy URL). Do not proceed without it — use a placeholder `pending` value only if the user says to defer alerting.

- [ ] **Step 2: Create the secrets**

```bash
export KUBECONFIG=~/.kube/cartyx.yaml
PG_PW=$(openssl rand -hex 24); UMAMI_PW=$(openssl rand -hex 24); GT_PW=$(openssl rand -hex 24)
GRAFANA_RO_PW=$(openssl rand -hex 24); UMAMI_SECRET=$(openssl rand -hex 32); GT_SECRET=$(openssl rand -hex 32)
kubectl -n platform create secret generic platform \
  --from-literal=postgres-password="$PG_PW" \
  --from-literal=umami-db-password="$UMAMI_PW" \
  --from-literal=glitchtip-db-password="$GT_PW" \
  --from-literal=grafana-ro-password="$GRAFANA_RO_PW" \
  --from-literal=umami-app-secret="$UMAMI_SECRET" \
  --from-literal=glitchtip-secret-key="$GT_SECRET" \
  --from-literal=discord-webhook-url="<PASTE_FROM_USER>" \
  --from-literal=umami-database-url="postgresql://umami:${UMAMI_PW}@postgres.platform.svc:5432/umami" \
  --from-literal=glitchtip-database-url="postgres://glitchtip:${GT_PW}@postgres.platform.svc:5432/glitchtip"
kubectl -n platform create secret generic grafana-admin \
  --from-literal=admin-user=admin \
  --from-literal=admin-password="$(openssl rand -hex 16)"
```

- [ ] **Step 3: Verify and hand the Grafana password to the user**

```bash
kubectl -n platform get secret platform grafana-admin
kubectl -n platform get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d
```

Expected: both secrets exist; tell the user the Grafana admin password (or where to read it).

### Task 3: Shared Postgres

**Files (cartyx-infrastructure):**

- Create: `platform/postgres.yaml`
- Modify: `platform/kustomization.yaml` (add `- postgres.yaml`)

**Interfaces:**

- Consumes: Secret `platform` keys `postgres-password`, `umami-db-password`, `glitchtip-db-password`, `grafana-ro-password`.
- Produces: Service `postgres.platform.svc:5432`; databases `umami` (owner `umami`), `glitchtip` (owner `glitchtip`); read-only login `grafana_ro` on both.

- [ ] **Step 1: Write `platform/postgres.yaml`**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: postgres-initdb
  namespace: platform
data:
  init.sh: |
    #!/bin/bash
    set -e
    psql -v ON_ERROR_STOP=1 -U postgres <<-EOSQL
      CREATE USER umami WITH PASSWORD '$UMAMI_DB_PASSWORD';
      CREATE DATABASE umami OWNER umami;
      CREATE USER glitchtip WITH PASSWORD '$GLITCHTIP_DB_PASSWORD';
      CREATE DATABASE glitchtip OWNER glitchtip;
      CREATE USER grafana_ro WITH PASSWORD '$GRAFANA_RO_PASSWORD';
      GRANT CONNECT ON DATABASE umami TO grafana_ro;
      GRANT CONNECT ON DATABASE glitchtip TO grafana_ro;
    EOSQL
    for db in umami glitchtip; do
      psql -v ON_ERROR_STOP=1 -U postgres -d "$db" <<-EOSQL
        GRANT USAGE ON SCHEMA public TO grafana_ro;
        ALTER DEFAULT PRIVILEGES FOR ROLE $db IN SCHEMA public GRANT SELECT ON TABLES TO grafana_ro;
      EOSQL
    done
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: platform
spec:
  clusterIP: None
  selector:
    app: postgres
  ports:
    - port: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: platform
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:17-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_PASSWORD
              valueFrom: { secretKeyRef: { name: platform, key: postgres-password } }
            - name: UMAMI_DB_PASSWORD
              valueFrom: { secretKeyRef: { name: platform, key: umami-db-password } }
            - name: GLITCHTIP_DB_PASSWORD
              valueFrom: { secretKeyRef: { name: platform, key: glitchtip-db-password } }
            - name: GRAFANA_RO_PASSWORD
              valueFrom: { secretKeyRef: { name: platform, key: grafana-ro-password } }
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
            - name: initdb
              mountPath: /docker-entrypoint-initdb.d
          resources:
            requests: { cpu: 50m, memory: 128Mi }
            limits: { memory: 256Mi }
          readinessProbe:
            exec: { command: ['pg_isready', '-U', 'postgres'] }
            initialDelaySeconds: 5
            periodSeconds: 10
      volumes:
        - name: initdb
          configMap: { name: postgres-initdb }
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ['ReadWriteOnce']
        resources: { requests: { storage: 10Gi } }
```

- [ ] **Step 2: Commit, push, reconcile** (same commands as Task 1 Step 2/3; `flux reconcile kustomization platform --with-source`)

- [ ] **Step 3: Verify databases exist**

```bash
kubectl -n platform rollout status statefulset/postgres --timeout=180s
kubectl -n platform exec postgres-0 -- psql -U postgres -c '\l'
```

Expected: rows for `umami` and `glitchtip`. (initdb only runs on first boot — if you must re-run it, delete the PVC and pod.)

### Task 4: VictoriaLogs + VictoriaMetrics

**Files (cartyx-infrastructure):**

- Create: `platform/victorialogs.yaml`, `platform/victoriametrics.yaml`
- Modify: `platform/kustomization.yaml` (add both)

**Interfaces:**

- Produces: HelmRepository `victoriametrics` (reused by both); services `victorialogs-server.platform.svc:9428` and `victoriametrics-server.platform.svc:8428` (deterministic via `fullnameOverride`).

- [ ] **Step 1: Pin current chart versions**

```bash
helm repo add victoriametrics https://victoriametrics.github.io/helm-charts/ && helm repo update victoriametrics
helm search repo victoriametrics/victoria-logs-single victoriametrics/victoria-metrics-single
```

Use the versions this prints in the HelmReleases below.

- [ ] **Step 2: Write `platform/victorialogs.yaml`**

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: HelmRepository
metadata:
  name: victoriametrics
  namespace: platform
spec:
  interval: 1h
  url: https://victoriametrics.github.io/helm-charts/
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: victorialogs
  namespace: platform
spec:
  interval: 1h
  chart:
    spec:
      chart: victoria-logs-single
      version: '<PINNED>'
      sourceRef: { kind: HelmRepository, name: victoriametrics }
  values:
    server:
      fullnameOverride: victorialogs
      retentionPeriod: 90d
      persistentVolume:
        enabled: true
        size: 20Gi
      resources:
        requests: { cpu: 50m, memory: 128Mi }
        limits: { memory: 384Mi }
```

- [ ] **Step 3: Write `platform/victoriametrics.yaml`** (no second HelmRepository — reuse `victoriametrics`)

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: victoriametrics
  namespace: platform
spec:
  interval: 1h
  chart:
    spec:
      chart: victoria-metrics-single
      version: '<PINNED>'
      sourceRef: { kind: HelmRepository, name: victoriametrics }
  values:
    server:
      fullnameOverride: victoriametrics
      retentionPeriod: 1 # months; VM single takes months here — 1 month ≈ the 30d target
      persistentVolume:
        enabled: true
        size: 10Gi
      resources:
        requests: { cpu: 50m, memory: 128Mi }
        limits: { memory: 384Mi }
```

NOTE: check `helm show values` for both charts before committing — if `fullnameOverride`/`retentionPeriod` moved, adapt and record the actual service names for Tasks 5, 6, 8.

- [ ] **Step 4: Commit, push, reconcile, verify**

```bash
flux reconcile kustomization platform --with-source
kubectl -n platform get pods,svc
kubectl -n platform run curl-test --rm -i --restart=Never --image=curlimages/curl -- \
  sh -c 'curl -s victorialogs-server.platform.svc:9428/health && curl -s victoriametrics-server.platform.svc:8428/health'
```

Expected: both return `OK`.

### Task 5: kube-state-metrics + Alloy (collector)

**Files (cartyx-infrastructure):**

- Create: `platform/kube-state-metrics.yaml`, `platform/alloy.yaml`
- Modify: `platform/kustomization.yaml`

**Interfaces:**

- Consumes: VL/VM service endpoints from Task 4.
- Produces: logs flowing into VictoriaLogs; metrics (cAdvisor, kubelet, kube-state-metrics) in VictoriaMetrics.

- [ ] **Step 1: kube-state-metrics** — `platform/kube-state-metrics.yaml`:

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: HelmRepository
metadata:
  name: prometheus-community
  namespace: platform
spec:
  interval: 1h
  url: https://prometheus-community.github.io/helm-charts
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: kube-state-metrics
  namespace: platform
spec:
  interval: 1h
  chart:
    spec:
      chart: kube-state-metrics
      version: '<PINNED via helm search repo prometheus-community/kube-state-metrics>'
      sourceRef: { kind: HelmRepository, name: prometheus-community }
  values:
    fullnameOverride: kube-state-metrics
    resources:
      requests: { cpu: 20m, memory: 48Mi }
      limits: { memory: 96Mi }
```

- [ ] **Step 2: Alloy** — `platform/alloy.yaml` (HelmRepository `grafana` defined here, reused by Grafana task):

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: HelmRepository
metadata:
  name: grafana
  namespace: platform
spec:
  interval: 1h
  url: https://grafana.github.io/helm-charts
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: alloy
  namespace: platform
spec:
  interval: 1h
  chart:
    spec:
      chart: alloy
      version: '<PINNED via helm search repo grafana/alloy>'
      sourceRef: { kind: HelmRepository, name: grafana }
  values:
    alloy:
      resources:
        requests: { cpu: 50m, memory: 128Mi }
        limits: { memory: 256Mi }
      configMap:
        content: |
          logging { level = "warn" }

          // ---- logs: every pod on the node -> VictoriaLogs (Loki-compatible) ----
          discovery.kubernetes "pods" { role = "pod" }

          discovery.relabel "pod_logs" {
            targets = discovery.kubernetes.pods.targets
            rule {
              source_labels = ["__meta_kubernetes_namespace"]
              target_label  = "namespace"
            }
            rule {
              source_labels = ["__meta_kubernetes_pod_name"]
              target_label  = "pod"
            }
            rule {
              source_labels = ["__meta_kubernetes_pod_container_name"]
              target_label  = "container"
            }
          }

          loki.source.kubernetes "pods" {
            targets    = discovery.relabel.pod_logs.output
            forward_to = [loki.write.victorialogs.receiver]
          }

          loki.write "victorialogs" {
            endpoint {
              url = "http://victorialogs-server.platform.svc:9428/insert/loki/api/v1/push?_stream_fields=namespace,pod,container"
            }
          }

          // ---- metrics: kubelet + cAdvisor + kube-state-metrics -> VictoriaMetrics ----
          discovery.kubernetes "nodes" { role = "node" }

          prometheus.scrape "kubelet" {
            targets           = discovery.kubernetes.nodes.targets
            scheme            = "https"
            bearer_token_file = "/var/run/secrets/kubernetes.io/serviceaccount/token"
            tls_config { insecure_skip_verify = true }
            forward_to = [prometheus.remote_write.vm.receiver]
          }

          prometheus.scrape "cadvisor" {
            targets           = discovery.kubernetes.nodes.targets
            scheme            = "https"
            metrics_path      = "/metrics/cadvisor"
            bearer_token_file = "/var/run/secrets/kubernetes.io/serviceaccount/token"
            tls_config { insecure_skip_verify = true }
            forward_to = [prometheus.remote_write.vm.receiver]
          }

          prometheus.scrape "kube_state_metrics" {
            targets = [{ __address__ = "kube-state-metrics.platform.svc:8080" }]
            forward_to = [prometheus.remote_write.vm.receiver]
          }

          prometheus.remote_write "vm" {
            endpoint { url = "http://victoriametrics-server.platform.svc:8428/api/v1/write" }
          }
```

- [ ] **Step 3: Commit, push, reconcile, verify data flows**

```bash
flux reconcile kustomization platform --with-source
kubectl -n platform get pods
# logs landed in VL?
kubectl -n platform run curl-test --rm -i --restart=Never --image=curlimages/curl -- \
  curl -s 'http://victorialogs-server.platform.svc:9428/select/logsql/query' --data-urlencode 'query=namespace:prod' --data-urlencode 'limit=3'
# metrics landed in VM?
kubectl -n platform run curl-test2 --rm -i --restart=Never --image=curlimages/curl -- \
  curl -s 'http://victoriametrics-server.platform.svc:8428/api/v1/query?query=kube_pod_info'
```

Expected: log lines from prod pods; non-empty `kube_pod_info` result. Debug with `kubectl -n platform logs ds/alloy` if empty.

### Task 6: Public hostnames — tunnel, DNS, Certificate

**Files (cartyx-infrastructure):**

- Create: `platform/certificate.yaml`
- Modify: `platform/kustomization.yaml`

**Interfaces:**

- Produces: `grafana.cartyx.io`, `glitchtip.cartyx.io`, `umami.cartyx.io` routed edge→tunnel→Traefik; TLS secret `platform-cartyx-tls` in namespace `platform`.

- [ ] **Step 1: Tunnel public hostnames (USER ACTION — tunnel config lives in Cloudflare, `config_src: cloudflare`)**

Ask the user to open Cloudflare Zero Trust → Networks → Tunnels → `cartyx-k3s` → Public Hostname, view an existing entry (e.g. `app.cartyx.io`) and add three more copying its service + TLS settings exactly, changing only:

- Hostname: `grafana.cartyx.io` / `glitchtip.cartyx.io` / `umami.cartyx.io`
- TLS → Origin Server Name: same value as the hostname being added

(The dashboard auto-creates the proxied DNS CNAMEs.) Alternative if the user prefers API: the token at `~/.cloudflare/cartyx-token` needs `Account → Cloudflare Tunnel → Edit` added, then PUT `/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations` with the three ingress entries appended before the catch-all.

- [ ] **Step 2: Certificate** — `platform/certificate.yaml` (mirrors `apps/prod/certificate.yaml`):

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: platform-cartyx
  namespace: platform
spec:
  secretName: platform-cartyx-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - 'grafana.cartyx.io'
    - 'glitchtip.cartyx.io'
    - 'umami.cartyx.io'
```

- [ ] **Step 3: Commit, push, reconcile, verify**

```bash
flux reconcile kustomization platform --with-source
kubectl -n platform get certificate platform-cartyx   # Ready=True (may take ~1 min for ACME)
curl -s -o /dev/null -w '%{http_code}\n' https://grafana.cartyx.io/
```

Expected: certificate Ready; curl returns `404` (Traefik default — no Ingress yet). `530`/`1033` means the tunnel hostname step is wrong.

### Task 7: Grafana

**Files (cartyx-infrastructure):**

- Create: `platform/grafana.yaml`
- Modify: `platform/kustomization.yaml`

**Interfaces:**

- Consumes: HelmRepository `grafana` (Task 5), secrets (Task 2), TLS secret (Task 6), `grafana_ro` postgres login (Task 3).
- Produces: `https://grafana.cartyx.io` with 4 provisioned datasources named `VictoriaMetrics`, `VictoriaLogs`, `Umami DB`, `GlitchTip DB` (Tasks 10 reference these names).

- [ ] **Step 1: Write `platform/grafana.yaml`**

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: grafana
  namespace: platform
spec:
  interval: 1h
  chart:
    spec:
      chart: grafana
      version: '<PINNED via helm search repo grafana/grafana>'
      sourceRef: { kind: HelmRepository, name: grafana }
  values:
    fullnameOverride: grafana
    admin:
      existingSecret: grafana-admin
      userKey: admin-user
      passwordKey: admin-password
    envFromSecret: platform # exposes discord-webhook-url, grafana-ro-password etc. as env
    plugins:
      - victoriametrics-logs-datasource
    grafana.ini:
      server:
        root_url: https://grafana.cartyx.io
      plugins:
        allow_loading_unsigned_plugins: victoriametrics-logs-datasource
      analytics:
        reporting_enabled: false
    datasources:
      datasources.yaml:
        apiVersion: 1
        datasources:
          - name: VictoriaMetrics
            type: prometheus
            access: proxy
            url: http://victoriametrics-server.platform.svc:8428
            isDefault: true
          - name: VictoriaLogs
            type: victoriametrics-logs-datasource
            access: proxy
            url: http://victorialogs-server.platform.svc:9428
          - name: Umami DB
            type: postgres
            access: proxy
            url: postgres.platform.svc:5432
            database: umami
            user: grafana_ro
            secureJsonData:
              password: $grafana-ro-password
            jsonData: { sslmode: disable }
          - name: GlitchTip DB
            type: postgres
            access: proxy
            url: postgres.platform.svc:5432
            database: glitchtip
            user: grafana_ro
            secureJsonData:
              password: $grafana-ro-password
            jsonData: { sslmode: disable }
    ingress:
      enabled: true
      ingressClassName: traefik
      annotations:
        traefik.ingress.kubernetes.io/router.entrypoints: websecure
        traefik.ingress.kubernetes.io/router.tls: 'true'
      hosts: [grafana.cartyx.io]
      tls:
        - secretName: platform-cartyx-tls
          hosts: [grafana.cartyx.io]
    persistence:
      enabled: true
      size: 2Gi
    resources:
      requests: { cpu: 50m, memory: 192Mi }
      limits: { memory: 384Mi }
```

NOTE: `$grafana-ro-password` uses Grafana's file/env-var expansion — if the deployed datasource shows a literal `$...`, switch the key name to `GRAFANA_RO_PASSWORD` (env-safe) in the `platform` secret and reference `$GRAFANA_RO_PASSWORD`. Env var names with dashes don't expand — verify this during Step 2 and prefer adding an env-safe duplicate key (`kubectl -n platform patch secret platform ...`) over renaming existing keys.

- [ ] **Step 2: Commit, push, reconcile, verify**

```bash
flux reconcile kustomization platform --with-source
GRAFANA_PW=$(kubectl -n platform get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d)
curl -s -u "admin:$GRAFANA_PW" https://grafana.cartyx.io/api/health
curl -s -u "admin:$GRAFANA_PW" https://grafana.cartyx.io/api/datasources | jq -r '.[].name'
```

Expected: health `ok`; four datasource names. In the UI, Explore → VictoriaLogs shows live logs, VictoriaMetrics shows `kube_pod_info`.

### Task 8: GlitchTip

**Files (cartyx-infrastructure):**

- Create: `platform/glitchtip.yaml`
- Modify: `platform/kustomization.yaml`

**Interfaces:**

- Consumes: `glitchtip-database-url` + `glitchtip-secret-key` from Secret `platform` (via Flux `valuesFrom targetPath`), TLS secret.
- Produces: `https://glitchtip.cartyx.io`; org `cartyx`; projects `cartyx-prod` + `cartyx-dev`; their two DSNs (record them — app Tasks 10–12 need them).

- [ ] **Step 1: Add the chart repo and inspect values**

```bash
helm repo add glitchtip https://gitlab.com/api/v4/projects/16325141/packages/helm/stable && helm repo update glitchtip
helm search repo glitchtip
helm show values glitchtip/glitchtip > /tmp/glitchtip-values.txt
```

Confirm in the values file: `env.secret` map, `redis.enabled`, `postgresql.enabled`, `ingress` block. Adapt the YAML below to what the current chart actually exposes.

- [ ] **Step 2: Write `platform/glitchtip.yaml`**

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: glitchtip
  namespace: platform
spec:
  interval: 1h
  chart:
    spec:
      chart: glitchtip
      version: '<PINNED>'
      sourceRef: { kind: HelmRepository, name: glitchtip }
  valuesFrom:
    - kind: Secret
      name: platform
      valuesKey: glitchtip-database-url
      targetPath: env.secret.DATABASE_URL
    - kind: Secret
      name: platform
      valuesKey: glitchtip-secret-key
      targetPath: env.secret.SECRET_KEY
  values:
    env:
      normal:
        GLITCHTIP_DOMAIN: https://glitchtip.cartyx.io
        ENABLE_USER_REGISTRATION: 'True' # flipped to False in Step 4
        ENABLE_ORGANIZATION_CREATION: 'False'
    postgresql: { enabled: false }
    redis: { enabled: true }
    web:
      replicaCount: 1
      resources:
        requests: { cpu: 50m, memory: 256Mi }
        limits: { memory: 512Mi }
    worker:
      replicaCount: 1
      resources:
        requests: { cpu: 50m, memory: 192Mi }
        limits: { memory: 384Mi }
    ingress:
      enabled: true
      ingressClassName: traefik
      annotations:
        traefik.ingress.kubernetes.io/router.entrypoints: websecure
        traefik.ingress.kubernetes.io/router.tls: 'true'
      hosts:
        - host: glitchtip.cartyx.io
          paths: [{ path: /, pathType: Prefix }]
      tls:
        - secretName: platform-cartyx-tls
          hosts: [glitchtip.cartyx.io]
```

Also add a HelmRepository named `glitchtip` (url `https://gitlab.com/api/v4/projects/16325141/packages/helm/stable`) at the top of this file, same shape as earlier HelmRepositories.

- [ ] **Step 3: Commit, push, reconcile; sign up + create projects**

```bash
flux reconcile kustomization platform --with-source
kubectl -n platform get pods | grep glitchtip
```

Then (user or you via browser): register the first account at https://glitchtip.cartyx.io (first user = superuser), create organization `cartyx`, projects `cartyx-prod` and `cartyx-dev` (platform: JavaScript). Record both DSNs.

- [ ] **Step 4: Lock registration + smoke-test ingest**

Flip `ENABLE_USER_REGISTRATION: "False"` in `platform/glitchtip.yaml`, commit, push, reconcile. Then:

```bash
DSN="<cartyx-dev DSN>"  # https://<key>@glitchtip.cartyx.io/<project-id>
HOST=$(echo $DSN | sed 's|https://[^@]*@||; s|/.*||'); KEY=$(echo $DSN | sed 's|https://||; s|@.*||'); PID=$(echo $DSN | awk -F/ '{print $NF}')
curl -s "https://$HOST/api/$PID/store/?sentry_key=$KEY" -H 'Content-Type: application/json' \
  -d '{"message":"plan smoke test","level":"info","platform":"javascript"}'
```

Expected: JSON with an event id; the event appears in the `cartyx-dev` project UI.

### Task 9: Umami

**Files (cartyx-infrastructure):**

- Create: `platform/umami.yaml`
- Modify: `platform/kustomization.yaml`

**Interfaces:**

- Consumes: `umami-database-url`, `umami-app-secret` from Secret `platform`; TLS secret.
- Produces: `https://umami.cartyx.io`; websites `cartyx-prod` + `cartyx-dev`; their two website IDs (record them — app Tasks 10–12 need them).

- [ ] **Step 1: Try the community chart**

```bash
helm repo add christianhuth https://charts.christianhuth.de && helm repo update christianhuth
helm show values christianhuth/umami > /tmp/umami-values.txt
```

If the values map cleanly (external database URL + app secret from an existing secret, ingress block), write `platform/umami.yaml` as a HelmRelease using `valuesFrom targetPath` like Task 8. If not, use the plain manifests below (the spec pre-approves this fallback).

- [ ] **Step 2 (fallback path): plain manifests in `platform/umami.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: umami
  namespace: platform
spec:
  replicas: 1
  selector:
    matchLabels: { app: umami }
  template:
    metadata:
      labels: { app: umami }
    spec:
      containers:
        - name: umami
          image: ghcr.io/umami-software/umami:postgresql-latest
          ports: [{ containerPort: 3000 }]
          env:
            - name: DATABASE_URL
              valueFrom: { secretKeyRef: { name: platform, key: umami-database-url } }
            - name: APP_SECRET
              valueFrom: { secretKeyRef: { name: platform, key: umami-app-secret } }
          resources:
            requests: { cpu: 50m, memory: 128Mi }
            limits: { memory: 256Mi }
          readinessProbe:
            httpGet: { path: /api/heartbeat, port: 3000 }
            initialDelaySeconds: 10
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: umami
  namespace: platform
spec:
  selector: { app: umami }
  ports: [{ port: 3000 }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: umami
  namespace: platform
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    traefik.ingress.kubernetes.io/router.tls: 'true'
spec:
  ingressClassName: traefik
  tls:
    - hosts: [umami.cartyx.io]
      secretName: platform-cartyx-tls
  rules:
    - host: umami.cartyx.io
      http:
        paths:
          - path: /
            pathType: Prefix
            backend: { service: { name: umami, port: { number: 3000 } } }
```

(Pin the image to the current release tag, e.g. `postgresql-v2.x.y` — check https://github.com/umami-software/umami/releases — rather than `latest`, before committing.)

- [ ] **Step 3: Commit, push, reconcile; configure**

Login at https://umami.cartyx.io with default `admin` / `umami`, change the password immediately, then Settings → Websites → add `cartyx-prod` (domain app.cartyx.io) and `cartyx-dev` (domain dev.cartyx.io). Record both website IDs.

- [ ] **Step 4: Smoke-test ingest**

```bash
curl -s https://umami.cartyx.io/api/send -H 'Content-Type: application/json' -H 'User-Agent: Mozilla/5.0 (plan-smoke-test)' \
  -d '{"type":"event","payload":{"website":"<cartyx-dev website id>","hostname":"dev.cartyx.io","url":"/plan-smoke-test","name":"plan-smoke-test"}}'
```

Expected: HTTP 200; the event shows in the Umami dashboard for cartyx-dev.

### Task 10: App — client telemetry swap (TDD)

**Files (cartyx-app, branch `phase5-observability`):**

- Rename: `app/utils/posthog-client.ts` → `app/utils/telemetry-client.ts`; `app/providers/PostHogProvider.tsx` → `app/providers/TelemetryProvider.tsx` (then `grep -rl "utils/posthog-client\|providers/PostHogProvider" app tests | xargs sed -i ''` the import paths)
- Test: `tests/utils/telemetry-client.test.ts`

**Interfaces:**

- Produces: same three exported functions (signatures in Global Constraints) + `TelemetryProvider({children})`; reads `import.meta.env.VITE_PUBLIC_GLITCHTIP_DSN` and `VITE_PUBLIC_UMAMI_WEBSITE_ID`.

- [ ] **Step 1: Add the SDK after the age check**

```bash
npm view @sentry/browser time --json | jq -r 'to_entries | map(select(.key != "created" and .key != "modified")) | sort_by(.value) | last(.[]).key + " " + last(.[]).value'
```

Pick the newest version ≥7 days old: `npm install @sentry/browser@<version>`.

- [ ] **Step 2: Write the failing tests** (`tests/utils/telemetry-client.test.ts`)

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentryCapture = vi.fn();
vi.mock('@sentry/browser', () => ({
  init: vi.fn(),
  captureException: sentryCapture,
}));

describe('telemetry-client', () => {
  beforeEach(() => {
    vi.resetModules();
    sentryCapture.mockClear();
    (window as unknown as { umami?: unknown }).umami = { track: vi.fn() };
  });

  it('captureException forwards to Sentry with extras', async () => {
    const { captureException } = await import('~/utils/telemetry-client');
    const err = new Error('boom');
    captureException(err, { area: 'test' });
    expect(sentryCapture).toHaveBeenCalledWith(err, { extra: { area: 'test' } });
  });

  it('captureEvent forwards to umami.track', async () => {
    const { captureEvent } = await import('~/utils/telemetry-client');
    captureEvent('dice.rolled', { sides: 20 });
    const umami = (window as unknown as { umami: { track: ReturnType<typeof vi.fn> } }).umami;
    expect(umami.track).toHaveBeenCalledWith('dice.rolled', { sides: 20 });
  });

  it('captureEvent is a safe no-op when umami is absent', async () => {
    delete (window as unknown as { umami?: unknown }).umami;
    const { captureEvent } = await import('~/utils/telemetry-client');
    expect(() => captureEvent('dice.rolled')).not.toThrow();
  });
});
```

- [ ] **Step 3: Run to verify failure**: `npx vitest run --project unit tests/utils/telemetry-client.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `app/utils/telemetry-client.ts`**

```ts
import * as Sentry from '@sentry/browser';

/**
 * Telemetry wrappers: errors -> GlitchTip (Sentry protocol), events -> Umami.
 * All functions are safe no-ops when the platform env vars are absent
 * (local dev, CI) — same DX as the PostHog era.
 */
const dsn = import.meta.env.VITE_PUBLIC_GLITCHTIP_DSN as string | undefined;

let initialized = false;
export function initTelemetry(): void {
  if (initialized || !dsn) return;
  initialized = true;
  Sentry.init({ dsn, environment: import.meta.env.VITE_PUBLIC_APP_ENV ?? 'development' });
}

export function captureException(
  error: unknown,
  additionalProperties?: Record<string, unknown>
): void {
  if (!dsn) return;
  Sentry.captureException(
    error,
    additionalProperties ? { extra: additionalProperties } : undefined
  );
}

type Umami = { track: (event: string, data?: Record<string, unknown>) => void };

export function captureEvent(event: string, properties?: Record<string, unknown>): void {
  const umami = (window as Window & { umami?: Umami }).umami;
  umami?.track(event, properties);
}

export function capturePageView(_url: string): void {
  // Umami's script.js auto-tracks page views (including SPA route changes).
}
```

Check how the app exposes `APP_ENV` to the client (grep `VITE_PUBLIC_APP_ENV`; if it doesn't exist, use the existing client-visible env mechanism the codebase already has — do NOT invent a new var without wiring it in Task 12).

`app/providers/TelemetryProvider.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react';
import { initTelemetry } from '~/utils/telemetry-client';

export { captureException, captureEvent, capturePageView } from '~/utils/telemetry-client';

export function TelemetryProvider({ children }: { children: ReactNode }) {
  useEffect(() => initTelemetry(), []);
  return <>{children}</>;
}
```

Update every `PostHogProvider` reference (component usage in the provider tree + imports) to `TelemetryProvider`.

- [ ] **Step 5: Inject the Umami script in `app/routes/__root.tsx`** — add to the existing head/scripts config, gated on the env var:

```ts
// inside the head() scripts array, alongside existing entries:
...(import.meta.env.VITE_PUBLIC_UMAMI_WEBSITE_ID
  ? [{
      src: 'https://umami.cartyx.io/script.js',
      defer: true,
      'data-website-id': import.meta.env.VITE_PUBLIC_UMAMI_WEBSITE_ID as string,
    }]
  : []),
```

Match the file's existing script-entry shape exactly (read it first).

- [ ] **Step 6: Run tests + suite**: `npx vitest run --project unit tests/utils/telemetry-client.test.ts` PASS, then `npm test` + `npm run typecheck` green (the rename sed must have caught every import).

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(telemetry): client errors -> GlitchTip, events -> Umami"`

### Task 11: App — server telemetry swap (TDD)

**Files (cartyx-app):**

- Rename: `app/server/utils/posthog.ts` → `app/server/utils/telemetry.ts` (sed import paths repo-wide)
- Test: `tests/server/utils/telemetry.test.ts`

**Interfaces:**

- Produces: `serverCaptureException`, `serverCaptureEvent`, and `shutdownTelemetry` (renamed from `shutdownPostHog` — update its call sites, found via `grep -rn shutdownPostHog app`); reads `process.env.GLITCHTIP_DSN`, `process.env.UMAMI_HOST` (default `https://umami.cartyx.io`), `process.env.UMAMI_WEBSITE_ID`.

- [ ] **Step 1: Add SDK** — same age check as Task 10 for `@sentry/node`, then `npm install @sentry/node@<version>`.

- [ ] **Step 2: Failing tests** (`tests/server/utils/telemetry.test.ts`)

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentryCapture = vi.fn();
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: sentryCapture,
  flush: vi.fn().mockResolvedValue(true),
}));

describe('server telemetry', () => {
  beforeEach(() => {
    vi.resetModules();
    sentryCapture.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    process.env.GLITCHTIP_DSN = 'https://key@glitchtip.cartyx.io/1';
    process.env.UMAMI_WEBSITE_ID = 'site-1';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GLITCHTIP_DSN;
    delete process.env.UMAMI_WEBSITE_ID;
  });

  it('serverCaptureException forwards to Sentry', async () => {
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    const err = new Error('boom');
    await serverCaptureException(err, 'user-1', { fn: 'maps' });
    expect(sentryCapture).toHaveBeenCalledWith(err, {
      user: { id: 'user-1' },
      extra: { fn: 'maps' },
    });
  });

  it('serverCaptureEvent posts an Umami event', async () => {
    const { serverCaptureEvent } = await import('~/server/utils/telemetry');
    await serverCaptureEvent('user-1', 'campaign.created', { plan: 'free' });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://umami.cartyx.io/api/send');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      type: 'event',
      payload: {
        website: 'site-1',
        name: 'campaign.created',
        data: { plan: 'free', distinctId: 'user-1' },
      },
    });
    expect((init as RequestInit).headers).toMatchObject({ 'User-Agent': expect.any(String) });
  });

  it('is a no-op without env vars', async () => {
    delete process.env.GLITCHTIP_DSN;
    delete process.env.UMAMI_WEBSITE_ID;
    const { serverCaptureException, serverCaptureEvent } = await import('~/server/utils/telemetry');
    await serverCaptureException(new Error('x'));
    await serverCaptureEvent('u', 'e');
    expect(sentryCapture).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**, then **Step 4: implement** `app/server/utils/telemetry.ts`:

```ts
import * as Sentry from '@sentry/node';

/** Errors -> GlitchTip, events -> Umami. No-ops when env vars are absent. */
let initialized = false;
function ensureInit(): boolean {
  const dsn = process.env.GLITCHTIP_DSN;
  if (!dsn) return false;
  if (!initialized) {
    initialized = true;
    Sentry.init({ dsn, environment: process.env.APP_ENV ?? 'development' });
  }
  return true;
}

export async function serverCaptureException(
  error: unknown,
  distinctId?: string,
  properties?: Record<string, unknown>
): Promise<void> {
  if (!ensureInit()) return;
  Sentry.captureException(error, {
    ...(distinctId ? { user: { id: distinctId } } : {}),
    ...(properties ? { extra: properties } : {}),
  });
}

export async function serverCaptureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): Promise<void> {
  const website = process.env.UMAMI_WEBSITE_ID;
  if (!website) return;
  const host = process.env.UMAMI_HOST ?? 'https://umami.cartyx.io';
  try {
    await fetch(`${host}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'cartyx-server/1.0' },
      body: JSON.stringify({
        type: 'event',
        payload: {
          website,
          hostname: 'server',
          url: '/server',
          name: event,
          data: { ...properties, distinctId },
        },
      }),
    });
  } catch {
    // fire-and-forget: telemetry must never fail the caller
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(2000);
}
```

- [ ] **Step 5: Tests pass** (targeted file, then `npm test`, `npm run typecheck`), **Step 6: Commit**.

### Task 12: App — env plumbing, privacy copy, docs

**Files (cartyx-app):**

- Modify: `Dockerfile.web` (two new ARGs), `deploy/web-dev.args` + `deploy/web-prod.args` (or wherever the FF booleans live — `grep -rl VITE_PUBLIC_FF_ deploy .github` and mirror exactly), `.github/workflows/ci.yml` (only if it enumerates build args), `deploy/charts/cartyx/values.yaml` + `values-dev.yaml` + `values-prod.yaml` (web env: `GLITCHTIP_DSN`, `UMAMI_WEBSITE_ID`; host default lives in code), `deploy/charts/cartyx/templates/web-deployment.yaml` (only if env is template-enumerated), `.env.example`, `app/routes/privacy.tsx`, `README.md`
- Test: `bash deploy/charts/cartyx/tests/render-tests.sh` (+ update its assertions for the new env lines)

**Interfaces:**

- Consumes: DSNs (Task 8) and website IDs (Task 9). Client-baked: `VITE_PUBLIC_GLITCHTIP_DSN`, `VITE_PUBLIC_UMAMI_WEBSITE_ID` (per-env build args — dev gets cartyx-dev values, prod gets cartyx-prod values). Server runtime: `GLITCHTIP_DSN`, `UMAMI_WEBSITE_ID` via chart values.

- [ ] **Step 1:** Mirror the existing `VITE_PUBLIC_FF_*` build-arg pattern exactly for the two new client vars (Dockerfile ARG → env, per-env args files, CI wiring if any).
- [ ] **Step 2:** Add server env to chart values (all three files; plain values, not secrets — DSNs ship in the client bundle anyway) and templates if enumerated; update render-tests assertions; run render-tests → all pass.
- [ ] **Step 3:** `.env.example`: document all four vars as optional ("absent = telemetry disabled").
- [ ] **Step 4:** Rewrite the PostHog paragraph in `app/routes/privacy.tsx`: analytics and error reports now go to self-hosted Umami/GlitchTip on our own infrastructure; no data is shared with third-party analytics providers. Update the related test if it asserts on copy.
- [ ] **Step 5:** README: replace any remaining PostHog mention; add an "Observability" paragraph (what runs where + the three hostnames).
- [ ] **Step 6:** Full local gate: `npm test`, `npm run typecheck`, `npm run lint`, render-tests. Commit.

### Task 13: Ship the app PR; verify dev, promote prod

- [ ] **Step 1:** Push `phase5-observability`, open PR to `dev` (body lists the swap, env plumbing, and links the spec + plan). Wait for CI green, merge.
- [ ] **Step 2:** Watch the dev Deploy run; after Flux rolls dev, verify on https://dev.cartyx.io: page view appears in Umami `cartyx-dev`; in the browser console run `throw new Error('phase5-smoke')` — appears in GlitchTip `cartyx-dev` (Sentry's global handler catches it).
- [ ] **Step 3:** Promote dev→main (PR, `--admin` merge per repo practice), watch Deploy, verify the same two signals on https://app.cartyx.io against the `cartyx-prod` project/website.

### Task 14: Grafana dashboards + Discord alerting

**Files (cartyx-infrastructure):**

- Modify: `platform/grafana.yaml`

**Interfaces:**

- Consumes: datasource names from Task 7 (`VictoriaMetrics`, `VictoriaLogs`, `Umami DB`, `GlitchTip DB`); `discord-webhook-url` env from `envFromSecret` (verify the env name expansion caveat from Task 7 — use an env-safe key like `DISCORD_WEBHOOK_URL`).

- [ ] **Step 1: Dashboards** — add to the grafana HelmRelease values:

```yaml
dashboardProviders:
  dashboardproviders.yaml:
    apiVersion: 1
    providers:
      - name: default
        folder: ''
        type: file
        options: { path: /var/lib/grafana/dashboards/default }
dashboards:
  default:
    k8s-global:
      gnetId: 15757 # "Kubernetes / Views / Global" (dotdc)
      datasource: VictoriaMetrics
    k8s-pods:
      gnetId: 15760 # "Kubernetes / Views / Pods" (dotdc)
      datasource: VictoriaMetrics
```

Verify both IDs still exist first: `curl -s https://grafana.com/api/dashboards/15757 | jq .name` (and 15760); pick the current revision.

- [ ] **Step 2: Product dashboard** — add a third entry `cartyx-product` with inline `json` containing two panels: (a) type `stat`, datasource `Umami DB`, query `SELECT count(*) FROM website_event WHERE created_at > now() - interval '24 hours';` titled "Events (24h)"; (b) type `stat`, datasource `GlitchTip DB`, query `SELECT count(*) FROM issues_issue WHERE last_seen > now() - interval '24 hours';` titled "Active error groups (24h)". Build the JSON by creating the panels in the Grafana UI once, then Dashboard settings → JSON model → paste into values. (Verify table names against the live schemas first: `kubectl -n platform exec postgres-0 -- psql -U postgres -d umami -c '\dt'` and same for glitchtip; adjust the SQL to the actual tables.)

- [ ] **Step 3: Alerting provisioning** — add to values:

```yaml
alerting:
  contactpoints.yaml:
    apiVersion: 1
    contactPoints:
      - orgId: 1
        name: discord
        receivers:
          - uid: discord-main
            type: discord
            settings:
              url: $DISCORD_WEBHOOK_URL
  policies.yaml:
    apiVersion: 1
    policies:
      - orgId: 1
        receiver: discord
  rules.yaml:
    apiVersion: 1
    groups:
      - orgId: 1
        name: platform
        folder: Alerts
        interval: 5m
        rules:
          - uid: pod-crashloop
            title: Pod crash-looping
            condition: A
            for: 10m
            data:
              - refId: A
                relativeTimeRange: { from: 900, to: 0 }
                datasourceUid: <VictoriaMetrics datasource UID>
                model:
                  expr: increase(kube_pod_container_status_restarts_total[15m]) > 3
                  instant: true
          - uid: mem-near-limit
            title: Container memory > 90% of limit
            condition: A
            for: 15m
            data:
              - refId: A
                relativeTimeRange: { from: 900, to: 0 }
                datasourceUid: <VictoriaMetrics datasource UID>
                model:
                  expr: max by (namespace, pod, container) (container_memory_working_set_bytes) / max by (namespace, pod, container) (kube_pod_container_resource_limits{resource="memory"}) > 0.9
                  instant: true
          - uid: pvc-near-full
            title: PVC > 80% full
            condition: A
            for: 30m
            data:
              - refId: A
                relativeTimeRange: { from: 900, to: 0 }
                datasourceUid: <VictoriaMetrics datasource UID>
                model:
                  expr: kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes > 0.8
                  instant: true
          - uid: logs-silent
            title: Log pipeline silent 15m
            condition: A
            for: 0m
            data:
              - refId: A
                relativeTimeRange: { from: 900, to: 0 }
                datasourceUid: <VictoriaMetrics datasource UID>
                model:
                  expr: absent(vl_rows_ingested_total) or (sum(increase(vl_rows_ingested_total[15m])) == 0)
                  instant: true
```

Get the datasource UID with `curl -s -u "admin:$GRAFANA_PW" https://grafana.cartyx.io/api/datasources | jq -r '.[] | "\(.name) \(.uid)"'`. Set fixed UIDs on the datasources in Task 7's provisioning if you prefer deterministic values (`uid: victoriametrics` etc.) — do that and reference them here. NOTE: the VL ingestion metric name (`vl_rows_ingested_total`) must be verified against `curl victorialogs-server:9428/metrics` — VictoriaLogs exposes its own metrics; Alloy must also scrape them (add a `prometheus.scrape "victorialogs"` block with target `victorialogs-server.platform.svc:9428` to Task 5's config when wiring this alert).

- [ ] **Step 4: Commit, push, reconcile, verify** — Grafana UI shows the dashboards populated; Alerting → Contact points → discord → Test → message arrives in Discord.

### Task 15: Wrap-up

- [ ] Update `docs/specs/2026-07-07-selfhost-migration-roadmap.md`: mark Phase 5 shipped (one-line status with date, PR numbers).
- [ ] Record in the infra repo README: platform namespace overview, the three hostnames, where secrets live, GlitchTip/Umami admin bootstrap notes (registration locked, how to re-open).
- [ ] Verify the full acceptance list from the spec: Grafana pod metrics ✓ live logs ✓ error groups ✓ event counts ✓; test error in GlitchTip (dev+prod) ✓; page view in Umami ✓; PostHog packages gone ✓ (PR #504); Discord test alert ✓.
- [ ] Check box memory headroom: `kubectl top nodes && kubectl top pods -n platform` — platform total should be ≈1.7Gi or less; tighten limits if a component idles far below its request.

## Self-review notes

- Spec coverage: all spec sections map to tasks (components → 3–9; exposure → 6; secrets → 2; app changes → 10–12; Grafana content → 7/14; rollout order → task order; acceptance → 13/15).
- Chart version pins are deliberately `<PINNED via helm search …>` with the exact command — versions drift too fast to hardcode in a plan; the pin happens at execution with a printed value.
- Chart value shapes for GlitchTip/Umami/VM may drift — each such task starts with `helm show values` and says what to adapt; Umami has a full fallback manifest.
- Type consistency: wrapper signatures copied verbatim from the current no-op files; `shutdownPostHog` → `shutdownTelemetry` rename is called out with its call-site grep.
