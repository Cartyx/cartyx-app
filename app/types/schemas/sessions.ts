import { z } from 'zod';

export const listSessionsSchema = z.object({
  campaignId: z.string().min(1),
  includeCompleted: z.boolean().optional(),
});

export const getSessionCatchUpSchema = z.object({
  campaignId: z.string().min(1),
  sessionId: z.string().min(1),
});

export const createSessionSchema = z.object({
  campaignId: z.string().min(1),
  name: z.string().trim().min(1),
  startDate: z.string().datetime(),
});

export const updateSessionSchema = z.object({
  sessionId: z.string().min(1),
  campaignId: z.string().min(1),
  name: z.string().trim().min(1).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  summary: z.string().optional(),
});
