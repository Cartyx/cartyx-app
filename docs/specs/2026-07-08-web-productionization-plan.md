# Web Productionization Implementation Plan (Self-Host Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TanStack Start web app runnable as a production container: `APP_ENV` environment detection, `/healthz` + `/readyz` probes, `.output` server entry, `Dockerfile.web`, compose integration, and e2e-against-container.

**Architecture:** Server-side env detection collapses to one `APP_ENV` variable resolved in `app/server/db/policy.ts` and consumed everywhere else. Health endpoints are Nitro server routes in a new top-level `server/routes/` dir (fallback: TanStack Start server routes). The image is a multi-stage `node:22-alpine` build copying only `.output`, mirroring `realtime/Dockerfile`.

**Tech Stack:** TanStack Start + Nitro 3 (beta, via `nitro/vite`), Node 22, vitest, Playwright, Docker/compose.

**Spec:** `docs/specs/2026-07-08-web-productionization-design.md` — read it first.

## Global Constraints

- **No new npm dependencies.** Everything here uses what's already installed. (If one ever becomes unavoidable: only packages published ≥1 week ago.)
- **Do not touch** `@tanstack/react-router` / `@tanstack/react-start` versions (lockstep pin) or the `nitro` pin.
- Branch: `web-productionization` (already created off `origin/dev`). PR targets `dev`, never `main`.
- Never commit `.env`. Secrets are injected at deploy time.
- `APP_ENV` vocabulary everywhere: `production | staging | development`.
- Prettier runs via lefthook on commit — don't fight reformatting.
- Run all commands from the worktree root: `/Users/labeaaa/Developer/cartyx-app/.claude/worktrees/realtime-service`.
- Unit test command: `npx vitest run --project unit <file>` (or `npm test` for the whole suite). Typecheck: `npm run typecheck`.

---

### Task 1: Spike — production build boots; health server routes discovered

Everything downstream depends on facts this task establishes. **If a STOP gate below fires, stop and report instead of improvising.**

**Files:**

- Create: `server/routes/healthz.ts`
- Create: `server/routes/readyz.ts`
- Possibly modify: `.gitignore` (ensure the build output dir is ignored)

**Interfaces:**

- Consumes: `healthCheck(): Promise<{ ok: true }>` from `app/server/functions/health.ts` (throws with `status: 503` when Mongo is unreachable).
- Produces: `GET /healthz` → 200 `{"status":"ok"}` (no I/O); `GET /readyz` → 200 `{"ok":true}` or 503 `{"ok":false}`. Task 7 (Dockerfile), Task 8 (compose), and Phase 3 probes rely on these exact paths and codes.

- [ ] **Step 1: Confirm what the build currently emits**

```bash
npm run build 2>&1 | tail -20
ls .output/server/index.mjs 2>/dev/null || find .output dist -maxdepth 3 -name "*.mjs" 2>/dev/null | head
```

Expected: build succeeds and `.output/server/index.mjs` exists.
**STOP gate:** if the server bundle lands somewhere other than `.output/server/index.mjs` (e.g. under `dist/`), stop and report the actual layout — later tasks hardcode this path and the spec/roadmap assume it.

- [ ] **Step 2: Confirm traceDeps landed as external modules**

```bash
ls .output/server/node_modules/ | grep -E "mongoose|mongodb|bson"
```

Expected: all three present (the `traceDeps` in `vite.config.ts` copies them instead of bundling).

- [ ] **Step 3: Boot the build and smoke it**

Requires a filled `.env` (dev Atlas). Stop any running `vite dev` first.

```bash
node --env-file=.env .output/server/index.mjs &
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/          # expect 200
curl -s http://localhost:3000/ | head -c 300                             # expect HTML with the app shell
kill %1
```

**STOP gate:** if SSR crashes on boot (e.g. mongoose `require is not defined`), stop and report — that's a Nitro-beta bundling problem to solve before anything else.

- [ ] **Step 4: Check which h3 handler exports exist (Nitro 3 / h3 v2 API drift)**

```bash
node -e "import('h3').then(m => console.log(Object.keys(m).filter(k => /define.*handler/i.test(k))))"
```

Expected: `defineEventHandler` (possibly alongside `defineHandler`). Use whichever exists in the next step; prefer `defineEventHandler` if both.

- [ ] **Step 5: Write the health routes**

`server/routes/healthz.ts`:

```ts
import { defineEventHandler } from 'h3';

// Liveness probe: the process is up and the HTTP stack responds. Deliberately
// no I/O — a DB-pinging liveness probe would make k8s restart-loop healthy
// pods during an Atlas blip. Readiness (readyz.ts) covers the DB.
export default defineEventHandler(() => Response.json({ status: 'ok' }));
```

`server/routes/readyz.ts`:

```ts
import { defineEventHandler } from 'h3';
import { healthCheck } from '~/server/functions/health';

// Readiness probe: 200 only when Mongo answers a ping. On 503 the pod leaves
// the load balancer; it is not restarted (that's healthz's job).
const READYZ_TIMEOUT_MS = 2_000;

export default defineEventHandler(async () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      healthCheck(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('readyz timeout')), READYZ_TIMEOUT_MS);
      }),
    ]);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
});
```

- [ ] **Step 6: Verify route discovery in dev**

```bash
npm run dev &
sleep 5
curl -s http://localhost:3000/healthz    # expect {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/readyz   # expect 200 (Atlas reachable)
kill %1
```

