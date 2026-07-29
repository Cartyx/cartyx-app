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
