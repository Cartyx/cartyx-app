import crypto from 'node:crypto';
import { User } from '../db/models/User';

/**
 * The R2 key layout for audio, and the per-user namespace that makes it
 * owner-scoped.
 *
 * THE LAYOUT
 * ----------
 *   source:    uploads/audio/<prefix>/<timestamp>-<random>.<ext>
 *   rendition: uploads/audio/<prefix>/renditions/<assetId>.<opus|m4a>
 *
 * `<prefix>` is 32 lowercase hex characters (128 random bits) stored on the
 * User document as `audioStoragePrefix`. Everything a given user owns lives
 * under `uploads/audio/<prefix>/` and nothing else does.
 *
 * WHY A NAMESPACE AT ALL
 * ----------------------
 * The previous layout was flat — `uploads/audio/<timestamp>-<random>.<ext>` —
 * so a key carried no owner, and the only record of a source key was the asset
 * row itself. `deleteAudioAsset` deletes from R2 best-effort and drops the row
 * regardless, so a failed R2 delete destroyed the only reference to a live
 * object: nothing could ever name it again, and a bucket listing could not
 * attribute it to anyone, so it could not be reclaimed by any authority
 * narrower than "list the whole bucket". With this layout the listing itself
 * is the attribution.
 *
 * WHY RANDOM AND NOT THE OWNER ID
 * -------------------------------
 * The key IS the public URL: `publicUrl = ${cdnUrl}/${key}`, and the phase-2
 * board hands those URLs to players' browsers. A path segment containing the
 * owner's Mongo `_id` would mean anyone holding one shared track URL could
 * correlate every other track that user has ever published, and could probe
 * for them. 128 bits of `randomBytes` is not guessable and says nothing about
 * who owns it. The tradeoff is that the prefix must be STORED rather than
 * derived, which is what `resolveAudioStoragePrefix` below is for.
 *
 * An HMAC of the owner id under a server secret was the other candidate — no
 * storage, still unguessable. Rejected: it makes every object in the bucket
 * hostage to one secret. Rotating or losing `SESSION_SECRET`-style material
 * would silently re-point every user's namespace and strand the entire
 * library, with no record anywhere of where the old objects went. A stored
 * value can be read back; a derived one cannot be recovered.
 *
 * WHY IT LIVES ON THE USER DOCUMENT
 * ---------------------------------
 * It is a property of the user, not of any one asset: every asset must land in
 * the same namespace or the listing stops being complete. Storing it per-asset
 * would make "the user's namespace" a thing you reconstruct from rows, which
 * is precisely the reconstruction this change exists to remove. A separate
 * collection would add a lookup and a second lifetime to keep in step with the
 * User's for no gain — the audio path already resolves the User document to
 * get the Mongo `_id` it scopes queries by.
 */

/** Every audio object in the bucket lives under this. */
export const AUDIO_KEY_ROOT = 'uploads/audio/';

/** Bytes of randomness per prefix; 16 bytes = 32 hex characters = 128 bits. */
const PREFIX_BYTES = 16;

/**
 * A minted prefix, exactly.
 *
 * MIRRORED in `audio-worker/src/keys.ts` (`STORAGE_PREFIX_RE`), which parses
 * the prefix back out of a source key to decide where to put renditions. The
 * worker is a separate package with its own tsconfig and cannot import this
 * file; `tests/server/functions/audio-storage.test.ts` and
 * `audio-worker/tests/keys.test.ts` each pin the shape so a change on one side
 * fails on that side rather than silently producing keys the other rejects.
 */
export const AUDIO_STORAGE_PREFIX_RE = /^[0-9a-f]{32}$/;

/** The listing prefix for one user's entire audio namespace. */
export function audioUserRoot(storagePrefix: string): string {
  assertStoragePrefix(storagePrefix);
  return `${AUDIO_KEY_ROOT}${storagePrefix}/`;
}

/**
 * Fail closed rather than mint a key outside the namespace.
 *
 * Every key builder runs this first. A caller that passed `''`, `undefined`
 * coerced to a string, or anything containing a `/` would otherwise write an
 * object that no owner's listing covers — unreclaimable in exactly the way
 * this whole change exists to prevent — or, with a `../`-shaped value, into
 * another user's namespace.
 */
export function assertStoragePrefix(storagePrefix: string): void {
  if (!AUDIO_STORAGE_PREFIX_RE.test(storagePrefix)) {
    throw new Error('Invalid audio storage prefix');
  }
}

/**
 * The prefix for a user, minting and persisting one on first use.
 *
 * Two properties matter and both are enforced by the write itself rather than
 * by reading first and hoping:
 *
 * - **Stability.** The `$set` is conditional on the field being absent/null, so
 *   a second concurrent uploader cannot overwrite a prefix that was just
 *   minted. Overwriting would strand every object the user already has, since
 *   the prefix is the only path to them.
 * - **Laziness.** Nothing calls this except the upload path, so a user who
 *   never uploads audio never gets a prefix and no backfill is needed.
 */
export async function resolveAudioStoragePrefix(userId: string): Promise<string> {
  const existing = await User.findById(userId).select('audioStoragePrefix').lean();
  if (!existing) throw new Error('User not found');
  if (existing.audioStoragePrefix) return existing.audioStoragePrefix;

  // `$in: [null]` matches a null value AND a missing field, so this cannot
  // match a document that already has a prefix — that is the stability guard.
  const minted = crypto.randomBytes(PREFIX_BYTES).toString('hex');
  const updated = await User.findOneAndUpdate(
    { _id: userId, audioStoragePrefix: { $in: [null] } },
    { $set: { audioStoragePrefix: minted } },
    { new: true }
  )
    .select('audioStoragePrefix')
    .lean();

  if (updated?.audioStoragePrefix) return updated.audioStoragePrefix;

  // The conditional write matched nothing, which means another request minted
  // one between the read above and here. Theirs won; read it back rather than
  // returning a prefix that was never stored.
  const raced = await User.findById(userId).select('audioStoragePrefix').lean();
  if (!raced?.audioStoragePrefix) throw new Error('Failed to assign audio storage prefix');
  return raced.audioStoragePrefix;
}

/**
 * The prefix a user already has, or null.
 *
 * Read-only on purpose: the cleanup scan uses this, and a scan must never be
 * the thing that mints a namespace. A user with no prefix has no audio
 * objects, which is an empty scan, not a reason to write to their document.
 */
export async function lookupAudioStoragePrefix(userId: string): Promise<string | null> {
  const doc = await User.findById(userId).select('audioStoragePrefix').lean();
  return doc?.audioStoragePrefix ?? null;
}
