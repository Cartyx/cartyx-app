import type { PictureCrop } from './character';

export type LoreLinkKind = 'race' | 'character' | 'player' | 'location';

export interface LoreLink {
  kind: LoreLinkKind;
  id: string;
  /** Resolved display label (entity name/title); read-time only, not persisted. */
  label?: string;
}

export interface LoreImage {
  url: string;
  caption: string;
  crop: PictureCrop | null;
}

export interface LoreData {
  id: string;
  campaignId: string;
  createdBy: string;
  title: string;
  content: string;
  gmContent: string;
  isPublic: boolean;
  images: LoreImage[];
  links: LoreLink[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

/** List item omits the GM-only body. */
export type LoreListItem = Omit<LoreData, 'gmContent'>;
