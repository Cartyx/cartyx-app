export interface NoteData {
  id: string;
  campaignId: string;
  sessionId?: string;
  createdBy: string;
  title: string;
  note: string;
  tags: string[];
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NoteListItem {
  id: string;
  campaignId: string;
  sessionId?: string;
  createdBy: string;
  title: string;
  tags: string[];
  isPublic: boolean;
  /** True when the caller created this note. Notes are creator-only for edit
   *  AND delete (a GM has no rights on someone else's note), so this gates both. */
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}
