/**
 * Resolves the browser session's OAuth provider id to this app's Mongo
 * `User._id` — shared by every `~/utils/*-server-fns.ts` wrapper module that
 * needs `{ userId, sessionUserId }` before touching a query. `userId` (the
 * Mongo `_id`) is the only value that may scope a query; `sessionUserId`
 * (the OAuth provider id) is telemetry-only. Phase 1 shipped the provider id
 * into a query and every call CastError'd — see the `Actor` type in
 * `~/server/functions/audio.ts` for the full identity-split rationale.
 *
 * THIS FUNCTION MUST NEVER BE STATICALLY EXPORTED FROM, OR STATICALLY
 * IMPORTED INTO, A MODULE THAT IS ITSELF REACHABLE FROM THE CLIENT BUNDLE.
 *
 * It previously lived as a module-private helper inside
 * `~/utils/audio-server-fns.ts`, referenced only from inside `.handler()`
 * bodies — which TanStack Start strips from the client bundle, so the
 * function (and its dynamic `import('~/server/session')` chain) was
 * effectively dead code on the client and never bundled. When Task 7 shared
 * it for `~/utils/soundboard-server-fns.ts` by adding a plain `export` to it
 * and a static `import { requireActor } from '~/utils/audio-server-fns'` at
 * the top of the soundboard file, that static import edge made the function
 * reachable from the client's module graph OUTSIDE any `.handler()` body —
 * the bundler no longer knew it was only ever called from inside one, so it
 * kept the whole chunk live, including its `~/server/session` import chain
 * (mongoose, `@sentry/node`). The client build then failed trying to bundle
 * server-only Node internals for the browser:
 * `"subscribe" is not exported by "__vite-browser-external"` from
 * `@sentry/node-core/.../httpServerIntegration.js`. `npm run typecheck`,
 * `npm run lint`, and the unit suite all stayed green throughout — none of
 * them run a client bundle build, so this class of regression is caught only
 * by `npm run build` (or an equivalent client-bundle-producing check).
 *
 * The fix: this function lives in its own module, and BOTH
 * `audio-server-fns.ts` and `soundboard-server-fns.ts` reach it via a
 * dynamic `await import('~/utils/require-actor')` INSIDE each `.handler()`
 * body — never a module-scope `import`. With no static import edge pointing
 * at this module from anywhere, it has no path into the client's module
 * graph at all, so its own internal dynamic imports of `~/server/session`
 * (below) never become a client-bundle liability either. If a third wrapper
 * module ever needs this, it must do the same: dynamic import, inside the
 * handler, never at module scope — and this module must never gain a
 * consumer that imports it any other way.
 */
export async function requireActor(): Promise<{ userId: string; sessionUserId: string }> {
  const { getSession } = await import('~/server/session');
  const { connectDB } = await import('~/server/db/connection');
  const { User } = await import('~/server/db/models/User');
  const session = await getSession();
  if (!session) throw new Error('Not authenticated');
  await connectDB();
  const dbUser = await User.findOne({ providerId: session.id }).select('_id').lean();
  if (!dbUser) throw new Error('User not found');
  return { userId: String(dbUser._id), sessionUserId: session.id };
}
