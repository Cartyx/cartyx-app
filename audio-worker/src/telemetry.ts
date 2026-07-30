import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';

/**
 * Error reporting to GlitchTip, matching CLAUDE.md's telemetry convention:
 * errors go to GlitchTip, and the wrapper is a safe no-op when its env var is
 * absent (local dev, CI, tests).
 *
 * Every other part of this repo reports there — the whole app server wraps its
 * server functions in `serverCaptureException` — so a worker that only writes
 * pino lines is invisible in the one tool the team actually watches. The design
 * doc's own risk note ("a silently failing worker is the most likely way this
 * feature rots") is exactly this.
 *
 * Hand-rolled against Sentry's store endpoint rather than pulling in
 * `@sentry/node`: the worker image ships three runtime dependencies today, the
 * house rule puts a 7-10 day cooldown on any new one, and the entire surface
 * needed here is one POST of one JSON document. The app server keeps using the
 * real SDK — its needs (breadcrumbs, tracing, request context) are not these.
 */

type Dsn = { url: string; key: string };

/**
 * Split `https://<publicKey>@<host>/<projectId>` into the store URL and the
 * auth key. Returns null for anything malformed, which is treated exactly like
 * an absent DSN — a typo'd DSN must degrade to "no telemetry", never to a
 * crash in the error path of the thing that was already failing.
 */
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const parsed = new URL(dsn);
    const projectId = parsed.pathname.replace(/^\/+/, '');
    if (!parsed.username || !projectId) return null;
    return {
      url: `${parsed.protocol}//${parsed.host}/api/${projectId}/store/`,
      key: parsed.username,
    };
  } catch {
    return null;
  }
}

/** The Sentry-protocol event body GlitchTip ingests. */
export function buildEvent(
  error: unknown,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    event_id: randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: 'error',
    logger: 'audio-worker',
    server_name: process.env.HOSTNAME ?? 'audio-worker',
    environment: process.env.APP_ENV ?? 'development',
    exception: {
      values: [{ type: err.name, value: err.message }],
    },
    extra: { ...extra, stack: err.stack },
  };
}

/**
 * Report an error. NEVER awaited by callers and never throws: the POST is
 * started and abandoned, with its own 2s deadline, so a slow or unreachable
 * GlitchTip cannot add latency to — let alone wedge — the processing loop.
 * That is the same contract the app server's wrappers keep, and it matters
 * more here: this worker is one sequential loop, so anything that blocks in an
 * error path blocks every other user's queue.
 */
export function captureException(error: unknown, extra?: Record<string, unknown>): void {
  const dsn = parseDsn(process.env.GLITCHTIP_DSN);
  if (!dsn) return;

  void fetch(dsn.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=cartyx-audio-worker/1.0`,
    },
    body: JSON.stringify(buildEvent(error, extra)),
    signal: AbortSignal.timeout(2000),
  }).catch((err: unknown) => {
    // Reporting a failure must not become a second failure.
    logger.warn({ err }, 'glitchtip report failed');
  });
}
