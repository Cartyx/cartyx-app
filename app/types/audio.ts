/** Functional classification — drives playback defaults on the phase 2 board. */
export const AUDIO_KINDS = ['music', 'ambience', 'one-shot'] as const;
export type AudioKind = (typeof AUDIO_KINDS)[number];

export const AUDIO_ENVIRONMENTS = [
  'forest',
  'dungeon',
  'city',
  'tavern',
  'wilderness',
  'coast',
  'mountain',
  'swamp',
  'desert',
  'underground',
  'temple',
  'castle',
  'ship',
  'plains',
  'arctic',
] as const;
export type AudioEnvironment = (typeof AUDIO_ENVIRONMENTS)[number];

export const AUDIO_MOODS = [
  'calm',
  'tense',
  'combat',
  'eerie',
  'festive',
  'somber',
  'mysterious',
  'triumphant',
  'chaotic',
] as const;
export type AudioMood = (typeof AUDIO_MOODS)[number];

export const AUDIO_STATUSES = ['uploading', 'pending', 'processing', 'ready', 'failed'] as const;
export type AudioAssetStatus = (typeof AUDIO_STATUSES)[number];

/**
 * 50 MB. The confirm step's HeadObject enforces it here; the worker enforces
 * it AGAIN while streaming, because the presigned PUT stays valid and reusable
 * after confirm has passed.
 *
 * DUPLICATED as `DEFAULT_MAX_SOURCE_BYTES` in `audio-worker/src/config.ts` —
 * the worker is an independent package and imports nothing from `app/`. The
 * two are not allowed to drift and cannot do so silently:
 * `tests/server/functions/audio-cross-service-contract.test.ts` reads the
 * worker's source and fails when the numbers disagree.
 */
export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;

/**
 * The rate EVERY rendition is produced at, and therefore the rate
 * `durationSamples` counts in — not the source's own rate, which is recorded
 * separately on the model (`sampleRate`) and is not even serialized to the
 * client. `durationSamples / AUDIO_RENDITION_SAMPLE_RATE` is the exact content
 * length in seconds that phase 2's engine sets `source.loopEnd` to.
 *
 * DUPLICATED as `RENDITION_SAMPLE_RATE` in `audio-worker/src/ffmpeg.ts` — the
 * worker is an independent package and imports nothing from `app/`. Drift is
 * not cosmetic: the worker measures in its units and the board divides in
 * these, so a mismatch makes every loop point wrong by the ratio, silently.
 * `tests/server/functions/audio-cross-service-contract.test.ts` reads the
 * worker's source and fails when the two disagree.
 */
export const AUDIO_RENDITION_SAMPLE_RATE = 48_000;

/** Source uploads we accept. Output is always Opus + AAC regardless. */
export const AUDIO_SOURCE_TYPES: ReadonlyMap<string, string> = new Map([
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/mpeg', 'mp3'],
  ['audio/flac', 'flac'],
  ['audio/ogg', 'ogg'],
  ['audio/opus', 'opus'],
  ['audio/mp4', 'm4a'],
  ['audio/aac', 'aac'],
  ['audio/x-m4a', 'm4a'],
]);

export type AudioRendition = { key: string; url: string; bytes: number };

export type AudioAssetData = {
  id: string;
  ownerId: string;
  title: string;
  kind: AudioKind;
  environment: string[];
  mood: string[];
  intensity: number | null;
  tags: string[];
  status: AudioAssetStatus;
  durationMs: number | null;
  /**
   * Exact decoded length in samples per channel at the renditions' 48 kHz.
   * Phase 2's gapless looping reads THIS, not `durationMs` — millisecond
   * rounding costs up to ±24 samples per asset and the container duration adds
   * more on top, which is an audible tick on every loop repeat. `durationMs`
   * stays for display.
   */
  durationSamples: number | null;
  loudnessTargetLufs: number | null;
  peaks: number[];
  renditions: { opus?: AudioRendition; aac?: AudioRendition };
  /**
   * The phase 2 ∞/1× music variant — a second, composed-ending encode of the
   * same source, attached via Task 18's flow and written by the same worker
   * pipeline into this field instead of `renditions`. Optional and, as of
   * this task, ALWAYS absent: `AudioAsset.ts`'s model has reserved this field
   * since phase 1, but `serializeAudioAsset` deliberately never puts it on
   * the wire yet (see its own comment) — Task 18 is what starts writing it.
   * Declared here now, ahead of that, purely so the board's pad component
   * (Task 16) can type-check `asset.onceRenditions` instead of taking a
   * caller-computed boolean; every reader must treat it as possibly absent,
   * on every asset, indefinitely, same as `renditions.opus`/`.aac` already
   * are treated.
   */
  onceRenditions?: { opus?: AudioRendition; aac?: AudioRendition };
  lastError: string | null;
  /**
   * True when the worker rejected the SOURCE ITSELF, so no rerun of the same
   * bytes can ever succeed and `retryAudioAsset` refuses the row.
   *
   * Serialized because the UI cannot otherwise tell the two kinds of `failed`
   * apart, and it has to: without this field `AudioAssetRow` offered Retry on
   * every failed asset, and clicking it on a permanently-failed one threw a
   * four-way error message that named every possible cause at once. A button
   * whose only outcome is an error that cannot say why is worse than no button.
   */
  permanentFailure: boolean;
  /**
   * Whether `retryAudioAsset` will actually accept this row — the server's
   * WHOLE filter, evaluated once on the server, not a fragment of it the client
   * re-derives.
   *
   * `retryAudioAsset` has THREE preconditions (`status: 'failed'`,
   * `confirmedAt != null`, `permanentFailure !== true`) and the UI used to
   * mirror two of them, because `confirmedAt` was never serialized. The rows
   * that fell through the gap are the most common ones the system produces:
   * `reapAbandonedUploads` and `confirmAudioUpload`'s reject path both write
   * `failed` with `confirmedAt` still null. Retry rendered on those, and the
   * click's only possible outcome was the four-way error naming every
   * precondition at once — the exact failure `permanentFailure` was serialized
   * to fix, reintroduced through the clause nobody exported.
   *
   * ONE derived flag rather than a third raw field, because "the UI mirrors the
   * server's filter" is only checkable if there is one thing to mirror.
   * `permanentFailure` stays alongside it: `retryable === false` says the button
   * must not render, and `permanentFailure` says WHY, which is the difference
   * between "re-upload a corrected file" and "your upload never finished".
   */
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
};
