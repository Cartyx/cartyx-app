/**
 * The one identity a stale-package-write refusal is recognised by, shared by
 * the server that throws it and the browser that has to react to it.
 *
 * WHY A NAME AND NOT `instanceof`. `updatePackage` throws a real
 * `PackageStaleWriteError` (`~/server/functions/packages`), but that class
 * only exists on the server — `~/server/functions/packages` is reached solely
 * through `await import(...)` inside a `.handler()` body and never enters the
 * client bundle, which is exactly the constraint that keeps mongoose out of
 * the browser. So the browser cannot `instanceof` it.
 *
 * What it CAN do is read `.name`. A server-fn rejection is serialized with
 * seroval (`@tanstack/start-server-core`'s `handleServerAction` calls
 * `toCrossJSONAsync` on the thrown value) and seroval's error encoder keeps
 * `message`, keeps `name` whenever it differs from the base constructor's,
 * and copies every own property across; the client then rethrows the
 * reconstructed value (`serverFnFetcher`'s `if (result instanceof Error)
 * throw result`). What arrives in the browser is therefore a plain `Error`
 * carrying OUR `name` and OUR `currentUpdatedAt` — not our class. Under SSR,
 * where the handler is invoked directly with no serialization at all, the
 * genuine instance arrives instead; `.name` is the one discriminator true of
 * both.
 *
 * This is a NAME check, not a message check. The message is user-facing copy
 * and will be reworded; the name is the contract. `~/utils/error-
 * classification.ts` already keys on `error.name === 'TimeoutError'` for the
 * same reason.
 */
export const PACKAGE_STALE_WRITE_ERROR_NAME = 'PackageStaleWriteError';

/**
 * A stale-write refusal as the BROWSER sees it: an `Error` whose `name` is
 * the sentinel above, plus the server's current `updatedAt` for the document
 * the caller tried to overwrite.
 *
 * `currentUpdatedAt` is optional here and not on the server class, because
 * this type describes a value that crossed a wire — a client built against an
 * older server, or a future serializer that drops extra properties, would
 * still produce a recognisable refusal with the field missing. Callers must
 * treat it as "may be absent", never assert it.
 */
export type StalePackageWriteError = Error & { currentUpdatedAt?: string };

/**
 * True when a rejection from `updatePackageFn` is the optimistic-concurrency
 * refusal — the caller's `expectedUpdatedAt` did not match the stored
 * document, so the write was refused rather than applied over somebody
 * else's.
 *
 * Deliberately distinguishable from the sibling refusal it would otherwise be
 * confused with: `updatePackage` throws a plain `PackageClientError('Package
 * not found')` when the id does not resolve for this owner, and that one
 * returns `false` here. The two mean opposite things to a user — "this is
 * gone / not yours" versus "this is here and newer than you think" — and the
 * editor offers completely different affordances for each.
 */
export function isStalePackageWriteError(error: unknown): error is StalePackageWriteError {
  return error instanceof Error && error.name === PACKAGE_STALE_WRITE_ERROR_NAME;
}