**Fallback if 404:** Nitro's `server/routes/` scan isn't active alongside `tanstackStart({ srcDirectory: 'app' })`. Delete `server/routes/`, and instead create TanStack Start server routes `app/routes/healthz.ts` / `app/routes/readyz.ts` with the same handler bodies:

```ts
// app/routes/healthz.ts — TanStack Start server route (no component)
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/healthz')({
  server: {
    handlers: {
      GET: () => Response.json({ status: 'ok' }),
    },
  },
});
```

```ts
// app/routes/readyz.ts
import { createFileRoute } from '@tanstack/react-router';
import { healthCheck } from '~/server/functions/health';

const READYZ_TIMEOUT_MS = 2_000;

async function readyz(): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      healthCheck(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('readyz timeout')), READYZ_TIMEOUT_MS);
      }),
    ]);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

export const Route = createFileRoute('/readyz')({
  server: {
    handlers: {
      GET: () => readyz(),
    },
  },
});
```

If the `server.handlers` route option doesn't typecheck on the pinned `@tanstack/react-start`, check the version's docs via context7 (`/tanstack/router`, topic "server routes") for the exact shape — do not upgrade the packages. Re-run the dev-server curl checks; whichever mechanism worked is "the health routes" for all later tasks (paths and status codes are identical either way).

- [ ] **Step 7: Verify in the production build, including the Mongo-down case**

```bash
npm run build
node --env-file=.env .output/server/index.mjs &
sleep 3
curl -s http://localhost:3000/healthz                                      # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/readyz      # 200
kill %1
# Now with unreachable Mongo — healthz must stay 200, readyz must go 503:
MONGODB_URI="mongodb://127.0.0.1:9/nope" SESSION_SECRET="x-not-real-but-32-chars-long-xx" node .output/server/index.mjs &
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/healthz     # 200
time curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/readyz # 503, ≤ ~2.5s
kill %1
```

- [ ] **Step 8: Establish NITRO_SHUTDOWN_TIMEOUT semantics**

```bash
grep -o 'NITRO_SHUTDOWN[A-Z_]*' .output/server/index.mjs | sort -u
```

Expected: the exact env var names the runtime honors (e.g. `NITRO_SHUTDOWN_TIMEOUT`, possibly `NITRO_SHUTDOWN_DISABLED`). Then observe SIGTERM behavior:

```bash
node --env-file=.env .output/server/index.mjs &
sleep 3
kill -TERM %1
wait %1; echo "exit: $?"     # expect graceful exit 0, not instant kill
```

Record in the Task 7 Dockerfile whichever var name + unit (ms vs s) the grep revealed; the spec's default intent is ~10 seconds.

- [ ] **Step 9: Ensure the output dir is git-ignored, typecheck, commit**

```bash
git check-ignore -q .output || echo ".output" >> .gitignore
npm run typecheck
npm test
git add server/ .gitignore   # or app/routes/healthz.ts app/routes/readyz.ts if fallback was used
git commit -m "feat(server): healthz/readyz probe routes; verify .output production build"
```

Expected: typecheck clean, 1507+ tests pass.

---

### Task 2: `APP_ENV` replaces `BOOTSTRAP_ENV`/`VERCEL_ENV` in `policy.ts`

**Files:**

- Modify: `app/server/db/policy.ts` (doc comment lines 9–15, 69–90)
- Modify: `app/server/db/bootstrap.ts:43` (doc comment only)
- Modify: `.env.example`
- Test: `tests/server/db/policy.test.ts`

**Interfaces:**

- Produces: `resolveEnvironment(): BootstrapEnvironment` with resolution order `APP_ENV` (validated) → `NODE_ENV === 'production'` → `'development'`. Tasks 3 and 4 import this exact function.

- [ ] **Step 1: Rewrite the `resolveEnvironment` describe block in `tests/server/db/policy.test.ts`**

Replace the whole `describe('resolveEnvironment', ...)` block (keep `getBootstrapPolicy` tests untouched):

```ts
describe('resolveEnvironment', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.APP_ENV = process.env.APP_ENV;
    saved.NODE_ENV = process.env.NODE_ENV;
    delete process.env.APP_ENV;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('returns explicit APP_ENV when set to production', () => {
    process.env.APP_ENV = 'production';
    expect(resolveEnvironment()).toBe('production');
  });

  it('returns explicit APP_ENV when set to staging', () => {
    process.env.APP_ENV = 'staging';
    expect(resolveEnvironment()).toBe('staging');
  });

  it('returns explicit APP_ENV when set to development', () => {
    process.env.APP_ENV = 'development';
    expect(resolveEnvironment()).toBe('development');
  });

  it('ignores invalid APP_ENV values', () => {
    process.env.APP_ENV = 'preview';
    process.env.NODE_ENV = 'development';
    expect(resolveEnvironment()).toBe('development');
  });

  it('APP_ENV takes precedence over NODE_ENV', () => {
    process.env.APP_ENV = 'staging';
    process.env.NODE_ENV = 'production';
    expect(resolveEnvironment()).toBe('staging');
  });

  it('returns production when NODE_ENV is production and APP_ENV is unset', () => {
    process.env.NODE_ENV = 'production';
    expect(resolveEnvironment()).toBe('production');
  });

  it('defaults to development otherwise', () => {
    process.env.NODE_ENV = 'test';
    expect(resolveEnvironment()).toBe('development');
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run --project unit tests/server/db/policy.test.ts`
Expected: FAIL — `APP_ENV takes precedence` and the explicit-`APP_ENV` cases fail (current code reads `BOOTSTRAP_ENV`).

