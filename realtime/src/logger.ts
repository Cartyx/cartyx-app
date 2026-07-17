import pino from 'pino';

/**
 * Structured logging for the realtime service.
 *
 * Writes JSON to stdout — in k8s that IS the log file. The cluster scraper
 * ships pod stdout to VictoriaLogs, queried via Grafana Explore
 * (see docs/observability.md). Deliberately transport-free: a file transport
 * would write container-local files nothing scrapes, and a worker-thread
 * transport breaks under bundling.
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
  base: { service: 'realtime' },
});
