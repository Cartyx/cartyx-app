# Structured logging and lint-warning cleanup — design

Date: 2026-07-16
Branch: `fix-warnings` → single PR into `dev`

## Goal

Take the repo from 24 ESLint warnings to zero, and make zero the enforced
baseline. Three of the four warning clusters turned out to be symptoms of real
defects rather than lint noise, so the work is scoped to fixing the causes.

Delivered as **one PR** (single-maintainer, pre-production) built from **four
sequenced commits**, so `git bisect` and per-change revert still work. The
logging commit must land first: the warnings cleanup depends on where log lines
are allowed to go.

## The 24 warnings

| Rule                                 | Count | Root cause                                                                                                                                                 |
| ------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-console`                         | 16    | 9 `console.debug` + 4 `console.info` in `app/hooks/`, 3 `console.info` in `realtime/src/`. The rule allows only `warn`/`error`, so `info` violates it too. |
| `@typescript-eslint/no-unused-vars`  | 3     | Dead ping code in `TabletopView.tsx`. `eslint.config.mjs:35` sets only `argsIgnorePattern`, so the author's `_` prefix never applied to variables.         |
| `@typescript-eslint/no-explicit-any` | 3     | `sessionAccess.ts` casts around models that are typed `any` at the source.                                                                                 |
| `react-hooks/exhaustive-deps`        | 2     | Unmemoized hook return objects make `mutations.openWindow` unstable.                                                                                       |

## Findings that drive the design

**Client `console.*` is leaking user data today.** `usePartySession.ts:29` prints
`sessionId`; `useBeyond20.ts:201,206` print character names and roll titles. Any
player can read these in devtools. This is the motivating defect, not the lint
warning.

**The log pipeline already exists.** `docs/observability.md:41` — pod stdout is
scraped into **VictoriaLogs**, queried via Grafana Explore with selectors like
`{namespace="prod", pod=~"cartyx-web.*"}`. A provisioned alert fires if the
pipeline goes silent 15 min. In k8s, **stdout is the log file**: a logger must
write structured JSON to stdout. Writing real files inside a container would be
ephemeral, invisible to VictoriaLogs, and lost on restart.

**`bootstrap.ts:100-104`'s silence decision rests on a dead premise.** The
comment says the bootstrap lifecycle is "observed via PostHog events... We avoid
console.log here to prevent noisy stdout logging." PostHog is gone — `POSTHOG_KEY`
appears in exactly one place repo-wide: that comment. The sink became Umami,
which is _product analytics_, not an ops log store. So `db.bootstrap.*` events
currently pollute funnel data and cannot be correlated with pod logs in Grafana.
Reversing the decision closes a real gap. Its legitimate half — nobody wants
noisy local stdout — is preserved via env-driven log levels.

**The ping feature is stranded, not unfinished.** `PingOverlay.tsx` was added
2026-04-20 in a single commit that touched nothing else, never rendered, never
tested (`lcov`: `FNDA:0`). It returns a Konva `<Layer>`, but `ActiveMapStage`
migrated to DOM/CSS — the only surviving `<Stage>` is `DefaultGrid`, which
renders only when there is **no** map, i.e. where pinging is meaningless. No code
anywhere constructs a `type:'ping'` message, so the `case 'ping'` receiver is
unreachable while `setPings` accumulates into an array nothing drains or reads.

**Typed models are tractable.** Spike: typing `Session` via `InferSchemaType`
surfaced exactly 2 errors, both in `campaigns.ts:234,238`, both genuinely wrong
annotations the `any` was hiding (`ReturnType<typeof Session.find>` declares a
Document-returning Query, then `.lean()` returns POJOs). All 1674 tests passed
with the spike applied; `tests` is in the tsconfig `include` and stayed clean,
because the `vi.mock` mocks are runtime-only.

## Commit 1 — structured logging

New `realtime/src/logger.ts` and `app/server/utils/logger.ts`, both pino → JSON
on stdout.

- **No transports.** No file transport, no worker-thread transport. Worker
  transports break under the Nitro/Vite SSR bundle, and files inside a container
  are invisible to VictoriaLogs.
- **Central redaction.** A `redact` list strips PII at the logger rather than
  trusting call sites: `sessionId`, `userName`, `characterName`, message bodies,
  roll contents. A test must assert stripping actually happens, or the list rots.
- **Levels from env.** `LOG_LEVEL` wins when set. Otherwise default by
  `NODE_ENV`: `test` → `silent`, `development` → `warn`, everything else →
  `info`. This is what preserves the legitimate half of the bootstrap decision —
  local stdout stays quiet — without a separate "am I in the cluster?" check,
  which we have no reliable signal for.
- **Server-only.** `app/server/utils/logger.ts` must never reach the client
  bundle; `eslint.config.mjs:77` (`no-restricted-imports`) already enforces the
  boundary.
- Migrate `realtime/src`: `index.ts:24,41,45` (`console.info` → `log.info`),
  `index.ts:12,54,57` and `server.ts:30,33,86,124` (`console.error` → `log.error`).
- Move `db.bootstrap.*` lifecycle out of Umami into structured logs; update the
  stale PostHog comment.
- `eslint.config.mjs`: `no-console` → **`error`, no `allow` list**, repo-wide.

### `withLogging` and how far it is applied

There is no central dispatch to instrument. `rpc.ts` wraps only 4 route-facing
calls, and per its own comment (lines 7-14) each hook wraps its own server calls
— 30 `createServerFn` sites. So "instrument the server" would otherwise mean
touching **169 exported functions across 36 files**.

Ship the HOF in `app/server/utils/logger.ts`:

```ts
export const withLogging = <T extends (...a: never[]) => Promise<unknown>>(
  name: string,
  fn: T
): T =>
  (async (...args) => {
    const start = performance.now();
    try {
      return await fn(...args);
    } catch (err) {
      log.error({ fn: name, err }, 'server fn failed');
      throw err;
    } finally {
      log.debug({ fn: name, ms: performance.now() - start }, 'server fn done');
    }
  }) as T;