- [ ] **Step 3: Implement in `app/server/db/policy.ts`**

Replace `resolveEnvironment` and its doc comment:

```ts
/**
 * Detect the current deployment environment.
 *
 * Resolution order:
 * 1. Explicit `APP_ENV` (`production` | `staging` | `development`)
 * 2. Fallback: `NODE_ENV === 'production'` → production, else development
 */
export function resolveEnvironment(): BootstrapEnvironment {
  const explicit = process.env.APP_ENV;
  if (explicit === 'production' || explicit === 'staging' || explicit === 'development') {
    return explicit;
  }

  if (process.env.NODE_ENV === 'production') return 'production';

  return 'development';
}
```

Update the module doc comment at the top of the file (lines 9–15): the "Environment detection" list becomes `1. APP_ENV — explicit (production, staging, development); 2. NODE_ENV — production maps to production; everything else → development`. Delete the `VERCEL_ENV` bullet.

In `app/server/db/bootstrap.ts` change line 43 from:

```
 * The policy is resolved automatically from `BOOTSTRAP_ENV`, `VERCEL_ENV`,
 * or `NODE_ENV` unless provided explicitly.
```

to:

```
 * The policy is resolved automatically from `APP_ENV` or `NODE_ENV`
 * unless provided explicitly.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/server/db/policy.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Update `.env.example`**

In the `# Server` block, replace the comment `(local dev only — Vercel manages these in production)` with `(injected by the deploy environment in production)` and add:

```
# Deployment environment: production | staging | development.
# Controls DB bootstrap policy, analytics labels, and the image-upload
# local-disk fallback (development only).
APP_ENV=development
```

- [ ] **Step 6: Confirm no stragglers, commit**

```bash
grep -rn "BOOTSTRAP_ENV" app/ tests/ scripts/ e2e/ && echo "LEFTOVERS" || echo "clean"
npm run typecheck
git add app/server/db/policy.ts app/server/db/bootstrap.ts tests/server/db/policy.test.ts .env.example
git commit -m "feat(env): APP_ENV replaces BOOTSTRAP_ENV/VERCEL_ENV in bootstrap policy"
```

Expected: `clean` (docs/specs mentions are fine and excluded from the grep).

---

### Task 3: Server analytics labels use `resolveEnvironment()`

**Files:**

- Modify: `app/server/utils/posthog.ts:10-14`
- Test: `tests/server/utils/posthog.test.ts`

**Interfaces:**

- Consumes: `resolveEnvironment` from Task 2.
- Produces: server-side `$exception`/event properties carry `environment: 'production' | 'staging' | 'development'`.

- [ ] **Step 1: Add a failing test in `tests/server/utils/posthog.test.ts`**

Add inside the top-level `describe('server posthog utilities', ...)`, after the `serverCaptureEvent` describe. Also add `delete process.env.APP_ENV;` to the existing top-level `afterEach`:

```ts
describe('environment labeling', () => {
  it('labels events with the APP_ENV-derived environment', async () => {
    process.env.POSTHOG_KEY = 'test-key';
    process.env.APP_ENV = 'staging';
    const { serverCaptureEvent } = await import('~/server/utils/posthog');
    await serverCaptureEvent('user_123', 'dice_rolled');

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ environment: 'staging' }),
      })
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit tests/server/utils/posthog.test.ts`
Expected: FAIL — environment is `'test'` (falls through to `NODE_ENV`), not `'staging'`.

- [ ] **Step 3: Implement in `app/server/utils/posthog.ts`**

Replace lines 10–14 (`getEnvironment`) with:

```ts
import { resolveEnvironment } from '../db/policy';
```

(placed with the other imports at the top) and:

```ts
function getEnvironment(): string {
  return resolveEnvironment();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/server/utils/posthog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server/utils/posthog.ts tests/server/utils/posthog.test.ts
git commit -m "feat(env): server analytics environment label from APP_ENV"
```

---

### Task 4: Image-upload fail-fast guard uses `APP_ENV`

**Files:**

- Modify: `app/server/utils/helpers.ts:114-127`
- Test: `tests/server/utils/saveUploadedFile.test.ts`

**Interfaces:**

- Consumes: `resolveEnvironment` from Task 2.
- Produces: `saveUploadedFile` throws outside `development` when `CDN_URL` is unset; local-disk fallback only in `development`.

- [ ] **Step 1: Update the guard tests in `tests/server/utils/saveUploadedFile.test.ts`**

In the `describe('when CDN_URL is not set (local fallback)', ...)` block: replace `delete process.env.VERCEL` in its `beforeEach` with `process.env.APP_ENV = 'development'`, and replace the `'throws on Vercel without CDN_URL'` test with:

```ts
it('throws in production without CDN_URL', async () => {
  process.env.APP_ENV = 'production';
  const { saveUploadedFile } = await import('~/server/utils/helpers');
  const file = makeFile('image/png', 100);
  await expect(saveUploadedFile(file, 'uploads')).rejects.toThrow(
    'CDN_URL environment variable is required for image uploads in production'
  );
});

it('throws in staging without CDN_URL', async () => {
  process.env.APP_ENV = 'staging';
  const { saveUploadedFile } = await import('~/server/utils/helpers');
  const file = makeFile('image/png', 100);
  await expect(saveUploadedFile(file, 'uploads')).rejects.toThrow(
    'CDN_URL environment variable is required for image uploads in production'
  );
});
```

