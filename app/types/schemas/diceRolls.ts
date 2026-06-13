import { z } from 'zod';

export const listDiceRollsSchema = z.object({
  sessionId: z.string().min(1),
  limit: z.number().int().positive().max(500).optional(),
  beforeSeq: z.number().int().positive().optional(),
});

export const saveDiceRollSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().positive(),
  sessionId: z.string().min(1),
  campaignId: z.string().min(1),
  channel: z.enum(['general', 'gm']),
  character: z.string().min(1),
  title: z.string().min(1),
  rollType: z.string().min(1),
  attackRolls: z.array(
    z.object({
      roll: z.number(),
      type: z.enum(['hit', 'crit', 'miss', 'crit-fail']),
      total: z.number(),
      formula: z.string().optional().default(''),
      discarded: z.boolean().optional().default(false),
      dice: z.array(z.number()).optional().default([]),
    })
  ),
  damageRolls: z.array(
    z.object({
      damageType: z.string(),
      dice: z.array(z.number()),
      total: z.number(),
      flags: z.number().optional().default(1),
      formula: z.string().optional().default(''),
    })
  ),
  totalDamages: z.record(z.string(), z.number()),
  rollInfo: z.array(z.tuple([z.string(), z.string()])),
  description: z.string().optional().default(''),
  timestamp: z.number(),
});
