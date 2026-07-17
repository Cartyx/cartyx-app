import type { PictureCrop } from './character';

export interface OrganizationLocationLink {
  locationId: string;
  label: string;
  publicInfo: string;
  /** GM-only; '' for non-GM viewers. */
  privateInfo: string;
}

export interface OrganizationImage {
  url: string;
  caption: string;
  crop: PictureCrop | null;
}

export interface OrganizationData {
  id: string;
  campaignId: string;
  createdBy: string;
  name: string;
  publicInfo: string;
  /** GM-only; '' for non-GM viewers. */
  privateInfo: string;
  isPublic: boolean;
  images: OrganizationImage[];
  tags: string[];
  locations: OrganizationLocationLink[];
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationListItem {
  id: string;
  campaignId: string;
  createdBy: string;
  name: string;
  isPublic: boolean;
  tags: string[];
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MemberKind = 'player' | 'character';

export interface OrganizationMembershipData {
  id: string;
  campaignId: string;
  organizationId: string;
  /** Resolved organization name. */
  organizationName: string;
  /** Whether the linked org is public (used to gate member-side display). */
  organizationIsPublic: boolean;
  memberKind: MemberKind;
  memberId: string;
  /** Resolved member display name. */
  memberLabel: string;
  title: string;
  publicNotes: string;
  /** GM-only; '' for non-GM viewers. */
  privateNotes: string;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationLocationLinkInput {
  locationId: string;
  label?: string;
  publicInfo: string;
  privateInfo: string;
}

export interface CreateOrganizationInput {
  campaignId: string;
  name: string;
  publicInfo: string;
  privateInfo: string;
  isPublic: boolean;
  images: OrganizationImage[];
  tags: string[];
  locations: OrganizationLocationLinkInput[];
}

export interface UpdateOrganizationInput extends CreateOrganizationInput {
  id: string;
}
