/**
 * A failure that retrying can never fix.
 *
 * `processAsset`'s catch block deliberately does NOT try to tell permanent
 * failures from transient ones by inspecting ffmpeg exit codes or AWS SDK
 * error names — that surface is brittle and rots silently, and a corrupt file
 * burning a few cheap attempts is acceptable bounded waste. So the distinction
 * lives where it is actually *known* instead: the validation step that decided
 * the source is unusable throws this, and everything else keeps flowing
 * through the ordinary retry budget.
 *
 * Two consequences, both required:
 *
 * - The catch routes it straight to `failed` regardless of the attempt count,
 *   so it never consumes the retry budget.
 * - The row is stamped `permanentFailure: true`, which `retryAudioAsset`
 *   (app side) refuses. A source that is over the duration cap, silent, empty
 *   or truncated is poison on every run, and each Retry click buys another
 *   pass of pinned CPU on a single-node cluster for a guaranteed identical
 *   outcome.
 *
 * `message` is written verbatim to `lastError` and shown in the library UI, so
 * it must read as something a human can act on ("Audio is longer than the
 * 30 minute limit"), never as `Command failed: ffmpeg -v error -i /tmp/...`.
 */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

/**
 * The one permanent rejection that also DELETES the source object.
 *
 * Split out from `PermanentError` because the deletion has to be scoped to
 * exactly this reason and no other. The size rejection is the only one whose
 * object is both worthless and expensive:
 *
 * - Worthless: the object failed the size check, and nothing about it will ever
 *   pass. There is no version of "a human inspects it later" that ends in the
 *   file being used.
 * - Expensive: it is the ONLY rejection reason whose object can be arbitrarily
 *   large. A presigned PUT cannot constrain Content-Length and stays valid and
 *   reusable for 300 s after `confirmAudioUpload` measured it, so a client can
 *   confirm 1 KB and then re-PUT gigabytes to the same URL. The worker refuses
 *   to READ that object, correctly — but refusing to read it leaves it in R2,
 *   referenced by a `failed` row, which is precisely the state the owner-scoped
 *   cleanup treats as in-use and will never offer for reclamation. The only
 *   person who can free it is the account that uploaded it, i.e. the attacker.
 *
 * Every other permanent rejection keeps its object: an unsupported codec, a
 * source with no decodable samples, a wholly silent file and an over-length
 * file are all bounded by `AUDIO_MAX_BYTES`, cost 50 MB at worst, and are
 * exactly the cases where a human may want to look at what was actually
 * uploaded before it disappears. Deleting those trades a real diagnostic for
 * no meaningful storage saving.
 */
export class PermanentSizeError extends PermanentError {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentSizeError';
  }
}
