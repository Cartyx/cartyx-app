import { z } from 'zod';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { Note } from '../db/models/Note';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { normalizeTags } from '../utils/helpers';
import { removeDocumentRefsFromScreens } from './gmscreens-helpers';
import { ensureTags as ensureTagsFn } from './tags';
import type { NoteData, NoteListItem } from '~/types/note';
import {
  createNoteSchema,
  updateNoteSchema,
  deleteNoteSchema,
  listNotesSchema,
  getNoteSchema,
} from '~/types/schemas/notes';

function serializeNote(n: {
  _id: unknown;
  campaignId: unknown;
  sessionId?: unknown;
  createdBy: unknown;
  title?: string;
  note?: string;
  tags?: string[];
  isPublic?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}): NoteData {
  return {
    id: String(n._id),
    campaignId: String(n.campaignId),
    sessionId: n.sessionId ? String(n.sessionId) : undefined,
    createdBy: String(n.createdBy),
    title: n.title ?? '',
    note: n.note ?? '',
    tags: n.tags ?? [],
    isPublic: n.isPublic ?? false,
    createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : '',
    updatedAt: n.updatedAt instanceof Date ? n.updatedAt.toISOString() : '',
  };
}

function serializeNoteListItem(n: {
  _id: unknown;
  campaignId: unknown;
  sessionId: unknown;
  createdBy: unknown;
  title?: string;
  tags?: string[];
  isPublic?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}): NoteListItem {
  return {
    id: String(n._id),
    campaignId: String(n.campaignId),
    sessionId: n.sessionId ? String(n.sessionId) : undefined,
    createdBy: String(n.createdBy),
    title: n.title ?? '',
    tags: n.tags ?? [],
    isPublic: n.isPublic ?? false,
    createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : '',
    updatedAt: n.updatedAt instanceof Date ? n.updatedAt.toISOString() : '',
  };
}

/**
 * Verify the authenticated user is a member of the given campaign.
 * Returns the DB user ID string, or throws.
 */
async function requireCampaignMember(
  campaignId: string
): Promise<{ userId: string; sessionUserId: string }> {
  const user = await getSession();
  if (!user) throw new Error('Not authenticated');

  await connectDB();
  if (!isDBConnected()) throw new Error('Database not available');

  const dbUser = await User.findOne({ providerId: user.id });
  if (!dbUser) throw new Error('User not found');

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const userId = String(dbUser._id);
  const members = campaign.members ?? [];
  const isMember =
    members.some((m) => String(m.userId) === userId) || String(campaign.gameMasterId) === userId;
  if (!isMember) throw new Error('Forbidden');

  return { userId, sessionUserId: user.id };
}

// ---------------------------------------------------------------------------
// createNote
// ---------------------------------------------------------------------------

export { createNoteSchema };

export const createNote = async ({ data }: { data: z.infer<typeof createNoteSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const now = new Date();
    const finalTags = normalizeTags(data.tags ?? []);
    const noteData: Record<string, unknown> = {
      campaignId: data.campaignId,
      createdBy: userId,
      title: data.title.trim(),
      note: data.note.trim(),
      tags: finalTags,
      isPublic: data.isPublic ?? false,
      createdAt: now,
      updatedAt: now,
    };
    if (data.sessionId && data.sessionId !== '__none__') {
      noteData.sessionId = data.sessionId;
    }
    const doc = await Note.create(noteData);

    // Register any new tags in the campaign tag registry
    await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });

    serverCaptureEvent(sessionUserId, 'note_created', {
      campaign_id: data.campaignId,
      note_id: String(doc._id),
    });

    return { success: true, note: serializeNote(doc) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'createNote',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// updateNote
// ---------------------------------------------------------------------------

export { updateNoteSchema };

export const updateNote = async ({ data }: { data: z.infer<typeof updateNoteSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const existing = await Note.findById(data.id);
    if (!existing) throw new Error('Note not found');
    if (String(existing.campaignId) !== data.campaignId) throw new Error('Forbidden');
    if (String(existing.createdBy) !== userId) throw new Error('Forbidden');
    if (existing.isReadOnly) throw new Error('Note is read-only');

    const finalTags = normalizeTags(data.tags ?? []);
    existing.sessionId = (data.sessionId && data.sessionId !== '__none__'
      ? data.sessionId
      : undefined) as unknown as typeof existing.sessionId;
    existing.title = data.title.trim();
    existing.note = data.note.trim();
    existing.tags = finalTags;
    if (data.isPublic !== undefined) {
      existing.isPublic = data.isPublic;
    }
    existing.updatedAt = new Date();
    await existing.save();

    // Register any new tags in the campaign tag registry
    await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });

    serverCaptureEvent(sessionUserId, 'note_updated', {
      campaign_id: data.campaignId,
      note_id: data.id,
      updated_by: userId,
    });

    return { success: true, note: serializeNote(existing) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'updateNote', noteId: data.id });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// deleteNote
