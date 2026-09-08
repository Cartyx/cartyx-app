import { PACKAGE_STALE_WRITE_ERROR_NAME } from '~/lib/soundboard/stale-write';

/**
 * The names of every "the caller's own doing" error class on the audio and
 * soundboard surface, and the one predicate the browser recognises them by.
 *
 * WHY THIS EXISTS AS ONE MODULE RATHER THAN A CHECK PER PAGE. The server goes
 * to real lengths to keep these refusals — over quota, over the pending-job
 * cap, rate-limited, a not-found on a caller-supplied id, a stale package
 * write — out of GlitchTip. `AudioClientError`, `PackageClientError` and
 * `SoundboardClientError` exist for that single purpose, and
 * `reportAudioError`/`reportPackageError` exclude them. The reasoning is that
 * a refusal reachable at will by the caller makes report volume the caller's
 * own parameter.
 *
 * That reasoning does not stop at the wire, and the client side of it was
 * open at ELEVEN call sites: every `onError: (e) => captureException(e, ...)`
 * on `/audio` and `/audio/packages`, plus the board's own save handler. A GM
 * sitting at their storage quota filed one client error per upload attempt; a
 * folder drop that met the job cap filed one per refused file; a bulk retag
 * that met the library bucket filed one per click. Each was the same control,
 * applied on the server and left open on the browser.
 *
 * So the rule is expressed once, over the whole surface, rather than per
 * endpoint — because the per-endpoint version is what produced eleven of
 * them.
 *
 * WHY NAMES AND NOT `instanceof`. Every one of these classes is defined in a
 * `~/server/functions/*` module reached only through `await import(...)`
 * inside a `.handler()` body, which is exactly the constraint that keeps
 * mongoose out of the browser — so the browser never has the constructor.
 * What it does have is `.name`: seroval keeps it across the wire whenever it
 * differs from the base constructor's, and under SSR the genuine instance
 * arrives anyway. `~/lib/soundboard/stale-write.ts` makes the same argument
 * at more length for the one refusal that also carries a payload.
 *
 * This module must stay import-free apart from `stale-write` (itself
 * import-free): it is in the static import graph of client-bundled routes, so
 * anything reaching mongoose or `@sentry/node` added here breaks
 * `npm run build` rather than `typecheck`/`lint`/`test`. The
 * `check:client-bundle` CI job is what notices.
 */
export const AUDIO_CLIENT_ERROR_NAME = 'AudioClientError';
export const PACKAGE_CLIENT_ERROR_NAME = 'PackageClientError';
export const SOUNDBOARD_CLIENT_ERROR_NAME = 'SoundboardClientError';

/**
 * `PackageStaleWriteError` is a `PackageClientError` SUBCLASS on the server —
 * `reportPackageError` already files nothing for it — but it overrides
 * `name`, so a check on the three names above would miss it. It is listed
 * explicitly for that reason.
 *
 * Note this is about TELEMETRY only. The editor still tells a stale write
 * apart from every other refusal via `isStalePackageWriteError`, because it
 * has to offer a completely different affordance for it. Being quiet and
 * being indistinguishable are different things.
 */
const REFUSAL_NAMES: ReadonlySet<string> = new Set([
  AUDIO_CLIENT_ERROR_NAME,
  PACKAGE_CLIENT_ERROR_NAME,
  SOUNDBOARD_CLIENT_ERROR_NAME,
  PACKAGE_STALE_WRITE_ERROR_NAME,
]);

/**
 * True when a rejection is a REFUSAL — a control doing its job — rather than
 * a FAULT.
 *
 * Use it to gate `captureException`, never to gate what the user sees: a
 * refusal still has to be rendered, and every call site that uses this keeps
 * setting its error state exactly as before. The only thing suppressed is the
 * fault report.
 *
 * A new server-side client-error class needs its name added here, or its
 * refusals resume filing one GlitchTip event per occurrence at whatever rate
 * the caller chooses.
 */
export function isClientRefusal(error: unknown): boolean {
  return error instanceof Error && REFUSAL_NAMES.has(error.name);
}
