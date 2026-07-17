import type { BootstrapEnvironment, BootstrapPolicy } from './policy';
import { getBootstrapPolicy } from './policy';
import { ensureCollections, syncCollectionsAndIndexes, inspectIndexes } from './inspect';
import { log } from '../utils/logger';

let bootstrapped = false;
let bootstrapPromise: Promise<void> | null = null;

/**
 * Tracks the underlying work of the current/last bootstrap attempt so that
 * a retry after timeout waits for the previous DB operations to settle
 * before starting new ones. This prevents overlapping bootstrap work.
 */
let inflightWork: Promise<void> | null = null;

/**
 * Error thrown when runtime bootstrap detects missing critical prerequisites.
 * Includes actionable details so operators can resolve the issue.
 */
export class BootstrapError extends Error {
  override readonly name = 'BootstrapError';
  constructor(
    message: string,
    public readonly environment: BootstrapEnvironment,
    public readonly details: string[]
  ) {
    super(message);
  }
}

/**
 * Runtime bootstrap — runs once per process on first database access.
 *
 * Behaviour is controlled by a {@link BootstrapPolicy} that varies by
 * environment:
 *
 * | Environment | Collections | Indexes | Critical check | Failure mode |
 * |-------------|-------------|---------|----------------|--------------|
 * | production  | ensure      | —       | yes            | abort        |
 * | staging     | ensure      | —       | yes            | warn         |
 * | development | ensure      | sync    | —              | —            |
 *
 * The policy is resolved automatically from `APP_ENV` or `NODE_ENV`
 * unless provided explicitly.
 *
 * All work is bounded by `policy.timeoutMs` so startup cannot hang
 * indefinitely without an actionable error.
 *
 * Safe to call multiple times — runs only once per process. If it throws,
 * the flag stays `false` so the next `connectDB()` call will retry.
 */
export async function bootstrapDB(policy?: BootstrapPolicy): Promise<void> {
  if (bootstrapped) return;

  // If a bootstrap is already in flight, share the same attempt so
  // concurrent callers don't duplicate work.
  if (bootstrapPromise) return bootstrapPromise;

  const resolved = policy ?? getBootstrapPolicy();

  bootstrapPromise = (async () => {
    // If a previous timed-out attempt's work is still running, wait for
    // it to settle before starting new work to prevent DB-level races.
    if (inflightWork) {
      const waitMs =
        typeof resolved.timeoutMs === 'number' && resolved.timeoutMs > 0
          ? resolved.timeoutMs
          : null;
      if (waitMs !== null) {
        await Promise.race([
          inflightWork.catch(() => {}),
          new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
        ]);
      } else {
        await inflightWork.catch(() => {});
      }
    }

    try {
      await runBootstrap(resolved);
      bootstrapped = true;
    } finally {
      bootstrapPromise = null;
    }
  })();

  return bootstrapPromise;
}

async function runBootstrap(policy: BootstrapPolicy): Promise<void> {
  const env = policy.environment;
  const start = performance.now();

  // Cancellation token — set by withTimeout on expiry so that the
  // underlying work (which cannot truly be cancelled) stops emitting
  // misleading success/warning logs and events after a timeout.
  // Also carries the current action for structured failure logging.
  const token = { cancelled: false, action: undefined as string | undefined };

  // Bootstrap lifecycle goes to structured logs (VictoriaLogs via stdout),
  // not to Umami: Umami is product analytics, and ops lifecycle events there
  // pollute funnel data and cannot be correlated with pod logs in Grafana.
  // Log level is env-driven (silent in test, warn in local dev), which keeps
  // local stdout quiet — the legitimate half of the original no-console rule.
  log.info(
    {
      bootstrap_env: env,
      sync_indexes: policy.syncIndexes,
      verify_critical: policy.verifyCriticalIndexes,
      timeout_ms: policy.timeoutMs,
    },
    'db.bootstrap.start'
  );

  const work = doBootstrapWork(policy, token, start);

  // Track the underlying work globally so overlap prevention works
  // even after a timeout causes the outer promise to reject early.
  const settled = work.then(
    () => {},
    () => {}
  );
  inflightWork = settled;
  settled.then(() => {
    if (inflightWork === settled) inflightWork = null;
  });

  try {
    await withTimeout(work, policy.timeoutMs, 'bootstrap', token);
  } catch (error) {
    // BootstrapError is already logged above — only log unexpected errors
    // (including timeouts, which now flow through this catch block).
    if (!(error instanceof BootstrapError)) {
      const durationMs = Math.round(performance.now() - start);
      console.error(
        `[bootstrap] failure env=${env} action=${token.action ?? 'unknown'} duration_ms=${durationMs}` +
          ` error=${error instanceof Error ? error.message : String(error)}`
      );
      log.error(
        {
          bootstrap_env: env,
          action: token.action ?? 'unknown',
          duration_ms: durationMs,
          err: error,
        },
        'db.bootstrap.failure'
      );
    }
    throw error;
  }
}

/**
 * The actual bootstrap work, separated from timeout/error handling so it
 * can be tracked independently. Checks `token.cancelled` after every async
 * boundary to suppress emissions from timed-out runs.
 */
