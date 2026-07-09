/**
 * Runtime bootstrap policy — defines environment-aware startup behavior.
 *
 * Each deployment environment gets a policy that controls what bootstrap
 * does on startup: lightweight verification only (production), verification
 * with warnings (staging/preview), or full collection + index sync
 * (development).
 *
 * ## Environment detection
 *
 * Resolution order (first match wins):
 * 1. `APP_ENV` — explicit (`production`, `staging`, `development`)
 * 2. `NODE_ENV` — `production` maps to production; everything else → development
 *
 * ## Policy summary
 *
 * | Environment | Collections | Indexes | Critical check | Failure mode |
 * |-------------|-------------|---------|----------------|--------------|
 * | production  | ensure      | —       | yes            | abort        |
 * | staging     | ensure      | —       | yes            | warn         |
 * | development | ensure      | sync    | —              | —            |
 */

export type BootstrapEnvironment = 'production' | 'staging' | 'development';

export interface BootstrapPolicy {
  /** Environment name for logging and diagnostics. */
  environment: BootstrapEnvironment;
  /** Create missing indexes on startup (heavy — development only). */
  syncIndexes: boolean;
  /** Check that critical indexes exist after ensuring collections. */
  verifyCriticalIndexes: boolean;
  /** Abort startup when critical drift is detected. */
  failOnCriticalDrift: boolean;
  /** Mongoose autoIndex setting passed to the connection. */
  autoIndex: boolean;
  /** Maximum time (ms) for the entire bootstrap phase. 0 = no limit. */
  timeoutMs: number;
}

const POLICIES: Record<BootstrapEnvironment, BootstrapPolicy> = {
  production: {
    environment: 'production',
    syncIndexes: false,
    verifyCriticalIndexes: true,
    failOnCriticalDrift: true,
    autoIndex: false,
    timeoutMs: 10_000,
  },
  staging: {
    environment: 'staging',
    syncIndexes: false,
    verifyCriticalIndexes: true,
    failOnCriticalDrift: false,
    autoIndex: false,
    timeoutMs: 15_000,
  },
  development: {
    environment: 'development',
    syncIndexes: true,
    verifyCriticalIndexes: false,
    failOnCriticalDrift: false,
    autoIndex: true,
    timeoutMs: 30_000,
  },
};

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

/** Return the bootstrap policy for the given (or auto-detected) environment. */
export function getBootstrapPolicy(env?: BootstrapEnvironment): BootstrapPolicy {
  return POLICIES[env ?? resolveEnvironment()];
}
