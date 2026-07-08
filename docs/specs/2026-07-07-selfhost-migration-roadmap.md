# Self-Host Migration Roadmap (Vercel + PartyKit → k3s home lab)

> **This is the master roadmap.** Each phase gets its own detailed implementation plan when it starts.
> Phase 1's plan exists: `2026-07-07-realtime-service-plan.md`. Architecture reference: the full-system
> diagram artifact (https://claude.ai/code/artifact/cff4cb15-5032-4fc2-857a-39a774e5b185).

**Goal:** Run Cartyx (prod + dev) entirely on a single-node k3s cluster on the home-lab Linux box, keeping MongoDB Atlas and Cloudflare R2, eliminating Vercel, PartyKit, and PostHog.

**End state:** ~21 pods across `kube-system`, `cartyx-prod`, `cartyx-dev`, `platform`; three Helm releases; GitHub Actions → ghcr.io → `helm upgrade` over Tailscale; Traefik on 443 routing by hostname with a wildcard cert.

## Decisions already made (do not re-litigate)

| Decision             | Choice                                                                              | Why                                                                    |
| -------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Runtime              | Node 22 (not Bun/Deno)                                                              | mongoose vendor-guaranteed; SSR perf parity                            |
| Web build            | Nitro `node-server` preset → `.output/server/index.mjs`                             | default preset; obsoletes `prod-server.js`                             |
| PartyKit replacement | Custom Node `ws` service speaking `/parties/:party/:room`                           | partysocket client unchanged; PartyKit is not self-hostable            |
| Realtime persistence | MongoDB Atlas (replaces Durable Object storage)                                     | already have it; single-replica in-memory rooms are fine at this scale |
| k8s distro           | k3s, keep bundled Traefik + ServiceLB                                               | simplest single-node story                                             |
| TLS                  | cert-manager, DNS-01 via Cloudflare, wildcard cert                                  | works proxied or not; one cert for all hostnames                       |
| Registry             | ghcr.io (private, free)                                                             | no registry to run                                                     |
| Deploy               | GitHub Actions → `helm upgrade` over Tailscale                                      | no inbound API exposure; no GitOps controllers                         |
| Charts               | One app chart (web + realtime), two releases (prod/dev values) + one platform chart | services ship in lockstep                                              |
| Analytics            | Umami (browser tracker + server send API)                                           | 1 container + Postgres                                                 |
| Errors               | GlitchTip via Sentry SDK (DSN swap)                                                 | official Helm chart, MIT, ~0.5–1 GB                                    |
| Feature flags        | Plain booleans in Helm values (drop PostHog flags; no Unleash for now)              | flags only gate inspector tabs                                         |
| Logs                 | VictoriaLogs + Alloy                                                                | quota-free, ~87% less RAM than Loki                                    |
| Portal               | Grafana (PromQL + LogsQL + SQL datasources, unified alerting)                       | one URL, one login                                                     |

## Phases

Dependencies: 1 and 2 are code-only and can run now, in parallel with 0. 3 needs 1+2 (images to deploy). 4 needs 0+3. 5 is independent of 4 but needs 0+3's chart patterns.

### Phase 0 — Cluster bring-up (ops runbook, on the Linux box)

No repo code. Checklist:

- [ ] Install k3s stable: `curl -sfL https://get.k3s.io | INSTALL_K3S_CHANNEL=stable sh -` (keep Traefik + ServiceLB)
- [ ] Router: forward TCP 80 + 443 → the box
- [ ] Install Tailscale on the box; note the tailnet IP; restrict the k3s API (port 6443) to the Tailscale interface (`--bind-address` / firewall)
- [ ] Install cert-manager (official Helm chart)
- [ ] Cloudflare: scoped API token (Zone:Read + DNS:Edit on the zone) → k8s Secret
- [ ] ClusterIssuer (ACME + DNS-01 Cloudflare solver) + wildcard Certificate for `*.<domain>`
- [ ] DNS A records → the dedicated IP (grey-cloud the `ws.` / `ws-dev.` hostnames)
- [ ] ghcr.io pull secret (classic PAT, `read:packages`) in `cartyx-prod`, `cartyx-dev`, `platform` namespaces
- [ ] Smoke test: `kubectl apply` a hello-world Deployment + Ingress on a test hostname; confirm HTTPS works end to end

**Acceptance:** a test page serves over HTTPS on a real hostname with a valid wildcard cert.

### Phase 1 — Realtime service (replaces PartyKit) ✅ plan written

Detailed plan: `docs/specs/2026-07-07-realtime-service-plan.md`.

New `realtime/` package: Node 22 + `ws` + `jose` + `mongodb`. Ports the three parties (`main` chat/dice with Mongo-persisted 50-message history, `tabletop` relay, `tabletop_map` gated relay + authenticated POST broadcast). Speaks partysocket's `/parties/:party/:room` convention on port 1999 — zero client changes. Ends with a Dockerfile.

**Acceptance:** two browsers against local `vite dev` + `realtime dev` exchange chat/dice/tabletop events identically to PartyKit; all vitest suites green; Docker image serves `/healthz`.

### Phase 2 — Web productionization (code, can run parallel with Phase 1)

- Replace `VERCEL_ENV` detection with explicit `APP_ENV` (`production` | `staging` | `development`): `app/server/db/policy.ts`, `app/server/utils/posthog.ts`, `app/server/utils/helpers.ts` (read-only-fs guard → check `APP_ENV !== 'development'` or `CDN_URL` presence), `app/utils/posthog-client.ts` (drop `vercel.app` hostname check → use `dev.` hostname)
- Verify `vite build` → `node .output/server/index.mjs` serves the app (Nitro node-server is already the default preset)
- Delete `prod-server.js` and `server.cjs`; update `start` script to `node .output/server/index.mjs`
- Add a `/healthz` route (server route returning 200 + Mongo ping) for k8s probes
- `Dockerfile.web`: multi-stage `node:22-alpine`, copy only `.output`, `USER node`, exec-form CMD
- Set `NITRO_SHUTDOWN_TIMEOUT` + `--max-old-space-size=400` (80% of the 512Mi limit)

**Acceptance:** `docker run` of the web image serves the full app locally against the dev Atlas DB; e2e suite passes against the container.

### Phase 3 — Helm chart for the app

- `deploy/charts/cartyx/`: two Deployments (web, realtime), two Services, one Ingress (hosts: web + ws), Secret template (MONGODB*URI, SESSION_SECRET, R2 keys), configurable `VITE_PUBLIC*\*` build-time note (these are baked at image build — document that flag changes for the client need an image rebuild; server-read env is live)
- `values-prod.yaml` / `values-dev.yaml`: hostnames, image tags, memory limits (web 512Mi/384Mi, realtime 256Mi/192Mi), no CPU limits
- Feature flags: `VITE_PUBLIC_FF_*` become plain `true`/`false` in values (client-baked) — remove PostHog flag-name indirection
- Install both releases on the cluster manually first (`helm install` from laptop over Tailscale)

**Acceptance:** prod + dev sites both live on their hostnames from the box, WebSockets working through Traefik, dice rolls relay in prod.

### Phase 4 — CI/CD + cutover

- `.github/workflows/deploy.yml`: build web + realtime images → push ghcr → `tailscale/github-action` → `helm upgrade` (dev on push to `dev`, prod on push to `main`)
- Secrets as GitHub Actions secrets injected via `--set`/`--set-file`
- Cutover: point production DNS at the box, watch traffic, then retire `partykit-deploy.yml`, remove `partykit`/`y-partyserver` deps and `party/` directory, delete Vercel project
- Update CLAUDE-relevant docs: README deploy section, `.env.example`

**Acceptance:** merge to `dev` auto-deploys the dev site; merge to `main` auto-deploys prod; PartyKit and Vercel fully decommissioned.

### Phase 5 — Observability platform (replaces PostHog)

- `deploy/charts/platform/`: umbrella with dependencies — Grafana, Prometheus (kube-prometheus-stack or plain prometheus chart), VictoriaLogs (`victoria-logs-single`), Alloy, GlitchTip (official chart), Umami, shared Postgres (single StatefulSet, two databases)
- Code swaps in `app/`:
  - `captureException` → `@sentry/browser` / `@sentry/node` with GlitchTip DSN (wrappers in `app/utils/posthog-client.ts` + `app/server/utils/posthog.ts` keep their call sites; rename files in the process)
  - Event capture → Umami: browser tracker script + `POST /api/send` from the server wrapper
  - Remove `posthog-js`, `posthog-node`, `@posthog/react`
- Grafana datasources: Prometheus, VictoriaLogs, Postgres (SQL over umami/glitchtip schemas); alert routes to Discord/email
- Retention: VictoriaLogs `-retentionPeriod=90d`; Prometheus 30d

**Acceptance:** Grafana shows pod metrics, live logs, error groups, and event counts; a thrown test error appears in GlitchTip; a page view appears in Umami; PostHog packages removed.

## Risks / watch items

- **Nitro 3 is still beta** — pin exact versions (see existing TanStack lockstep constraint); test `.output` build early (Phase 2 task 1).
- **Client-baked env**: `VITE_PUBLIC_*` values are compiled into the client bundle — prod and dev need separate image builds (CI matrix), not one image with different env.
- **Single box, shared blast radius**: memory limits on dev protect prod; alerts (Phase 5) are the safety net.
- **Residential upload bandwidth**: image traffic already bypasses the box (R2/CDN); SSR pages are small — should be fine, but watch Grafana after cutover.