async function doBootstrapWork(
  policy: BootstrapPolicy,
  token: { cancelled: boolean; action: string | undefined },
  start: number
): Promise<void> {
  const env = policy.environment;

  if (policy.syncIndexes) {
    token.action = 'sync';
    // Development: full sync for convenience — creates collections + indexes.
    await syncCollectionsAndIndexes();
    if (token.cancelled) return;
    const durationMs = Math.round(performance.now() - start);
    log.info(
      {
        bootstrap_env: env,
        action: 'sync',
        duration_ms: durationMs,
      },
      'db.bootstrap.success'
    );
    return;
  }

  // Production / staging: lightweight path — collections only, then verify.
  token.action = 'ensure_collections';
  await ensureCollections();
  if (token.cancelled) return;

  if (!policy.verifyCriticalIndexes) {
    const durationMs = Math.round(performance.now() - start);
    log.info(
      {
        bootstrap_env: env,
        action: 'ensure_collections',
        duration_ms: durationMs,
      },
      'db.bootstrap.success'
    );
    return;
  }

  token.action = 'verify';
  const result = await inspectIndexes();
  if (token.cancelled) return;
  const durationMs = Math.round(performance.now() - start);
  const totalMissing = result.diffs.reduce((sum, d) => sum + d.missing.length, 0);
  const totalMismatches = result.diffs.reduce((sum, d) => sum + d.optionMismatches.length, 0);
  const modelsChecked = result.diffs.length;

  if (result.ok) {
    log.info(
      {
        bootstrap_env: env,
        action: 'verify',
        duration_ms: durationMs,
        models_checked: modelsChecked,
        indexes_ok: true,
      },
      'db.bootstrap.success'
    );
    return;
  }

  // Build actionable details for every critical drift item.
  const details: string[] = [];
  for (const diff of result.diffs) {
    for (const m of diff.missing) {
      if (m.severity === 'critical') {
        details.push(`${diff.model} (${diff.collection}): missing index ${JSON.stringify(m.key)}`);
      }
    }
    for (const m of diff.optionMismatches) {
      if (m.severity === 'critical') {
        details.push(
          `${diff.model} (${diff.collection}): option mismatch on ${JSON.stringify(m.key)}` +
            ` — expected ${JSON.stringify(m.expected)}, actual ${JSON.stringify(m.actual)}`
        );
      }
    }
  }

  if (result.hasCriticalDrift) {
    if (policy.failOnCriticalDrift) {
      const message =
        `Runtime bootstrap [${env}]: ${details.length} critical index problem(s) detected.\n` +
        `Run "npm run db:sync" to fix before deploying.\n` +
        details.map((d) => `  • ${d}`).join('\n');
      const err = new BootstrapError(message, env, details);
      console.error(
        `[bootstrap] failure env=${env} action=verify duration_ms=${durationMs}` +
          ` missing=${totalMissing} mismatches=${totalMismatches} critical_drift=true`
      );
      log.error(
        {
          bootstrap_env: env,
          action: 'verify',
          duration_ms: durationMs,
          missing_indexes: totalMissing,
          option_mismatches: totalMismatches,
          critical_drift: true,
          details,
          err,
        },
        'db.bootstrap.failure'
      );
      throw err;
    }

    // Staging: warn but don't abort so preview deploys stay functional.
    console.warn(
      `[bootstrap] warning env=${env} action=verify duration_ms=${durationMs}` +
        ` missing=${totalMissing} mismatches=${totalMismatches} critical_drift=true`
    );
    for (const d of details) {
      console.warn(`[bootstrap] drift_detail ${d}`);
    }
    log.warn(
      {
        bootstrap_env: env,
        action: 'verify',
        duration_ms: durationMs,
        missing_indexes: totalMissing,
        option_mismatches: totalMismatches,
        critical_drift: true,
        details,
      },
      'db.bootstrap.warning'
    );
  } else {
    // Optional drift only — structured log captures advisory details.
    log.info(
      {
        bootstrap_env: env,
        action: 'verify',
        duration_ms: durationMs,
        models_checked: modelsChecked,
        indexes_ok: false,
        optional_drift: true,
        missing_indexes: totalMissing,
        option_mismatches: totalMismatches,
      },
      'db.bootstrap.success'
    );
  }
}

/**
 * Wrap a promise with a timeout that produces an actionable error.
 * When the timeout fires, `token.cancelled` is set so the underlying
 * work can check it and suppress stale emissions.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  token: { cancelled: boolean; action: string | undefined }
): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      token.cancelled = true;
      reject(
        new Error(
          `${label} timed out after ${ms}ms — possible causes: MongoDB connectivity issues, slow collection/index operations, or high cluster load`
        )
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Returns whether bootstrap has completed successfully. */
export function isBootstrapped(): boolean {
  return bootstrapped;
}

/** @internal Reset module state — test-only. Not part of the public API. */
export function __resetBootstrapForTests(): void {
  bootstrapped = false;
  bootstrapPromise = null;
  inflightWork = null;
}
