import { captureEvent } from '~/utils/posthog-client';
import { isBackendDown, whenBackendUp } from '~/utils/backend-health';

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const JITTER_RATIO = 0.2;
const MAX_RETRIES = 12;

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

export async function withRetry<T>(
  fn: () => Promise<T>,
  context: RetryContext,
  onExhausted?: OnRetriesExhausted
): Promise<T | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // While the circuit breaker is open, sending the request is pointless —
    // wait for recovery instead of burning an attempt against a dead backend.
    if (isBackendDown()) await whenBackendUp();
    try {
      return await fn();
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error(
          `[Save] Failed after ${MAX_RETRIES} retries`,
          context.messageType,
          context.messageId,
          err
        );

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

      const delay = retryDelayMs(attempt);
      console.warn(
        `[Save] Attempt ${attempt + 1} failed, retrying in ${delay}ms`,
        context.messageType,
        context.messageId
      );

      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return null;
}
