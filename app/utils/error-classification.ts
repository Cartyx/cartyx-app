/**
 * Classifies failures for the backend circuit breaker and retry policy.
 *
 * Only *infrastructure* failures (the network or the server process is
 * unhealthy) count toward tripping the breaker and are worth retrying.
 * Application errors thrown by server-fn code (validation, not-found, auth)
 * cannot heal on retry and must never trip the breaker.
 */

/** Thrown by guarded callers when the circuit breaker is open. */
export class BackendUnavailableError extends Error {
  constructor() {
    super('Backend temporarily unavailable — reconnecting');
    this.name = 'BackendUnavailableError';
  }
}

const NETWORK_ERROR_PATTERN = /failed to fetch|load failed|networkerror/i;

export function isInfrastructureFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof BackendUnavailableError) return false;
  if (error instanceof TypeError && NETWORK_ERROR_PATTERN.test(error.message)) return true;
  if (error.name === 'TimeoutError') return true;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && status >= 500) return true;
  return false;
}
