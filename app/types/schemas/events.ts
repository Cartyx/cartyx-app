import { z } from 'zod';

const linkKind = z.enum(['character', 'player', 'race', 'location', 'lore']);
const eventLink = z.object({ kind: linkKind, id: z.string().trim().min(1) });
const calDate = z.object({
  year: z.number().int(),
  monthIndex: z.number().int().min(0),
  day: z.number().int().min(1),
});
const eventImage = z.object({
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

const eventFields = {
  title: z.string().trim().min(1),
  content: z.string().default(''),
  gmContent: z.string().default(''),
  isPublic: z.boolean().default(false),
  isEpic: z.boolean().default(false),
  start: calDate,
  end: calDate.nullable().default(null),
  links: z.array(eventLink).default([]),
  sessionId: z.string().trim().min(1).nullable().default(null),
  images: z.array(eventImage).default([]),
  tags: z.array(z.string()).default([]),
  color: z.string().trim().min(1).nullable().default(null),
};

export const listEventsSchema = z.object({
  campaignId: z.string().trim().min(1),
  search: z.string().trim().optional(),
  tags: z.array(z.string()).optional(),
  visibility: z.enum(['all', 'public', 'private']).optional(),
  epicOnly: z.boolean().optional(),
  linkedKind: linkKind.optional(),
  linkedId: z.string().trim().min(1).optional(),
});
export const getEventSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});
export const createEventSchema = z.object({ campaignId: z.string().trim().min(1), ...eventFields });
export const updateEventSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  ...eventFields,
});
export const deleteEventSchema = getEventSchema;
