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

/** 50 MB. The confirm step's HeadObject is what actually enforces this. */
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
  loudnessLufs: number | null;
  peaks: number[];
  renditions: { opus?: AudioRendition; aac?: AudioRendition };
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
