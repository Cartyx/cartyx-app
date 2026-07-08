// app/routes/readyz.ts
import { createFileRoute } from '@tanstack/react-router';
import { healthCheck } from '~/server/functions/health';

const READYZ_TIMEOUT_MS = 2_000;

async function readyz(): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      healthCheck(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('readyz timeout')), READYZ_TIMEOUT_MS);
      }),
    ]);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

export const Route = createFileRoute('/readyz')({
  server: {
    handlers: {
      GET: () => readyz(),
    },
  },
});
