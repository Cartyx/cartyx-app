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
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
