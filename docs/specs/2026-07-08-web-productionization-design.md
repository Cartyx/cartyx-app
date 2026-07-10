# Web Productionization — Design (Self-Host Migration Phase 2)

**Date:** 2026-07-08
**Status:** Approved
**Roadmap:** `2026-07-07-selfhost-migration-roadmap.md` (Phase 2)
**Branch:** `web-productionization` → PR targets `dev`

## Goal

Make the TanStack Start web app runnable as a production container on the k3s
home lab: explicit environment detection (`APP_ENV`), a real `.output` server
entry, k8s-ready health endpoints, and a `Dockerfile.web` following the
patterns that shipped in Phase 1 (`realtime/Dockerfile`,
`deploy/local/compose.yaml`).

**Acceptance (roadmap):** `docker run` of the web image serves the full app
against the dev Atlas DB; the Playwright e2e suite passes against the
container.

## Decisions made during brainstorming

| Question                              | Decision                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Health endpoint shape                 | Split: `/healthz` (liveness, no I/O) + `/readyz` (readiness, Mongo ping). A DB-pinging liveness probe would restart-loop healthy pods during an Atlas blip.                                                                                                                    |
| `APP_ENV` vs existing `BOOTSTRAP_ENV` | `APP_ENV` replaces `BOOTSTRAP_ENV` entirely. One canonical var; nothing in deploy tooling sets `BOOTSTRAP_ENV` yet.                                                                                                                                                            |
| e2e against the container             | Env override (`E2E_BASE_URL`) in the existing `playwright.config.ts` + a `web` service in `deploy/local/compose.yaml`. Also runtime-tests the compose realtime path for the first time (Phase 1 carry-forward).                                                                |
| Feature flags                         | Pull the Phase 3 simplification forward: `VITE_PUBLIC_FF_*` become plain booleans; drop the PostHog flag-name indirection for the optional-flag hooks. Container e2e becomes hermetic.                                                                                         |
| Route mechanism for health endpoints  | Nitro server routes (`server/routes/*.ts`) — served before the TanStack router, leaner per-probe. Discovery alongside `tanstackStart({ srcDirectory: 'app' })` is unverified on Nitro 3 beta → spike task #1; fallback is TanStack Start server routes with the same handlers. |

## 1. Environment model: `APP_ENV`

One canonical server-side variable: `APP_ENV` ∈ `production | staging |
development`.

- `app/server/db/policy.ts#resolveEnvironment()` resolution order becomes:
  1. `APP_ENV` (validated against the three values)
  2. `NODE_ENV === 'production'` → `production`
  3. fallback → `development`
- `BOOTSTRAP_ENV` is removed everywhere (code, tests, the doc comment in
  `app/server/db/bootstrap.ts`). `VERCEL_ENV` / `VERCEL` references are
  deleted.
- `app/server/utils/posthog.ts#getEnvironment()` → returns
  `resolveEnvironment()`. Server events get labeled with the `APP_ENV`
  vocabulary instead of Vercel's (`preview` → `staging`).
- `app/server/utils/helpers.ts#saveUploadedFile` read-only-fs guard: when
  `CDN_URL` is unset **and** `resolveEnvironment() !== 'development'`, throw
  (fail fast) instead of writing to local disk. Same protection the `VERCEL`
  check gave, now env-driven; stays correct when Phase 3 hardens the
  container filesystem to read-only.
- `app/utils/posthog-client.ts#getClientEnvironment()`: drop the `vercel.app`
  hostname line; rename the `dev.cartyx.io` label from `preview` to `staging`
  so client and server event labels share one vocabulary.
- `.env.example`: add `APP_ENV=development`, remove Vercel-era comments.

Environment assignment: prod deploy → `production`; `dev.cartyx.io` deploy →
`staging`; local dev and the local compose container → `development`.

## 2. Health endpoints (Nitro server routes)

New top-level `server/routes/` directory (Nitro convention — handled before
the TanStack router):

- `server/routes/healthz.ts` — GET → `200 { status: 'ok' }`. No I/O. Used as
  the k8s **liveness** probe and by compose healthchecks.
- `server/routes/readyz.ts` — GET → reuses
  `app/server/functions/health.ts#healthCheck` (connect + `{ ping: 1 }`)
  wrapped in a ~2 s timeout. `200 { ok: true }` when Mongo responds,
  `503` otherwise. Used as the k8s **readiness** probe: during an Atlas blip
  the pod leaves the load balancer instead of being killed.

**Spike task #1 (before anything else is built on top):** verify that Nitro 3
beta's `server/routes/` discovery works alongside
`tanstackStart({ srcDirectory: 'app' })` in `vite.config.ts`. If it does not,
fall back to TanStack Start server routes (route files with server handlers,
no component) with identical handler logic.

## 3. Build & server entry

- Spike task #1 also verifies: `vite build` produces
  `.output/server/index.mjs` that boots and serves the app (including that
  the `traceDeps: ['mongoose', 'mongodb', 'bson']` externals land in
  `.output`), and confirms `NITRO_SHUTDOWN_TIMEOUT` graceful-shutdown
  semantics on the pinned Nitro version.
- Delete `prod-server.js` (hand-rolled static+SSR bridge over the old `dist/`
  layout) and `server.cjs` (dead — requires a `./src/server.js` that no
  longer exists).
- `package.json` `start` script becomes:
  `node --env-file-if-exists=.env .output/server/index.mjs`
  (Node 22 flag replaces prod-server.js's manual `.env` parser for local
  runs; containers get env injected at runtime instead).

## 4. Feature flags become booleans