(`afterEach` already restores `process.env` from `originalEnv`, which covers `APP_ENV`.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run --project unit tests/server/utils/saveUploadedFile.test.ts`
Expected: the two new tests FAIL (no throw — current code only checks `VERCEL`); the rest pass.

- [ ] **Step 3: Implement in `app/server/utils/helpers.ts`**

Add to the imports: `import { resolveEnvironment } from '../db/policy'`. Replace the guard at lines 115–119:

```ts
if (!cdnUrl) {
  // Fail fast outside local dev: container/pod filesystems are ephemeral
  // (and read-only once the production chart hardens them) — uploads must go to R2.
  if (resolveEnvironment() !== 'development') {
    throw new Error('CDN_URL environment variable is required for image uploads in production')
  }
```

(The rest of the local-disk fallback below it is unchanged.) Update the function's doc comment: replace the `e.g. Vercel` phrasing in the "Fail fast in serverless environments" comment — the new comment above is the replacement.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/server/utils/saveUploadedFile.test.ts`
Expected: PASS (all cases, including the untouched R2 ones).

- [ ] **Step 5: Confirm `VERCEL` is gone from the codebase, commit**

```bash
grep -rn "VERCEL" app/ tests/ scripts/ e2e/ && echo "LEFTOVERS" || echo "clean"
git add app/server/utils/helpers.ts tests/server/utils/saveUploadedFile.test.ts
git commit -m "feat(env): image-upload fail-fast guard driven by APP_ENV"
```

Expected: `clean`.

---

### Task 5: Client environment label — drop `vercel.app`, rename `preview` → `staging`

**Files:**

- Modify: `app/utils/posthog-client.ts:34-52`
- Test: `tests/utils/posthog-client.test.ts`

**Interfaces:**

- Produces: `getClientEnvironment(currentUrl?: string): string` becomes **exported** (previously internal); returns `production | staging | development | unknown`.

- [ ] **Step 1: Add failing tests to `tests/utils/posthog-client.test.ts`**

Add `getClientEnvironment` to the existing import from `~/utils/posthog-client`, then append:

```ts
describe('getClientEnvironment', () => {
  it.each([
    ['https://cartyx.io/campaigns', 'production'],
    ['https://www.cartyx.io/', 'production'],
    ['https://dev.cartyx.io/campaigns', 'staging'],
    ['http://localhost:3000/', 'development'],
    ['http://app.localhost:3000/', 'development'],
    ['https://cartyx-app.vercel.app/', 'unknown'],
    ['https://evil-cartyx.io.example.com/', 'unknown'],
  ])('maps %s to %s', (url, expected) => {
    expect(getClientEnvironment(url)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit tests/utils/posthog-client.test.ts`
Expected: FAIL — `getClientEnvironment` is not exported (import error), and once exported the `dev.cartyx.io` case would return `'preview'`.

- [ ] **Step 3: Implement in `app/utils/posthog-client.ts`**

Change the function to (export added, `staging` label, `vercel.app` line deleted):

```ts
export function getClientEnvironment(currentUrl: string = window.location.href): string {
  try {
    const url = new URL(currentUrl, window.location.origin);
    const { hostname } = url;

    if (hostnameMatches(hostname, 'dev.cartyx.io')) return 'staging';
    if (hostnameMatches(hostname, 'cartyx.io')) return 'production';
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return 'development';
  } catch {
    return 'unknown';
  }

  return 'unknown';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/utils/posthog-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/utils/posthog-client.ts tests/utils/posthog-client.test.ts
git commit -m "feat(env): client environment label — staging vocabulary, drop vercel.app"
```

---

### Task 6: Feature flags become plain booleans

**Files:**

- Modify: `app/utils/featureFlags.tsx:37-62` (the two optional-flag hooks)
- Modify: `app/components/mainview/InspectorSidebar.tsx:59-63` (local variable names only)
- Modify: `app/components/mainview/ToolBar.tsx:57` (comment only, optional)
- Modify: `.env.example`
- Test: `tests/utils/featureFlags.test.tsx`

**Interfaces:**

- Produces: `useOptionalFeatureFlag(flagValue: string): { isEnabled: boolean; isLoading: boolean }` and `useOptionalFeatureFlagEnabled(flagValue: string): boolean` — the argument is now the **env value** (`'true'`/`'1'` enables), not a PostHog flag name. `isLoading` is always `false`. Signatures are unchanged, so consumers compile as-is.

- [ ] **Step 1: Replace the optional-flag tests in `tests/utils/featureFlags.test.tsx`**

Delete the `describe('useOptionalFeatureFlagEnabled', ...)` and `describe('useOptionalFeatureFlag timeout', ...)` blocks; add:

```ts
describe('useOptionalFeatureFlagEnabled (boolean env values)', () => {
  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['', false],
    ['TRUE', false], // strict lowercase — documented in .env.example
    ['some-legacy-flag-name', false],
  ])('parses %j as %s', (value, expected) => {
    render(<OptionalFlagProbe flag={value} />)
    expect(screen.getByTestId('result')).toHaveTextContent(String(expected))
  })

  it('never queries PostHog', () => {
    render(<OptionalFlagProbe flag="true" />)
    expect(mockUsePostHogFeatureFlagEnabled).not.toHaveBeenCalled()
  })
})

describe('useOptionalFeatureFlag (boolean env values)', () => {
  it('is enabled and never loading for "true"', () => {
    render(<OptionalFlagStateProbe flag="true" />)
    expect(screen.getByTestId('isEnabled')).toHaveTextContent('true')
    expect(screen.getByTestId('isLoading')).toHaveTextContent('false')
  })

  it('is disabled and never loading for an unset value', () => {
    render(<OptionalFlagStateProbe flag="" />)
    expect(screen.getByTestId('isEnabled')).toHaveTextContent('false')
    expect(screen.getByTestId('isLoading')).toHaveTextContent('false')
  })
})
```

(The `OptionalFlagProbe` / `OptionalFlagStateProbe` components and the PostHog mocks at the top of the file stay — the other hooks still use PostHog.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run --project unit tests/utils/featureFlags.test.tsx`
Expected: FAIL — `'true'` is treated as a PostHog flag name (mock returns undefined → disabled/loading).

- [ ] **Step 3: Implement in `app/utils/featureFlags.tsx`**

Replace the two optional hooks and the sentinel/timeout machinery (lines 37–62) with:

```ts
// The optional flags are plain booleans baked into the client bundle from
// VITE_PUBLIC_FF_* at build time — no PostHog round-trip. Kept as hooks so
// call sites don't churn; `flagValue` is the env value itself.
function parseBooleanFlag(flagValue: string): boolean {
  return flagValue === 'true' || flagValue === '1';
}

export function useOptionalFeatureFlagEnabled(flagValue: string): boolean {
  return parseBooleanFlag(flagValue);
}

export function useOptionalFeatureFlag(flagValue: string): {
  isEnabled: boolean;
  isLoading: boolean;
} {
  return { isEnabled: parseBooleanFlag(flagValue), isLoading: false };
}
```

Remove the now-unused `useState`/`useEffect` from the react import and delete `FLAG_LOADING_TIMEOUT_MS`. Everything else in the file (PostHog-backed `useFeatureFlag`, `FeatureFlagGate`, etc.) is untouched.

- [ ] **Step 4: Rename misleading locals in `InspectorSidebar.tsx`**

Lines 59–63: `chatFlagName` → `chatFlagValue` (and dice/wiki/notes/settings likewise), updating the five `useOptionalFeatureFlag(...)` call arguments to match. In `ToolBar.tsx:56` update the comment to `// The interactive dice roller ships behind the same boolean flag as the Dice feed tab.`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/utils/featureFlags.test.tsx && npx vitest run --project unit tests/components`
Expected: PASS. If any component test stubbed PostHog flags to make tabs render, it will surface here — update that test to pass `'true'` values instead.

- [ ] **Step 6: Update `.env.example` and your local `.env`**

Replace the flag block in `.env.example` with:

```
# Inspector feature flags — plain booleans baked into the client bundle at
# BUILD time ('true' or '1' enables, lowercase; anything else disables).
# Changing a value needs a rebuild (dev-server restart / new image build).
# Playwright e2e needs these set or the inspector tabs never render.
VITE_PUBLIC_FF_CHAT=true
VITE_PUBLIC_FF_WIKI=true
VITE_PUBLIC_FF_NOTES=true
VITE_PUBLIC_FF_SETTINGS=true
VITE_PUBLIC_FF_DICE=true
```

(also fold in the stray `VITE_PUBLIC_FF_DICE` entry at the bottom of the file). Set the same `true` values in your local `.env` — e2e depends on it from here on.

- [ ] **Step 7: Commit**

```bash
git add app/utils/featureFlags.tsx app/components/mainview/InspectorSidebar.tsx app/components/mainview/ToolBar.tsx tests/utils/featureFlags.test.tsx .env.example
git commit -m "feat(flags): VITE_PUBLIC_FF_* are plain booleans — drop PostHog indirection for inspector tabs"
```

---

### Task 7: Delete legacy servers; `start` runs the Nitro output

**Files:**

- Delete: `prod-server.js`, `server.cjs`
- Modify: `package.json:13` (`start` script)

**Interfaces:**

- Produces: `npm start` = `node --env-file-if-exists=.env .output/server/index.mjs`. Task 8's Dockerfile CMD mirrors the same entry without the env-file flag.

- [ ] **Step 1: Confirm nothing references the legacy files**

```bash
git grep -n "prod-server\|server\.cjs" -- ':!docs/specs'
```

Expected: only `package.json`'s `start` script. Anything else found: update it in this task.

- [ ] **Step 2: Delete and rewire**

```bash
git rm prod-server.js server.cjs
```

In `package.json`: `"start": "node --env-file-if-exists=.env .output/server/index.mjs"`.

- [ ] **Step 3: Verify the full production path end to end**

```bash
npm run build && npm start &
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/           # 200
curl -s http://localhost:3000/healthz                                     # {"status":"ok"}
kill %1
```

- [ ] **Step 4: Commit**

```bash
npm run typecheck && npm run lint
git add package.json prod-server.js server.cjs
git commit -m "feat(build): npm start runs the Nitro .output server; delete prod-server.js and server.cjs"
```

---

### Task 8: `Dockerfile.web` + root `.dockerignore`

**Files:**

- Create: `Dockerfile.web`
- Create: `.dockerignore` (repo root)

**Interfaces:**

- Consumes: `.output/server/index.mjs` entry (Task 7), `/healthz` `/readyz` (Task 1).
- Produces: image `cartyx-web:local`, listening on 3000, `APP_ENV`/`MONGODB_URI`/etc. injected at runtime; `VITE_PUBLIC_*` baked via build args. Task 9's compose service builds this exact Dockerfile.

- [ ] **Step 1: Write root `.dockerignore`**

```
node_modules
.output
dist
.git
.claude
.worktrees
.env*
!.env.example
e2e
tests
docs
deploy
realtime
party
scripts
storybook-static
.storybook
coverage
playwright-report
test-results
public/uploads
*.md
```

- [ ] **Step 2: Write `Dockerfile.web`**

```dockerfile
# Web app image (TanStack Start + Nitro node-server).
#
# VITE_PUBLIC_* values are baked into the client bundle at BUILD time — prod
# and dev need separate image builds with different --build-arg values, not
# one image with different runtime env. Server-read env (MONGODB_URI,
# SESSION_SECRET, APP_ENV, R2_*, POSTHOG_KEY, BASE_URL, ...) is injected at
# runtime.
#
# Local build (pulls VITE_PUBLIC_* from your shell / .env):
#   set -a; source .env; set +a
#   docker build -f Dockerfile.web \
#     --build-arg VITE_PUBLIC_POSTHOG_KEY --build-arg VITE_PUBLIC_POSTHOG_HOST \
#     --build-arg VITE_PUBLIC_FF_CHAT --build-arg VITE_PUBLIC_FF_DICE \
#     --build-arg VITE_PUBLIC_FF_WIKI --build-arg VITE_PUBLIC_FF_NOTES \
#     --build-arg VITE_PUBLIC_FF_SETTINGS --build-arg VITE_PUBLIC_PARTYKIT_HOST \
#     -t cartyx-web:local .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
# --ignore-scripts: skips lefthook prepare and workerd/partykit postinstalls
# (dev-only tooling); esbuild/tailwind-oxide/resvg ship platform binaries as
# optionalDependencies, so they need no install scripts.
RUN npm ci --ignore-scripts
COPY tsconfig.json vite.config.ts ./
COPY app ./app
COPY server ./server
COPY public ./public
ARG VITE_PUBLIC_POSTHOG_KEY
ARG VITE_PUBLIC_POSTHOG_HOST
ARG VITE_PUBLIC_FF_CHAT
ARG VITE_PUBLIC_FF_DICE
ARG VITE_PUBLIC_FF_WIKI
ARG VITE_PUBLIC_FF_NOTES
ARG VITE_PUBLIC_FF_SETTINGS
ARG VITE_PUBLIC_PARTYKIT_HOST
ENV VITE_PUBLIC_POSTHOG_KEY=$VITE_PUBLIC_POSTHOG_KEY \
    VITE_PUBLIC_POSTHOG_HOST=$VITE_PUBLIC_POSTHOG_HOST \
    VITE_PUBLIC_FF_CHAT=$VITE_PUBLIC_FF_CHAT \
    VITE_PUBLIC_FF_DICE=$VITE_PUBLIC_FF_DICE \
    VITE_PUBLIC_FF_WIKI=$VITE_PUBLIC_FF_WIKI \
    VITE_PUBLIC_FF_NOTES=$VITE_PUBLIC_FF_NOTES \
    VITE_PUBLIC_FF_SETTINGS=$VITE_PUBLIC_FF_SETTINGS \
    VITE_PUBLIC_PARTYKIT_HOST=$VITE_PUBLIC_PARTYKIT_HOST
RUN npm run build

FROM node:22-alpine
# NITRO_SHUTDOWN_TIMEOUT: graceful-shutdown window (Task 1 step 8 verified the
# exact var name/units — adjust here if the spike found something different).
ENV NODE_ENV=production \
    NITRO_SHUTDOWN_TIMEOUT=10000
WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
# --max-old-space-size=400 ≈ 80% of the planned 512Mi pod limit.
CMD ["node", "--max-old-space-size=400", ".output/server/index.mjs"]
```

If Task 1 found the health-route **fallback** was needed (`app/routes/` instead of `server/routes/`), drop the `COPY server ./server` line. If the spike's step-8 grep showed a different shutdown var name or seconds-based units, fix the `ENV` line and this comment now.

- [ ] **Step 3: Build the image**

```bash
set -a; source .env; set +a
docker build -f Dockerfile.web \
  --build-arg VITE_PUBLIC_POSTHOG_KEY --build-arg VITE_PUBLIC_POSTHOG_HOST \
  --build-arg VITE_PUBLIC_FF_CHAT --build-arg VITE_PUBLIC_FF_DICE \
  --build-arg VITE_PUBLIC_FF_WIKI --build-arg VITE_PUBLIC_FF_NOTES \
  --build-arg VITE_PUBLIC_FF_SETTINGS --build-arg VITE_PUBLIC_PARTYKIT_HOST \
  -t cartyx-web:local .
```

Expected: builds clean. If `npm run build` fails inside Docker on a missing native binary, remove `--ignore-scripts` from `npm ci`, add `ENV LEFTHOOK=0` before it, and rebuild — then record which package needed its script in the Dockerfile comment.

- [ ] **Step 4: Run and verify (roadmap acceptance: serves the full app against dev Atlas)**

```bash
docker run --rm -d --name cartyx-web-test -p 3000:3000 \
  --env-file .env -e APP_ENV=development -e PORT=3000 cartyx-web:local
sleep 4
curl -s http://localhost:3000/healthz                                    # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/readyz    # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/          # 200
curl -s http://localhost:3000/ | grep -c "<script"                       # ≥1 (hydration scripts present)
docker exec cartyx-web-test whoami                                       # node
docker stop cartyx-web-test
```

(Stop any local dev server first — this intentionally uses port 3000 so `.env`'s `BASE_URL` matches.) Also open http://localhost:3000 in a browser while it runs: log in via the seeded session or OAuth, confirm a campaign page renders with inspector tabs visible.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile.web .dockerignore
git commit -m "feat(docker): Dockerfile.web — multi-stage nitro build, runtime-only .output image"
```

---

### Task 9: Compose gains the web service

**Files:**

- Modify: `deploy/local/compose.yaml`
- Modify: `deploy/local/README.md`

**Interfaces:**

- Consumes: `Dockerfile.web` (Task 8), realtime service + healthcheck (existing).
- Produces: `docker compose --env-file .env -f deploy/local/compose.yaml up` serves web on host **3100** and realtime on 1999. Task 10's e2e script drives this stack.

- [ ] **Step 1: Update the compose header comment and add the web service**

Replace the header comment of `deploy/local/compose.yaml` with:

```yaml
# Quick local path: run the web app + realtime service, no Kubernetes.
# Run from the REPO ROOT so ${VITE_PUBLIC_*} build args interpolate from .env:
#   docker compose --env-file .env -f deploy/local/compose.yaml up --build
# Env (SESSION_SECRET, MONGODB_URI, ...) comes from the repo-root .env.
# Web is on host port 3100 (3000 stays free for `vite dev`).
```

Append the service (keep `realtime` exactly as is):

```yaml
web:
  build:
    context: ../..
    dockerfile: Dockerfile.web
    args:
      VITE_PUBLIC_POSTHOG_KEY: ${VITE_PUBLIC_POSTHOG_KEY:-}
      VITE_PUBLIC_POSTHOG_HOST: ${VITE_PUBLIC_POSTHOG_HOST:-}
      VITE_PUBLIC_FF_CHAT: ${VITE_PUBLIC_FF_CHAT:-}
      VITE_PUBLIC_FF_DICE: ${VITE_PUBLIC_FF_DICE:-}
      VITE_PUBLIC_FF_WIKI: ${VITE_PUBLIC_FF_WIKI:-}
      VITE_PUBLIC_FF_NOTES: ${VITE_PUBLIC_FF_NOTES:-}
      VITE_PUBLIC_FF_SETTINGS: ${VITE_PUBLIC_FF_SETTINGS:-}
      # The browser connects to realtime via the HOST port mapping.
      VITE_PUBLIC_PARTYKIT_HOST: localhost:1999
  image: cartyx-web:local
  ports:
    - '3100:3000'
  env_file:
    - ../../.env
  environment:
    APP_ENV: development
    PORT: '3000'
    BASE_URL: http://localhost:3100
  depends_on:
    realtime:
      condition: service_healthy
  healthcheck:
    test:
      [
        'CMD',
        'node',
        '-e',
        "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
      ]
    interval: 10s
    timeout: 3s
    retries: 3
    start_period: 10s
  restart: unless-stopped
```

- [ ] **Step 2: Validate and bring the stack up (first-ever runtime test of the compose realtime path)**

```bash
docker compose --env-file .env -f deploy/local/compose.yaml config >/dev/null && echo "config ok"
docker compose --env-file .env -f deploy/local/compose.yaml up --build --wait
docker compose --env-file .env -f deploy/local/compose.yaml ps   # both services "healthy"
curl -s http://localhost:3100/healthz                             # {"status":"ok"}
curl -s http://localhost:1999/healthz                             # realtime healthz responds
```

Expected: `--wait` exits 0 with both healthy. If **realtime** fails health here, that's the known-untested compose path — debug it now (it was config-validated only); likely suspects are missing `.env` values.

- [ ] **Step 3: Manual smoke through the composed stack, then down**

Open http://localhost:3100, log in, open a campaign, confirm the Chat/Dice inspector tabs render and a dice roll round-trips (proves the browser→localhost:1999 realtime wiring).

```bash
docker compose --env-file .env -f deploy/local/compose.yaml down
```

- [ ] **Step 4: Update `deploy/local/README.md`**

In the intro table/paragraphs: the compose path now runs **web + realtime** (web on host 3100, built from `Dockerfile.web` at the repo root; `--env-file .env` from the repo root is required so the `VITE_PUBLIC_*` build args resolve). Add a note that `npm run e2e:container` (Task 10) is the scripted way to exercise this stack. Kind/Helm sections are unchanged (realtime-only until Phase 3).

- [ ] **Step 5: Commit**

```bash
git add deploy/local/compose.yaml deploy/local/README.md
git commit -m "feat(deploy): web service in local compose — first runtime coverage of the compose stack"
```

---

### Task 10: e2e against the container (`E2E_BASE_URL` + `e2e:container`)

**Files:**

- Modify: `playwright.config.ts`
- Create: `deploy/local/e2e-container.sh`
- Modify: `package.json` (scripts)

**Interfaces:**

- Consumes: compose stack (Task 9).
- Produces: `npm run e2e` (host dev-server flow, unchanged behavior) and `npm run e2e:container` (compose flow). CI reuses these in Phase 4.

- [ ] **Step 1: Make `playwright.config.ts` target-aware**

```ts
import { defineConfig, devices } from '@playwright/test';

// When E2E_BASE_URL is set (e.g. the containerized stack from
// `npm run e2e:container`), target it and don't boot a dev server.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    storageState: './e2e/.auth/storageState.json',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        // The dev server's first cold route compile can exceed Playwright's default
        // 60s webServer boot window in CI; give it longer so cold starts don't flake.
        timeout: 180_000,
      },
});
```

- [ ] **Step 2: Write `deploy/local/e2e-container.sh`**

```bash
#!/usr/bin/env bash
# Playwright e2e against the containerized stack (web + realtime) from
# deploy/local/compose.yaml. Run from the REPO ROOT via: npm run e2e:container
# Requires: filled .env (dev Atlas, VITE_PUBLIC_FF_*=true), seeded DB
# (npm run dev:seed), Docker running.
set -euo pipefail

COMPOSE=(docker compose --env-file .env -f deploy/local/compose.yaml)

cleanup() { "${COMPOSE[@]}" down; }
trap cleanup EXIT

"${COMPOSE[@]}" up --build --wait
E2E_BASE_URL=http://localhost:3100 npx playwright test "$@"
```

```bash
chmod +x deploy/local/e2e-container.sh
```

- [ ] **Step 3: Add npm scripts**

In `package.json` scripts, after `"test:ci"`:

```json
"e2e": "playwright test",
"e2e:container": "bash deploy/local/e2e-container.sh",
```

- [ ] **Step 4: Verify the host flow still works (config regression check)**

```bash
npx playwright test --list | head    # spec list resolves, no config errors
npm run e2e
```

Expected: suite green against the dev server (which Playwright boots itself), exactly as before the config change. Requires the seeded dev DB (`npm run dev:seed` if stale).

- [ ] **Step 5: Run the container flow (roadmap acceptance: e2e passes against the container)**

```bash
npm run e2e:container
```

Expected: compose builds + waits healthy, Playwright runs against :3100, suite green, stack tears down on exit (even on failure — the trap). Debugging note: `E2E_BASE_URL=http://localhost:3100 npx playwright test --ui` against a manually-started stack gives the interactive loop.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts deploy/local/e2e-container.sh package.json
git commit -m "feat(e2e): E2E_BASE_URL targeting + e2e:container script against the compose stack"
```

---

### Task 11: Final verification sweep + PR

**Files:** none new — verification and PR only.

- [ ] **Step 1: Full local gates**

```bash
npm run typecheck && npm run lint && npm test
npm run build
npm run e2e:container
```

Expected: all green. Fix anything that isn't before proceeding.

- [ ] **Step 2: Acceptance checklist (spec §7)**

- `docker run` of `cartyx-web:local` serves the full app against dev Atlas (Task 8 step 4 rerun if the image changed since).
- `/healthz` 200 with Mongo up **and** down; `/readyz` 200 up / 503 down (Task 1 step 7 commands against the final build).
- `npm run e2e:container` green.

- [ ] **Step 3: Push and open the PR (target `dev`, never `main`)**

```bash
git push -u origin web-productionization
gh pr create --base dev --title "Self-host Phase 2: web productionization (APP_ENV, healthz/readyz, Dockerfile.web)" --body "$(cat <<'EOF'
Implements docs/specs/2026-07-08-web-productionization-design.md.

- APP_ENV (production|staging|development) replaces VERCEL_ENV/VERCEL/BOOTSTRAP_ENV
- /healthz (liveness, no I/O) + /readyz (Mongo ping, 2s timeout) for k8s probes
- prod-server.js + server.cjs deleted; `npm start` runs .output/server/index.mjs
- VITE_PUBLIC_FF_* are plain booleans (PostHog flag-name indirection removed)
- Dockerfile.web (multi-stage node:22-alpine, runtime image = .output only, USER node)
- deploy/local/compose.yaml runs web (host 3100) + realtime; first runtime coverage of the compose path
- `npm run e2e:container` runs Playwright against the containerized stack

## ⚠️ Deploy coordination (before the next Vercel deploy of this branch)
Vercel env vars VITE_PUBLIC_FF_CHAT/DICE/WIKI/NOTES/SETTINGS currently hold
PostHog flag NAMES. They must be changed to `true` (or the desired boolean)
in both Vercel environments, or the inspector tabs disappear on the next
deploy. Optionally set APP_ENV=production / APP_ENV=staging there too
(NODE_ENV fallback keeps current behavior if unset).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Request review**

Use superpowers:requesting-code-review per its workflow before considering the branch done.

---

## Deferred / explicitly out of scope

- Helm chart for web, chart hardening (existingSecret, probe tuning, securityContext, no `tag: latest`) — Phase 3. The healthz/readyz split maps to livenessProbe/readinessProbe there.
- CI image builds, ghcr push, prod/dev build-arg matrix — Phase 4.
- PartyKit dep removal (`partykit`, `y-partyserver`, `party/`), PostHog removal — Phases 4/5.
- Manual two-browser realtime verification against a real `.env` — human, pre-cutover.
