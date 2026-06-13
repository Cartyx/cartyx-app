import { z } from 'zod';

export const listMessagesSchema = z.object({
  sessionId: z.string().min(1),
  limit: z.number().int().positive().max(500).optional(),
  beforeSeq: z.number().int().positive().optional(),
});

export const saveMessageSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().positive(),
  sessionId: z.string().min(1),
  campaignId: z.string().min(1),
  channel: z.enum(['general', 'gm']),
  type: z.enum(['chat', 'spell-card', 'trait', 'item']),
  authorId: z.string().min(1),
  authorName: z.string().min(1),
  text: z.string().optional().default(''),
  beyond20Data: z
    .object({
      title: z.string(),
      source: z.string(),
      description: z.string(),
      properties: z.record(z.string(), z.string()),
    })
    .optional(),
  timestamp: z.number(),
});
