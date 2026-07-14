import { z } from 'zod';

const locationLinkInputSchema = z.object({
  locationId: z.string().trim().min(1),
  publicInfo: z.string().optional().default(''),
  privateInfo: z.string().optional().default(''),
});

const organizationImageSchema = z.object({
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

export const createOrganizationSchema = z.object({
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Name is required'),
  publicInfo: z.string().optional().default(''),
  privateInfo: z.string().optional().default(''),
  isPublic: z.boolean().optional().default(false),
  images: z.array(organizationImageSchema).default([]),
  tags: z.array(z.string()).optional().default([]),
  locations: z.array(locationLinkInputSchema).optional().default([]),
});

export const updateOrganizationSchema = createOrganizationSchema.extend({
  id: z.string().trim().min(1),
});

export const deleteOrganizationSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const getOrganizationSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const listOrganizationsSchema = z.object({
  campaignId: z.string().trim().min(1),
  search: z.string().optional(),
  tags: z.array(z.string()).optional(),
  locationIds: z.array(z.string()).optional(),
});

// --- Memberships ---

export const addMembershipSchema = z.object({
  campaignId: z.string().trim().min(1),
  organizationId: z.string().trim().min(1),
  memberKind: z.enum(['player', 'character']),
  memberId: z.string().trim().min(1),
  title: z.string().optional().default(''),
  publicNotes: z.string().optional().default(''),
  privateNotes: z.string().optional().default(''),
});

export const updateMembershipSchema = z.object({
  campaignId: z.string().trim().min(1),
  id: z.string().trim().min(1),
  title: z.string().optional().default(''),
  publicNotes: z.string().optional().default(''),
  privateNotes: z.string().optional().default(''),
});

export const removeMembershipSchema = z.object({
  campaignId: z.string().trim().min(1),
  id: z.string().trim().min(1),
});

export const listMembershipsForOrgSchema = z.object({
  campaignId: z.string().trim().min(1),
  organizationId: z.string().trim().min(1),
});

export const listMembershipsForMemberSchema = z.object({
  campaignId: z.string().trim().min(1),
  memberKind: z.enum(['player', 'character']),
  memberId: z.string().trim().min(1),
});
