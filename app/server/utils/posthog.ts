import { PostHog } from 'posthog-node';
import { createExceptionThrottle } from '~/utils/exception-throttle';
import { resolveEnvironment } from '../db/policy';

let client: PostHog | null = null;

// A failing server function hit by a high-frequency mutation can otherwise
// emit one $exception per request; same semantics as the client-side hook.
const exceptionThrottle = createExceptionThrottle();

function getEnvironment(): string {
  return resolveEnvironment();
}

function getClient(): PostHog | null {
  if (client) return client;

  const apiKey = process.env.POSTHOG_KEY;
  const host = process.env.POSTHOG_HOST || 'https://app.posthog.com';

  if (!apiKey) return null;

  client = new PostHog(apiKey, { host, flushAt: 1, flushInterval: 0 });
  return client;
}

// Serverless functions freeze as soon as the response is sent, so queued
// capture() events are lost. captureImmediate() sends right away and the
// returned promise lets critical paths await delivery.
export async function serverCaptureException(
  error: unknown,
  distinctId?: string,
  properties?: Record<string, unknown>
): Promise<void> {
  const ph = getClient();
  if (!ph) return;

  const id = distinctId ?? 'server';
  const err = error instanceof Error ? error : new Error(String(error));

  const key = `${err.constructor.name}:${err.message}`.slice(0, 200);
  const decision = exceptionThrottle.check(key, Date.now());
  if (!decision.capture) return;

  try {
    await ph.captureImmediate({
      distinctId: id,
      event: '$exception',
      properties: {
        $exception_message: err.message,
        $exception_type: err.constructor.name,
        $exception_stack_trace_raw: err.stack,
        environment: getEnvironment(),
        base_url: process.env.BASE_URL ?? 'unknown',
        recurrence_count: decision.occurrences,
        ...(decision.capped && { exception_throttle_capped: true }),
        ...properties,
      },
    });
  } catch {
    // analytics must never break the app
  }
}

export async function serverCaptureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): Promise<void> {
  const ph = getClient();
  if (!ph) return;
  try {
    await ph.captureImmediate({
      distinctId,
      event,
      properties: {
        environment: getEnvironment(),
        base_url: process.env.BASE_URL ?? 'unknown',
        ...properties,
      },
    });
  } catch {
    // analytics must never break the app
  }
}

export async function shutdownPostHog(): Promise<void> {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
