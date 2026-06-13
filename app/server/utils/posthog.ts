import { PostHog } from 'posthog-node';

let client: PostHog | null = null;

function getEnvironment(): string {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV; // 'production', 'preview', 'development'
  if (process.env.VERCEL) return 'vercel';
  return process.env.NODE_ENV ?? 'unknown';
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
