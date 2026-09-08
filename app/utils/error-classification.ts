/**
 * Classifies failures for the backend circuit breaker and retry policy.
 *
 * Only *infrastructure* failures (the network or the server process is
 * unhealthy) count toward tripping the breaker and are worth retrying.
 * Application errors thrown by server-fn code (validation, not-found, auth)
 * cannot heal on retry and must never trip the breaker.
 *
 * Server-fn errors cross the wire as plain `Error`s — the CLASS does not
 * survive, so nothing here may use `instanceof` on a server-thrown value.
 * Its `name` and its own properties do survive: seroval's error encoder
 * copies every own property across (`stack` excepted, behind a feature
 * flag), which is what lets `~/lib/soundboard/stale-write.ts` read
 * `currentUpdatedAt` and `~/lib/client-refusal.ts` key on `name`.
 *
 * An earlier version of this comment claimed the opposite — that own props
 * are dropped, so `Object.assign(new Error(...), { status: 503 })` arrives
 * with only `name`/`message` — and concluded that the `status >= 500` branch
 * below "only ever fires for errors constructed client-side, never for ones
 * that came back through a server function." Both halves were wrong, and the
 * conclusion is the dangerous one: a server-thrown error carrying `status`
 * DOES reach that branch and can trip the breaker. Nothing in this codebase
 * throws one today, so this is a correction to the reasoning rather than to
 * the behaviour — but the two files above depend on the true version, and a
 * reader who reconciled them in the direction of this paragraph would
 * silently break both.
 *
 * Message patterns are still the primary classifier for server-thrown
 * failures, because the failures that matter here (proxy responses, driver
 * faults) arrive as bare `Error`s with nothing but text.
 */

/** Thrown by guarded callers when the circuit breaker is open. */
export class BackendUnavailableError extends Error {
  constructor() {
    super('Backend temporarily unavailable — reconnecting');
    this.name = 'BackendUnavailableError';
  }
}

const NETWORK_ERROR_PATTERN = /failed to fetch|load failed|networkerror/i;

/**
 * Message patterns for infrastructure failures that can arrive as plain
 * `Error`s — i.e. without a `status` we can check — because they crossed a
 * boundary that discards it:
 *  - the TanStack start-client-core server-fn fetcher deserializes a 500 into
 *    a plain rethrown Error, and a non-serialized proxy/platform response
 *    (nginx/ALB/Cloudflare) arrives as `new Error(await response.text())`;
 *  - a deploy in progress can make the client reference a server-fn manifest
 *    entry that no longer exists on the new deployment;
 *  - the Mongo driver can throw mid-query on a disconnect without the
 *    server-fn layer having a chance to tag `status` on it;
 *  - our own DB-layer guards (health.ts, oauth.ts upsertUser) throw
 *    "database not connected" messages when the connection is down.
 *  - a mid-session Mongo disconnect surfaces as mongoose command-buffering
 *    timeouts, driver `MongoNetworkError`/`PoolClearedError` drops, or
 *    "MongoClient must be connected" guard messages;
 *  - Vercel's platform-level failures (as opposed to our own handler code)
 *    arrive as `FUNCTION_INVOCATION_FAILED`/`FUNCTION_INVOCATION_TIMEOUT`
 *    error bodies. The generic "A server error has occurred" text Vercel
 *    pairs with those codes is deliberately NOT matched on its own — it's
 *    too generic and would false-positive on unrelated app copy.
 */
const TRANSPORT_ERROR_PATTERN =
  /502 bad gateway|503 service unavailable|504 gateway time-?out|gateway timeout|server function info not found|server selection timed out|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|socket hang up|topology .*(closed|destroyed)|database not connected|buffering timed out|connection \d+ to .* closed|pool .*(was )?cleared|client must be connected|FUNCTION_INVOCATION_FAILED|FUNCTION_INVOCATION_TIMEOUT/i;

export function isInfrastructureFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof BackendUnavailableError) return false;
  if (error instanceof TypeError && NETWORK_ERROR_PATTERN.test(error.message)) return true;
  if (error.name === 'TimeoutError') return true;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && status >= 500) return true;
  if (TRANSPORT_ERROR_PATTERN.test(error.message)) return true;
  return false;
}
