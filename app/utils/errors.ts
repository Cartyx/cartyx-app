/**
 * Normalize an unknown error into a user-displayable message.
 *
 * - `null`/`undefined` (and other falsy values) → `null` (no error)
 * - `Error` instances → their `.message`
 * - anything else truthy → `String(error)`
 *
 * This is the shared implementation used by the query/mutation hooks, which
 * previously inlined this logic in two equivalent forms.
 */
export function extractErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return String(error);
}
