// app/routes/healthz.ts — TanStack Start server route (no component)
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/healthz')({
  server: {
    handlers: {
      GET: () => Response.json({ status: 'ok' }),
    },
  },
});