- `app/utils/featureFlags.tsx`: `useOptionalFeatureFlag` and
  `useOptionalFeatureFlagEnabled` stop querying PostHog. Enabled ⇔ the env
  value is `'true'` or `'1'`; `isLoading` is always `false`. The
  PostHog-backed `useFeatureFlag` / `FeatureFlagGate` stay untouched until
  Phase 5.
- `.env.example`: `VITE_PUBLIC_FF_*` documented as `true`/`false`.
- **Deploy coordination (PR description must carry this):** current Vercel
  deployments hold PostHog flag _names_ in `VITE_PUBLIC_FF_*`. After this
  merges, those Vercel env vars must be set to `true` (or the desired
  boolean) or the inspector tabs disappear on the next Vercel deploy.

## 5. `Dockerfile.web` + root `.dockerignore`

Same shape as `realtime/Dockerfile`, adapted for client-baked env. Repo-root
build context.

Build stage (`node:22-alpine`):

1. `COPY package.json package-lock.json ./` and `COPY vendor ./vendor`
   (the `file:./vendor/pro-solid-svg-icons` dependency must exist before
   `npm ci`).
2. `npm ci`.
3. Copy app source (filtered by `.dockerignore`).
4. One `ARG` → `ENV` per client-baked variable: `VITE_PUBLIC_POSTHOG_KEY`,
   `VITE_PUBLIC_POSTHOG_HOST`, `VITE_PUBLIC_FF_CHAT|DICE|WIKI|NOTES|SETTINGS`,
   `VITE_PUBLIC_PARTYKIT_HOST`.
5. `RUN npm run build` → `.output`.

Runtime stage (`node:22-alpine`):

- `ENV NODE_ENV=production` and `ENV NITRO_SHUTDOWN_TIMEOUT` defaulting to
  10 seconds (spike task #1 confirms the variable's exact units and behavior
  on the pinned Nitro version and adjusts if needed).
- `COPY --from=build --chown=node:node /app/.output ./.output` — nothing else.
- `USER node`, `EXPOSE 3000`, exec-form
  `CMD ["node", "--max-old-space-size=400", ".output/server/index.mjs"]`
  (400 MB heap ≈ 80 % of the planned 512 Mi pod limit).

Notes:

- New root `.dockerignore`: `node_modules`, `.output`, `dist`, `.git`, `e2e`,
  `docs`, `deploy`, `realtime`, `party`, `.storybook`/storybook output,
  `scripts`, `tests`, `.claude`, etc. — keep the context minimal.
- No image-level `HEALTHCHECK`; probes live in compose/k8s (realtime
  pattern).
- Prod and dev are **separate image builds** with different `--build-arg`s
  (`VITE_PUBLIC_*` is baked into the client bundle). CI matrix lands in
  Phase 4.

## 6. Compose + e2e against the container

`deploy/local/compose.yaml` gains a `web` service:

- `build.context: ../..`, `build.dockerfile: Dockerfile.web`, build args
  interpolated from the repo-root `.env` (compose invoked with
  `--env-file .env` from the repo root, or equivalent).
- `env_file: ../../.env` plus explicit `APP_ENV: development`.
- Host port **3100** → container 3000 (no collision with a running
  `vite dev` on 3000).
- `depends_on: realtime: condition: service_healthy` — this finally
  runtime-tests the compose realtime path (Phase 1 carry-forward).
- Healthcheck: node-fetch one-liner against `http://localhost:3000/healthz`
  (same idiom as the realtime service).
- `VITE_PUBLIC_PARTYKIT_HOST=localhost:1999` baked at build so the browser
  connects to the compose realtime service.

Playwright wiring:

- `playwright.config.ts`: `baseURL` becomes
  `process.env.E2E_BASE_URL ?? 'http://localhost:3000'`; the `webServer`
  block is omitted when `E2E_BASE_URL` is set. `globalSetup` still runs on
  the host with `.env` + seeded Mongo — unchanged.
- New npm script `e2e:container`: compose up `--build -d` → wait for the web
  healthcheck → run Playwright with `E2E_BASE_URL=http://localhost:3100` →
  tear down.

## 7. Testing & acceptance

- **Unit (vitest):** `resolveEnvironment()` matrix over `APP_ENV` /
  `NODE_ENV` combinations; boolean parsing in `featureFlags.tsx`; the
  `helpers.ts` fail-fast guard (`CDN_URL` unset × each environment).
- **Spike-first:** task #1 (build boots, server routes discovered, shutdown
  semantics) runs before any deletion or Dockerfile work.
- **Acceptance:**
  - `docker run` of the image serves the full app against dev Atlas
    (documented one-liner).
  - `npm run e2e:container` green.
  - `/healthz` returns 200 regardless of Mongo state; `/readyz` returns 200
    with Mongo up and 503 with a broken `MONGODB_URI`.

## Out of scope (explicit)

- Helm chart for web + chart hardening — Phase 3 (the healthz/readyz split
  is designed for its probe config: liveness → `/healthz`, readiness →
  `/readyz`).
- CI image builds / ghcr push — Phase 4.
- PartyKit dependency removal, `party/` deletion — Phase 4 cutover.
- PostHog removal (`useFeatureFlag`, capture wrappers) — Phase 5.
- Manual two-browser realtime verification (chat/dice/GM-channel/map) against
  a real `.env` — stays with the human, pre-cutover.

## Risks

- **Nitro 3 beta:** server-route discovery and `NITRO_SHUTDOWN_TIMEOUT`
  behavior are version-sensitive — hence spike task #1; keep exact pins
  (existing TanStack lockstep constraint applies to
  `@tanstack/react-router` / `react-start`).
- **Vercel flag env coordination:** merging to `dev` redeploys the Vercel dev
  site with boolean flag parsing; its env vars must be updated in the same
  window (see §4).
- **Client-baked env:** one image cannot serve prod and dev; enforced by
  build args, documented in the Dockerfile header.
