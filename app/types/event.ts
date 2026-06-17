import type { CalDate } from '~/utils/calendarEngine';

export type EventLinkKind = 'character' | 'player' | 'race' | 'location' | 'lore';

export interface EventLink {
  kind: EventLinkKind;
  id: string;
  label?: string;
}

export interface EventImage {
  url: string;
  caption: string;
  crop: { x: number; y: number; width: number; height: number } | null;
}

export interface EventData {
  id: string;
  campaignId: string;
  calendarId: string;
  createdBy: string;
  title: string;
  content: string;
  gmContent: string;
  isPublic: boolean;
  isEpic: boolean;
  start: CalDate;
  end: CalDate | null;
  startOrdinal: number;
  endOrdinal: number;
  links: EventLink[];
  sessionId: string | null;
  images: EventImage[];
  tags: string[];
  color: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export type EventListItem = Omit<EventData, 'gmContent'>;