// ---------------------------------------------------------------------------

export { deleteNoteSchema };

export const deleteNote = async ({ data }: { data: z.infer<typeof deleteNoteSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const existing = await Note.findById(data.id);
    if (!existing) throw new Error('Note not found');
    if (String(existing.campaignId) !== data.campaignId) throw new Error('Forbidden');
    if (String(existing.createdBy) !== userId) throw new Error('Forbidden');
    if (existing.isReadOnly) throw new Error('Note is read-only');

    await existing.deleteOne();

    // Clean up GM Screen references to this note.
    // Best-effort: the note is already deleted, so cleanup failure must not
    // surface as a user-facing error — report it and move on.
    try {
      await removeDocumentRefsFromScreens(data.campaignId, 'note', data.id);
    } catch (cleanupError) {
      serverCaptureException(cleanupError, sessionUserId, {
        action: 'deleteNote.cleanup',
        campaignId: data.campaignId,
        noteId: data.id,
      });
    }

    serverCaptureEvent(sessionUserId, 'note_deleted', {
      campaign_id: data.campaignId,
      note_id: data.id,
      deleted_by: userId,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'deleteNote', noteId: data.id });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// listNotes
// ---------------------------------------------------------------------------

export { listNotesSchema };

export const listNotes = async ({ data }: { data: z.infer<typeof listNotesSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    // Build query filter
    const filter: Record<string, unknown> = { campaignId: data.campaignId };

    if (data.sessionId === '__none__') {
      filter.sessionId = { $exists: false };
    } else if (data.sessionId) {
      filter.sessionId = data.sessionId;
    }

    if (data.visibility === 'public') {
      filter.isPublic = true;
    } else if (data.visibility === 'private') {
      filter.isPublic = false;
      filter.createdBy = userId;
    } else {
      // visibility='all' (default): only notes the user is allowed to see
      filter.$or = [{ isPublic: true }, { createdBy: userId }];
    }

    if (data.search && data.search.trim()) {
      filter.$text = { $search: data.search.trim() };
    }

    if (data.tags && data.tags.length > 0) {
      const normalizedTags = [...new Set(normalizeTags(data.tags))];
      if (normalizedTags.length > 0) {
        filter.tags = { $all: normalizedTags };
      }
    }

    const docs = await Note.find(filter).select('-note').sort({ updatedAt: -1 }).lean();

    return (
      docs as Array<{
        _id: unknown;
        campaignId: unknown;
        sessionId: unknown;
        createdBy: unknown;
        title?: string;
        tags?: string[];
        isPublic?: boolean;
        createdAt?: Date;
        updatedAt?: Date;
      }>
    ).map(serializeNoteListItem);
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'listNotes',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// getNote
// ---------------------------------------------------------------------------

export { getNoteSchema };

export const getNote = async ({ data }: { data: z.infer<typeof getNoteSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const doc = await Note.findById(data.id);
    if (!doc) return null;
    if (String(doc.campaignId) !== data.campaignId) return null;

    // Private notes are only visible to the creator
    if (!doc.isPublic && String(doc.createdBy) !== userId) {
      return null;
    }

    return serializeNote(doc);
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'getNote', noteId: data.id });
    throw e;
  }
};
