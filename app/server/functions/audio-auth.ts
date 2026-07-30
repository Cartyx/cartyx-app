/**
 * Resolves the acting user for the audio ingest HTTP API.
 *
 * Cartyx has no personal-access-token concept yet — authentication is session
 * cookies only. Phase 3 (`ai-sound-generator`) owns issuing, hashing, scoping
 * and revoking tokens. Until then this rejects every bearer token, so the
 * routes exist and are shaped correctly without shipping an unauthenticated
 * write path.
 */
export async function resolveApiUser(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  // Phase 3: look the token up by hash and return its owner's **User document
  // Mongo `_id`** — NOT the OAuth provider id from the session. `AudioAsset.
  // ownerId` is an ObjectId ref to `User`, so handing the provider id to
  // `AudioAsset.find`/`.create` throws a CastError on every call, for every
  // user. That exact confusion produced this branch's worst bug; the browser
  // adapter resolves it explicitly in `requireUserId`
  // (`app/utils/audio-server-fns.ts`) and this must return the same kind of
  // value.
  return null;
}
