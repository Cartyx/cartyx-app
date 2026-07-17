import { captureEvent } from '~/utils/telemetry-client';
import { isBackendDown, reportBackendFailure, whenBackendUp } from '~/utils/backend-health';
import { isInfrastructureFailure } from '~/utils/error-classification';

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const JITTER_RATIO = 0.2;
const MAX_RETRIES = 12;
/**
 * Upper bound on how long withRetry will wait for the circuit breaker to
 * recover before giving up. Without this, a prolonged outage would await
 * whenBackendUp() forever, silently stranding the save (and the user) with
 * no feedback that their message was never persisted.
 */
const BREAKER_WAIT_MAX_MS = 120_000;

export interface RetryContext {
  sessionId: string;
  campaignId: string;
  messageType: 'CHAT' | 'DICE' | 'SPELL_CARD';
  messageId: string;
}

export type OnRetriesExhausted = (context: RetryContext, error: unknown) => void;

/** Exponential backoff with ±20% jitter so retries from many clients desynchronize. */
function retryDelayMs(attempt: number): number {
  const base = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
  const jitterFactor = 1 + (Math.random() * 2 - 1) * JITTER_RATIO;
  return Math.round(base * jitterFactor);
}

function exhaust(
  context: RetryContext,
  err: unknown,
  onExhausted: OnRetriesExhausted | undefined
): null {
  captureEvent('party.mongo_save_failed', {
    sessionId: context.sessionId,
    campaignId: context.campaignId,
    messageType: context.messageType,
    messageId: context.messageId,
    errorMessage: err instanceof Error ? err.message : String(err),
    errorName: err instanceof Error ? err.name : undefined,
  });

  onExhausted?.(context, err);
  return null;
}

/**
 * Races whenBackendUp() against BREAKER_WAIT_MAX_MS. If the deadline wins,
 * resolves 'timeout'; a whenBackendUp() that settles later is ignored
 * (guarded by `settled`) so a stale wait can't resume a loop that already
 * exhausted.
 */
function raceBreakerWait(): Promise<'up' | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false;
    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve('timeout');
    }, BREAKER_WAIT_MAX_MS);
    whenBackendUp().then(() => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve('up');
    });
  });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  context: RetryContext,
  onExhausted?: OnRetriesExhausted
): Promise<T | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // While the circuit breaker is open, sending the request is pointless —
    // wait for recovery instead of burning an attempt against a dead backend.
    // Cap the wait so a prolonged outage can't strand the save (and the
    // user) forever with no feedback.
    if (isBackendDown()) {
      const outcome = await raceBreakerWait();
      if (outcome === 'timeout') {
        return exhaust(
          context,
          new Error(`Backend still unavailable after ${BREAKER_WAIT_MAX_MS}ms; giving up`),
          onExhausted
        );
      }
    }
    try {
      return await fn();
    } catch (err) {
      reportBackendFailure(err);

      // Application errors (validation, not-found, auth, ...) cannot heal on
      // retry — burning the backoff schedule on them only delays the
      // inevitable failure. Go straight to the exhaustion path.
      if (!isInfrastructureFailure(err)) {
        return exhaust(context, err, onExhausted);
      }

      if (attempt === MAX_RETRIES) {
        return exhaust(context, err, onExhausted);
      }

      const delay = retryDelayMs(attempt);

      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return null;
}
