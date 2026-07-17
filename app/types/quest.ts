import type { PictureCrop } from './character';

export type QuestStatus = 'not_started' | 'active' | 'on_hold' | 'completed' | 'failed';
export type QuestGiverKind = 'character' | 'player' | 'organization';
export type QuestLinkKind = 'character' | 'player' | 'location' | 'organization';

export interface QuestImage {
  url: string;
  caption: string;
  crop: PictureCrop | null;
}

export interface QuestGiver {
  kind: QuestGiverKind;
  id: string;
  /** Resolved display name; '' if the referenced entity is gone. */
  label: string;
}

export interface QuestLink {
  kind: QuestLinkKind;
  id: string;
  /** Resolved display name. */
  label: string;
  role: string;
  publicInfo: string;
  /** GM-only; '' for non-GM viewers. */
  privateInfo: string;
}

export interface QuestEventLink {
  eventId: string;
  /** Resolved event title. */
  label: string;
  role: string;
  publicInfo: string;
  /** GM-only; '' for non-GM viewers. */
  privateInfo: string;
}

/** Lightweight parent/child reference used in the window header. */
export interface QuestSummary {
  id: string;
  name: string;
  status: QuestStatus;
}

export interface QuestData {
  id: string;
  campaignId: string;
  createdBy: string;
  name: string;
  type: string;
  status: QuestStatus;
  publicInfo: string;
  /** GM-only; '' for non-GM viewers. */
  privateInfo: string;
  isPublic: boolean;
  giver: QuestGiver | null;
  parentQuestId: string | null;
  parentQuest: QuestSummary | null;
  subQuests: QuestSummary[];
  links: QuestLink[];
  events: QuestEventLink[];
  images: QuestImage[];
  tags: string[];
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuestListItem {
  id: string;
  campaignId: string;
  createdBy: string;
  name: string;
  type: string;
  status: QuestStatus;
  isPublic: boolean;
  tags: string[];
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuestGiverInput {
  kind: QuestGiverKind;
  id: string;
}

export interface QuestLinkInput {
  kind: QuestLinkKind;
  id: string;
  role: string;
  publicInfo: string;
  privateInfo: string;
}

export interface QuestEventLinkInput {
  eventId: string;
  role: string;
  publicInfo: string;
  privateInfo: string;
}

export interface CreateQuestInput {
  campaignId: string;
  name: string;
  type: string;
  status: QuestStatus;
  publicInfo: string;
  privateInfo: string;
  isPublic: boolean;
  giver: QuestGiverInput | null;
  parentQuestId: string | null;
  links: QuestLinkInput[];
  events: QuestEventLinkInput[];
  images: QuestImage[];
  tags: string[];
}

export interface UpdateQuestInput extends CreateQuestInput {
  id: string;
}
