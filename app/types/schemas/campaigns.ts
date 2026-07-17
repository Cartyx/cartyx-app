import { z } from 'zod';

/** Max base64 length the server accepts for image uploads (local dev fallback). */
export const MAX_IMAGE_BASE64_LENGTH = 4 * 1024 * 1024;

export const campaignInputShape = {
  name: z.string().min(1),
  description: z.string().default(''),
  schedFreq: z.string().optional(),
  schedDay: z.string().optional(),
  schedTime: z.string().optional(),
  schedTz: z.string().optional(),
  links: z
    .array(z.object({ name: z.string(), url: z.string() }))
    .optional()
    .default([]),
  maxPlayers: z.union([z.string(), z.number()]).optional(),
  imagePath: z.string().url().optional(),
  imageData: z
    .string()
    .max(MAX_IMAGE_BASE64_LENGTH, 'Image must be under 3MB after compression')
    .optional(),
  imageMime: z.string().optional(),
  imageName: z.string().optional(),
  loadSrdData: z.boolean().optional().default(false),
} as const;

function imageFieldsRefinement<
  T extends { imageData?: string; imageMime?: string; imageName?: string; imagePath?: string },
>(data: T): boolean {
  if (data.imagePath !== undefined) {
    return (
      data.imageData === undefined && data.imageMime === undefined && data.imageName === undefined
    );
  }
  return (
    (data.imageData === undefined &&
      data.imageMime === undefined &&
      data.imageName === undefined) ||
    (data.imageData !== undefined && data.imageMime !== undefined && data.imageName !== undefined)
  );
}

const imageFieldsMessage = {
  message:
    'imageData, imageMime, and imageName must either all be provided or all be omitted, and cannot be combined with imagePath',
  path: ['imageData'] as [string],
};

export const campaignInputSchema = z
  .object(campaignInputShape)
  .refine(imageFieldsRefinement, imageFieldsMessage);

export const updateCampaignInputSchema = z
  .object({ id: z.string(), ...campaignInputShape })
  .refine(imageFieldsRefinement, imageFieldsMessage);

export const getCampaignSchema = z.object({ id: z.string() });

export const joinCampaignSchema = z.object({ inviteCode: z.string().min(1) });

export const activateSessionSchema = z.object({
  campaignId: z.string().min(1),
  sessionId: z.string().min(1),
  endDate: z.string().datetime().optional(),
});