```

The policy is uniform — error-on-throw with redacted context, plus name and
duration — so there are no per-function judgment calls.

**Applied in this PR:** `db.bootstrap.*`, `sessionAccess.ts`, `chat.ts`,
`diceRolls.ts`, `auth.ts`, `health.ts` (~6 files).

**Adopted organically thereafter**, as functions are touched. Wrapping all 169 in
this PR would land a 36-file mechanical diff alongside the model retyping, which
is the one combination that would make the single PR genuinely hard to review.
Coverage grows instead of arriving at once.

## Commit 2 — the 24 warnings

- **Client logs: delete, do not relocate.** A browser logger has only two sinks:
  the console (the leak, now behind indirection that makes it harder to audit) or
  the network. Delete the 9 `console.debug` and 4 `console.info`. Genuine
  failures already flow to `captureException` → GlitchTip; `useBeyond20.ts:188`
  sits one line from the redundant `console.info` and demonstrates the pattern.
  The existing hook `console.error`/`console.warn` calls must also go, since
  `no-console` loses its `allow` list and they leak parse contents to the console
  too. They are failures, so they map to `captureException` → GlitchTip:
  - parse failures (`usePartySession.ts:19`, `useTabletopMapParty.ts:92`,
    `useTabletopParty.ts:20`) → `captureException(err)`
  - schema rejection (`useTabletopMapParty.ts:98`) → `captureException`
  - abnormal disconnects (`usePartySession.ts:34`, `useTabletopMapParty.ts:119`,
    `useTabletopParty.ts:36`) → `captureException(new Error(...))` carrying the
    close code. Keep the existing `code !== 1000` guard — normal closures are not
    errors and must not page anyone.

  Note `captureException` must not receive the raw message body (that would move
  the leak from the console to GlitchTip): pass the error and the close code, not
  the payload.
  - Bonus: `useDiceRolls.ts:138` and `useChatMessages.ts:178` are side effects
    **inside `useMemo` bodies** — a React Compiler correctness smell independent
    of lint. Deleting them fixes it.

- **Ping: delete.** Remove `PingOverlay.tsx`, `_pings`, `_handlePingExpired`, the
  unreachable `case 'ping'`, and the `type:'ping'` def in `app/types/tabletop.ts:105-112`.
  Fix docs that still describe it as live: `docs/tabletop/architecture.md:33,70,122`
  and `docs/tabletop/adding-features.md:51`. Rebuilding it properly (DOM/CSS
  overlay against `ActiveMapStage`'s viewport transform, a send gesture,
  coordinate conversion, array drain) is a **separate future PR**; the existing 72
  lines are unsalvageable and git history preserves them.
- **`sessionAccess.ts`:** use the `lean<T>()` pattern already proven at
  `auth.ts:81`. `Campaign.findById` currently lacks `.lean()`; adding it is safe
  (the doc is only read, never saved).
- **deps:** hoist the stable `.mutate` reference (TanStack v5 wraps it in
  `useCallback`; the surrounding result object is what's unstable) and add it to
  the dep arrays at `GMScreensView.tsx:607` and `TabletopView.tsx:516`.
- Add `--max-warnings 0` to the lint script; update the CLAUDE.md line that
  records ~24 warnings as the baseline.

## Commit 3 — memoize hook returns

`useMemo` the return objects at `useTabletopScreens.ts:224` and
`useGMScreens.ts:391`. This is the root cause of the deps churn and also fixes 4
unflagged sites (`TabletopView.tsx:189,244,530,591`) that silently rebuild
callbacks every render. Hot tabletop paths — e2e is the gate.

## Commit 4 — type the mongoose models

`InferSchemaType` across all 30 models in `app/server/db/models/`:

```ts
export type ISession = InferSchemaType<typeof sessionSchema>;
export const Session: Model<ISession> =
  (mongoose.models.Session as Model<ISession>) ||
  mongoose.model<ISession>('Session', sessionSchema);
