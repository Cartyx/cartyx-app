import { z } from 'zod';

const questStatusEnum = z.enum(['not_started', 'active', 'on_hold', 'completed', 'failed']);
const questGiverKindEnum = z.enum(['character', 'player', 'organization']);
const questLinkKindEnum = z.enum(['character', 'player', 'location', 'organization']);

const questGiverInputSchema = z
  .object({
    kind: questGiverKindEnum,
    id: z.string().trim().min(1),
  })
  .nullable()
  .default(null);

const questLinkInputSchema = z.object({
  kind: questLinkKindEnum,
  id: z.string().trim().min(1),
  role: z.string().optional().default(''),
  publicInfo: z.string().optional().default(''),
  privateInfo: z.string().optional().default(''),
});

const questEventLinkInputSchema = z.object({
  eventId: z.string().trim().min(1),
  role: z.string().optional().default(''),
  publicInfo: z.string().optional().default(''),
  privateInfo: z.string().optional().default(''),
});

const questImageSchema = z.object({
  url: z.string().trim().min(1),
  caption: z.string().trim().default(''),
  crop: z
    .object({
      x: z.number().finite().min(0).max(1),
      y: z.number().finite().min(0).max(1),
      width: z.number().finite().gt(0).max(1),
      height: z.number().finite().gt(0).max(1),
    })
    .nullable()
    .default(null),
});

export const createQuestSchema = z.object({
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Name is required'),
  type: z.string().optional().default(''),
  status: questStatusEnum.optional().default('not_started'),
  publicInfo: z.string().optional().default(''),
  privateInfo: z.string().optional().default(''),
  isPublic: z.boolean().optional().default(false),
  giver: questGiverInputSchema,
  parentQuestId: z.string().trim().min(1).nullable().optional().default(null),
  links: z.array(questLinkInputSchema).optional().default([]),
  events: z.array(questEventLinkInputSchema).optional().default([]),
  images: z.array(questImageSchema).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
});

export const updateQuestSchema = createQuestSchema.extend({
  id: z.string().trim().min(1),
});

export const deleteQuestSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const getQuestSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const listQuestsSchema = z.object({
  campaignId: z.string().trim().min(1),
  search: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: questStatusEnum.optional(),
});

export const listQuestsForEntitySchema = z.object({
  campaignId: z.string().trim().min(1),
  kind: questLinkKindEnum,
  id: z.string().trim().min(1),
});
