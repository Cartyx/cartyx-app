/**
 * Stand-in for `~/lib/audio-rate-limits` in Storybook.
 *
 * WHY THIS EXISTS. That module lives under `app/lib/`, not `app/server/`, so
 * the `~/server/**` alias in `main.ts` does not catch it — but it is
 * server-only all the same: every reference to its exports, in both server-fn
 * wrapper modules, sits inside a `.handler()` body that the TanStack Start
 * plugin strips before the client build runs, after which Rollup drops the
 * module entirely (verified after `npm run build`: zero occurrences of
 * `AUDIO_INGEST_RATE_LIMIT_CAPACITY` or `rateLimitMessage`'s message fragment
 * anywhere under `.output/public`).
 *
 * Storybook deliberately does NOT run that plugin (see
 * ../vite.config.ts), so handler bodies survive, the module is reachable from
 * `AudioUploadDropzone` -> `~/utils/uploadAudio` -> `~/utils/audio-server-fns`,
 * and it really is evaluated in a browser. It reads `process.env[...]` at
 * module scope — a COMPUTED member access, which Vite's `define` cannot
 * rewrite — so evaluating it in the preview throws `ReferenceError: process is
 * not defined` at import time and takes the whole story file down with it.
 * That is the exact failure `~/lib/audio-rate-limits`' own module comment
 * predicts for a browser; the app bundle is safe from it, the Storybook bundle
 * is not.
 *
 * Aliasing here rather than guarding the source keeps that prediction true:
 * a `typeof process` check in the real module would make an accidental
 * client-bundling of it silent instead of loud.
 *
 * Every export of the real module is reproduced, whether or not a story can
 * reach it today — a missing name fails the preview build with `"<name>" is
 * not exported by …`, which is loud and self-describing, but only after
 * someone hits it. Limiters here are objects with a throwing `check`, not
 * no-ops that return `{ allowed: true }`: nothing in a story should ever
 * consult a rate limiter (handler bodies never execute — `createServerFn` is
 * itself mocked, see ./react-start.ts), so reaching one means a story is doing
 * something Storybook cannot honestly answer.
 */

function unavailable(name: string) {
  return () => {
    throw new Error(
      `Storybook: rate limiter "${name}" was consulted. Limiters are server-only ` +
        `state — stories never execute a server-fn handler, so reaching one means ` +
        `the component is calling server code directly. Pass the data in as a prop.`
    );
  };
}

/** `RateLimiter` (`~/lib/rate-limit`) has exactly one method: `check`. */
function limiter(name: string) {
  return { check: unavailable(name) };
}

export const audioIngestLimiter = limiter('audioIngestLimiter');
export const packageWriteLimiter = limiter('packageWriteLimiter');
export const boardStateLimiter = limiter('boardStateLimiter');
export const libraryMutationLimiter = limiter('libraryMutationLimiter');
export const orphanCleanupLimiter = limiter('orphanCleanupLimiter');

/**
 * Pure string formatting with no environment dependency — reproduced verbatim
 * rather than stubbed, so a story that ever renders a rate-limit message shows
 * the real copy instead of a throw.
 */
export function rateLimitMessage(action: string, retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Too many ${action} requests. Try again in ${seconds}s.`;
}
