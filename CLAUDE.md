# Cartyx — D&D Campaign Management

TanStack Start (React 19) web app + custom Node `ws` realtime service, self-hosted
on a single-node k3s cluster (`z440`) behind a Cloudflare Tunnel. MongoDB Atlas for
data, Cloudflare R2 + CDN for images, self-hosted observability
(GlitchTip/Umami/Grafana — see `docs/observability.md`).

## Commands

- `npm test` — unit suite (`vitest run --project unit`). NEVER run bare
  `npx vitest run`: the storybook project crashes outside CI.
- `npm run typecheck` / `npm run lint` — both must be clean (0 lint errors;
  ~24 pre-existing warnings are the baseline).
- `bash deploy/charts/cartyx/tests/render-tests.sh` — Helm chart assertions;
  REQUIRED whenever anything under `deploy/charts/` changes (also a CI job).
- `npm run e2e` — Playwright; all inspector tabs (Chat/Dice/Wiki/Notes/Settings)
  render unconditionally — the old `VITE_PUBLIC_FF_*` gating was removed.
- `deploy/charts/` is prettierignored — don't format it.

## Branching and deploys

- Every PR targets `dev`. NEVER open PRs against `main`.
- Merges auto-deploy: `dev` → dev.cartyx.io, `main` → app.cartyx.io, via
  CI → ghcr images → tag-bump commit to `biozal/cartyx-infrastructure` → Flux.
- Promotion to prod = PR `dev`→`main`, merged with `gh pr merge --merge --admin`
  (main requires a review the author can't self-give; admin merge is repo practice).
- Pipeline debugging, promotion runbook, env-var baking rules: use the
  `deploying` skill in `.claude/skills/`.

## Dependencies

- New/updated npm packages must be published ≥7 days (house rule) AND pass
  `npm run check:deps-age` (10-day cooldown). Dependabot is configured for
  weekly grouped minor/patch PRs.
- `@tanstack/react-router` and `@tanstack/react-start` are LOCKSTEP-pinned —
  bump together or the SSR build breaks. Dependabot ignores them; manual only.

## Telemetry conventions

- Client: `captureException`/`captureEvent` from `~/utils/telemetry-client`
  (errors → GlitchTip via Sentry SDK, events → Umami). Server:
  `serverCaptureException`/`serverCaptureEvent` from `~/server/utils/telemetry`.
- All wrappers are safe no-ops when their env vars are absent (local dev, CI).
  Never `await` capture calls on request-critical paths.
- Server→Umami POSTs must keep the browser-style User-Agent constant in
  `app/server/utils/telemetry.ts` — Umami's isbot filter silently discards
  bot-looking UAs (HTTP 200, event dropped).
- Platform operations (credentials, alerts, backups, gotchas): use the
  `platform-ops` skill in `.claude/skills/`.

## Environments and credentials

- TWO of everything per environment — Google/GitHub OAuth clients, GlitchTip
  DSNs, Umami website IDs. The laptop `.env` holds DEV values; never copy
  `.env` OAuth/R2/Mongo values into prod config.
- Atlas connection strings need the db name in the path (`…/cartyx?…`) or
  mongoose silently writes to `test`.
- Cluster access: `export KUBECONFIG=~/.kube/cartyx.yaml`. The `flux` CLI is
  not installed — see the `deploying` skill for the kubectl reconcile pattern.
