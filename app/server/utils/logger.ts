import pino from 'pino';

/**
 * Server-side structured logging.
 *
 * SERVER ONLY — must never reach the client bundle. Writes JSON to stdout,
 * which the cluster scraper ships to VictoriaLogs (docs/observability.md).
 * Transport-free on purpose: worker-thread transports break under the
 * Nitro/Vite SSR bundle.
 */
// Duplicated in the sibling service's logger — realtime/ is a separate build
// unit (rootDir: src, no workspaces), so it cannot import from app/.
// tests/server/utils/redact-parity.test.ts fails if the two lists drift.
export const REDACT_PATHS = [
  'sessionId',
  '*.sessionId',
  'userName',
  '*.userName',
  'characterName',
  '*.characterName',
  'character',
  '*.character',
  'title',
  '*.title',
  'text',
  '*.text',
  'body',
  '*.body',
];

function resolveLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  if (process.env.NODE_ENV === 'test') return 'silent';
  if (process.env.NODE_ENV === 'development') return 'warn';
  return 'info';
}

export const log = pino({
  level: resolveLevel(),
  redact: REDACT_PATHS,
  base: { service: 'web' },
});

/**
 * Wraps a server function with uniform logging: error-on-throw with the
 * function name, plus a debug-level duration line. The policy is uniform so
 * there are no per-function judgment calls.
 */
export const withLogging = <T extends (...a: never[]) => Promise<unknown>>(
  name: string,
  fn: T
): T =>
  (async (...args: never[]) => {
    const start = performance.now();
    try {
      return await fn(...args);
    } catch (err) {
      log.error({ fn: name, err }, 'server fn failed');
      throw err;
    } finally {
      log.debug({ fn: name, ms: Math.round(performance.now() - start) }, 'server fn done');
    }
  }) as T;
