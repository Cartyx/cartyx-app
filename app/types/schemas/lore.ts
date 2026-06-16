import { z } from 'zod';

const linkKind = z.enum(['race', 'character', 'player', 'location']);

const loreLinkSchema = z.object({
  kind: linkKind,
  id: z.string().trim().min(1),
});

const loreImageSchema = z.object({
  url: z.string().trim().min(1),
  caption: z.string().trim().default(''),
  crop: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().finite(),
      height: z.number().finite(),
    })
    .nullable()
    .default(null),
});

const loreFields = {
  title: z.string().trim().min(1),
  content: z.string().default(''),
  gmContent: z.string().default(''),
  isPublic: z.boolean().default(false),
  images: z.array(loreImageSchema).default([]),
  links: z.array(loreLinkSchema).default([]),
  tags: z.array(z.string()).default([]),
};

export const createLoreSchema = z.object({ campaignId: z.string().trim().min(1), ...loreFields });
export const updateLoreSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  ...loreFields,
});
export const deleteLoreSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});
export const getLoreSchema = deleteLoreSchema;
export const listLoreSchema = z.object({
  campaignId: z.string().trim().min(1),
  search: z.string().trim().optional(),
  tags: z.array(z.string()).optional(),
  visibility: z.enum(['all', 'public', 'private']).optional(),
  linkedKind: linkKind.optional(),
  linkedId: z.string().trim().min(1).optional(),
});
