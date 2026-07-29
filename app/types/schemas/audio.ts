import { z } from 'zod';
import { AUDIO_KINDS, AUDIO_ENVIRONMENTS, AUDIO_MOODS, AUDIO_MAX_BYTES } from '~/types/audio';

const kind = z.enum(AUDIO_KINDS);
const environment = z.array(z.enum(AUDIO_ENVIRONMENTS)).max(10).default([]);
const mood = z.array(z.enum(AUDIO_MOODS)).max(10).default([]);
const intensity = z.number().int().min(1).max(5).nullish();
const tags = z.array(z.string().min(1).max(40)).max(30).default([]);

export const createAudioUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  bytes: z.number().int().positive().max(AUDIO_MAX_BYTES),
  title: z.string().min(1).max(200).optional(),
  kind,
  environment,
  mood,
  intensity,
  tags,
});

export const confirmAudioUploadSchema = z.object({
  assetId: z.string().min(1),
});

export const listAudioAssetsSchema = z.object({
  kind: kind.optional(),
  environment: z.array(z.enum(AUDIO_ENVIRONMENTS)).optional(),
  mood: z.array(z.enum(AUDIO_MOODS)).optional(),
  intensityMin: z.number().int().min(1).max(5).optional(),
  intensityMax: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string().min(1)).optional(),
  search: z.string().max(200).optional(),
  needsTagging: z.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const updateAudioAssetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  kind: kind.optional(),
  environment: z.array(z.enum(AUDIO_ENVIRONMENTS)).optional(),
  mood: z.array(z.enum(AUDIO_MOODS)).optional(),
  intensity,
  tags: z.array(z.string().min(1).max(40)).max(30).optional(),
});

export const bulkTagAudioAssetsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  kind: kind.optional(),
  environment: z.array(z.enum(AUDIO_ENVIRONMENTS)).optional(),
  mood: z.array(z.enum(AUDIO_MOODS)).optional(),
  intensity,
  tags: z.array(z.string().min(1).max(40)).max(30).optional(),
  tagMode: z.enum(['add', 'replace']).default('add'),
});

export const deleteAudioAssetSchema = z.object({ id: z.string().min(1) });

export const retryAudioAssetSchema = z.object({ id: z.string().min(1) });