```

Derived from the schema, so there is no hand-maintained interface to drift — the
schema stays the single source of truth. Then delete the now-surfaced wrong
annotations (`campaigns.ts:226,234,238`, the `as Array<{...}>` cast at `:243`).
Expect ~2 errors per model, all mechanical.

## Risks

- **Log volume vs retention.** This adds ingest to VictoriaLogs. Check the
  current retention window before merging; the "log pipeline silent 15 min" alert
  tells us the pipeline is watched, not that it is unbounded.
- **pino in the SSR bundle.** Must stay server-only and transport-free.
- **Redaction rot.** Mitigated by an asserting test, not by review discipline.
- **Commit 4 blast radius.** Mechanical but wide. Bounded by: typecheck clean,
  1674 unit tests green, e2e green.

## Success criteria

- `npm run lint` → 0 errors, **0 warnings**, enforced by `--max-warnings 0`.
- `npm run typecheck` clean.
- `npm test` → 1674 passing (plus new logger/redaction tests).
- `npm run e2e` green.
- `bash deploy/charts/cartyx/tests/render-tests.sh` green if `deploy/charts/` is touched.
- No `sessionId`, character name, or message body reaches a browser console.
- `realtime` and server logs queryable in Grafana Explore via VictoriaLogs.

## Out of scope

- Rebuilding the ping feature (its own design + PR).
- Adding a client-side logger abstraction (the console is the leak).
- Applying `withLogging` to the remaining ~160 server functions. The HOF ships
  here; adoption is organic.
- Exporting `ISession`-style hand-written interfaces. `InferSchemaType` derives
  them, so there is nothing to hand-maintain.
