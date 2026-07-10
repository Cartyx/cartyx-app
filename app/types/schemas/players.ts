import { z } from 'zod';

export const pictureCropSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().gt(0).max(1),
  height: z.number().finite().gt(0).max(1),
});

export const createPlayerSchema = z.object({
  campaignId: z.string().min(1),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  race: z.string().trim().min(1),
  characterClass: z.string().trim().min(1),
  age: z.number().int().positive(),
  gender: z.string().trim().optional().default(''),
  location: z.string().trim().optional().default(''),
  link: z
    .string()
    .trim()
    .regex(/^(https?:\/\/.+)?$/)
    .optional()
    .default(''),
  picture: z.string().optional().default(''),
  pictureCrop: pictureCropSchema.nullable().optional().default(null),
  description: z.string().optional().default(''),
  backstory: z.string().optional().default(''),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .default('#3498db'),
  eyeColor: z.string().trim().optional().default(''),
  hairColor: z.string().trim().optional().default(''),
  weight: z.number().positive().nullable().optional().default(null),
  height: z.string().trim().optional().default(''),
  size: z.string().trim().optional().default(''),
  appearance: z.string().optional().default(''),
});

export const updatePlayerSchema = createPlayerSchema.extend({
  id: z.string().min(1),
  gmNotes: z.string().optional(),
});

export const getPlayerSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const deletePlayerSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const listPlayersSchema = z.object({
  campaignId: z.string().min(1),
  search: z.string().optional(),
});

export const updatePlayerStatusSchema = z.object({
  id: z.string().min(1),
  campaignId: z.string().min(1),
  value: z.enum(['alive', 'deceased']),
});

export const playerRelationshipSchema = z.object({
  playerId: z.string().min(1),
  campaignId: z.string().min(1),
  characterId: z.string().min(1),
  descriptor: z.string().trim().min(1),
  isPublic: z.boolean().optional().default(false),
});

export const removePlayerRelationshipSchema = z.object({
  playerId: z.string().min(1),
  campaignId: z.string().min(1),
  characterId: z.string().min(1),
});

export const validateInviteCodeSchema = z.object({
  inviteCode: z.string().min(1),
});

export const completeJoinWizardSchema = z.object({
  campaignId: z.string().min(1),
  player: createPlayerSchema.omit({ campaignId: true }),
  characters: z
    .array(
      z.object({
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().min(1),
        race: z.string().trim().optional().default(''),
        characterClass: z.string().trim().optional().default(''),
        age: z.number().int().positive().nullable().optional().default(null),
        location: z.string().trim().optional().default(''),
        link: z
          .string()
          .trim()
          .regex(/^(https?:\/\/.+)?$/)
          .optional()
          .default(''),
        picture: z.string().optional().default(''),
        pictureCrop: pictureCropSchema.nullable().optional().default(null),
        notes: z.string().optional().default(''),
        gmNotes: z.string().optional().default(''),
        tags: z.array(z.string()).optional().default([]),
        isPublic: z.boolean().optional().default(false),
        relationship: z.object({
          descriptor: z.string().trim().min(1),
          isPublic: z.boolean().optional().default(false),
        }),
      })
    )
    .optional()
    .default([]),
  lore: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        content: z.string().default(''),
        isPublic: z.boolean().default(false),
      })
    )
    .optional()
    .default([]),
});
