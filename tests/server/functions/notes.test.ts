import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: unknown) => fn,
    }),
    handler: (fn: unknown) => fn,
  }),
}));

vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/db/connection', () => ({
  connectDB: vi.fn(),
  isDBConnected: vi.fn(() => true),
}));
vi.mock('~/server/db/models/User', () => ({
  User: { findOne: vi.fn() },
}));
vi.mock('~/server/db/models/Campaign', () => ({
  Campaign: { findById: vi.fn() },
}));
vi.mock('~/server/db/models/Note', () => ({
  Note: {
    create: vi.fn(),
    findById: vi.fn(),
    find: vi.fn(),
  },
}));
vi.mock('~/server/db/models/Tag', () => ({
  Tag: {
    bulkWrite: vi.fn().mockResolvedValue({}),
    find: vi.fn(),
  },
}));
vi.mock('~/server/functions/gmscreens-helpers', () => ({
  removeDocumentRefsFromScreens: vi.fn().mockResolvedValue(0),
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Note } from '~/server/db/models/Note';
import {
  createNote,
  updateNote,
  deleteNote,
  listNotes,
  getNote,
  createNoteSchema,
  updateNoteSchema,
  listNotesSchema,
} from '~/server/functions/notes';
import type { NoteListItem } from '~/types/note';
import { removeDocumentRefsFromScreens } from '~/server/functions/gmscreens-helpers';

const mockSession = {
  id: 'session-user-1',
  provider: 'google',
  name: 'Test User',
  email: 'test@example.com',
  avatar: null,
  role: 'gm',
  accessToken: null,
  refreshToken: null,
  tokenIssuedAt: 0,
};
const mockDbUser = { _id: 'dbuser-1', firstName: 'Test', lastName: 'User' };
const mockCampaign = {
  _id: 'camp-1',
  gameMasterId: 'dbuser-1',
  members: [{ userId: 'dbuser-1', role: 'gm' }],
};

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'note-1',
    campaignId: 'camp-1',
    sessionId: 'sess-1',
    createdBy: 'dbuser-1',
    title: 'Test Note',
    note: '# Hello\n\nThis is a test note.',
    tags: ['combat', 'loot'],
    isPublic: false,
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    save: vi.fn(),
    deleteOne: vi.fn(),
    ...overrides,
  };
}

// Cast server functions to callable handler signatures
const _createNote = createNote as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean; note: Record<string, unknown> }>;
const _updateNote = updateNote as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean; note: Record<string, unknown> }>;
const _listNotes = listNotes as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<NoteListItem[]>;
const _deleteNote = deleteNote as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean }>;
const _getNote = getNote as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<Record<string, unknown> | null>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession);
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser as never);
  vi.mocked(Campaign.findById).mockResolvedValue(mockCampaign);
});

// ---------------------------------------------------------------------------
// createNote
// ---------------------------------------------------------------------------

describe('createNote', () => {
  it('creates a note with required fields and normalized tags', async () => {
    const created = makeNote();
    vi.mocked(Note.create).mockResolvedValue(created as never);

    const result = await _createNote({
      data: {
        campaignId: 'camp-1',
        sessionId: 'sess-1',
        title: '  My Note  ',
        note: '# Content',
        tags: [' Combat ', 'LOOT', ' combat '],
      },
    });

    expect(result.success).toBe(true);
    expect(result.note.id).toBe('note-1');
    // Verify tags were normalized (lowercase, trimmed, deduplicated)
    expect(vi.mocked(Note.create).mock.calls[0][0]).toMatchObject({
      title: 'My Note',
      note: '# Content',
      tags: ['combat', 'loot'],
    });
  });

  it('defaults isPublic to false when omitted', async () => {
    vi.mocked(Note.create).mockResolvedValue(makeNote() as never);

    await _createNote({
      data: {
        campaignId: 'camp-1',
        sessionId: 'sess-1',
        title: 'My Note',
        note: 'body',
      },
    });

    expect(vi.mocked(Note.create).mock.calls[0][0]).toMatchObject({
      isPublic: false,
    });
  });

  it('allows explicitly setting isPublic to true', async () => {
    vi.mocked(Note.create).mockResolvedValue(makeNote({ isPublic: true }) as never);

    await _createNote({
      data: {
        campaignId: 'camp-1',
        sessionId: 'sess-1',
        title: 'Public Note',
        note: 'body',
        isPublic: true,
      },
    });

    expect(vi.mocked(Note.create).mock.calls[0][0]).toMatchObject({
      isPublic: true,
    });
  });

  it('throws when not authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    await expect(
      _createNote({ data: { campaignId: 'camp-1', sessionId: 'sess-1', title: 'T', note: 'B' } })
    ).rejects.toThrow('Not authenticated');
  });

  it('throws when user is not a campaign member', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: 'camp-1',
      gameMasterId: 'someone-else',
      members: [{ userId: 'someone-else', role: 'gm' }],
    });

    await expect(
      _createNote({ data: { campaignId: 'camp-1', sessionId: 'sess-1', title: 'T', note: 'B' } })
    ).rejects.toThrow('Forbidden');
  });

  it('creates a note without sessionId when omitted', async () => {
    const created = makeNote({ sessionId: undefined });
    vi.mocked(Note.create).mockResolvedValue(created as never);

    const result = await _createNote({
      data: {
        campaignId: 'camp-1',
        title: 'No Session Note',
        note: 'body',
      },
    });

    expect(result.success).toBe(true);
    expect(result.note.sessionId).toBeUndefined();
    const createArg = vi.mocked(Note.create).mock.calls[0][0] as Record<string, unknown>;
    expect(createArg).not.toHaveProperty('sessionId');
  });

  it('does not persist the "__none__" sessionId sentinel', async () => {
    const created = makeNote({ sessionId: undefined });
    vi.mocked(Note.create).mockResolvedValue(created as never);

    const result = await _createNote({
      data: {
        campaignId: 'camp-1',
        sessionId: '__none__',
        title: 'Sentinel Session Note',
        note: 'body',
      },
    });

    expect(result.success).toBe(true);
    expect(result.note.sessionId).toBeUndefined();
    const createArg = vi.mocked(Note.create).mock.calls[0][0] as Record<string, unknown>;
    expect(createArg).not.toHaveProperty('sessionId');
  });
});

// ---------------------------------------------------------------------------
// updateNote
// ---------------------------------------------------------------------------

describe('updateNote', () => {
  it('updates an existing note', async () => {
    const existing = makeNote();
    vi.mocked(Note.findById).mockResolvedValue(existing as never);

    const result = await _updateNote({
      data: {
        id: 'note-1',
        campaignId: 'camp-1',
        sessionId: 'sess-2',
        title: 'Updated Title',
        note: 'Updated body',
        tags: ['new-tag'],
      },
    });

    expect(result.success).toBe(true);
    expect(existing.save).toHaveBeenCalled();
    expect(existing.title).toBe('Updated Title');
    expect(existing.note).toBe('Updated body');
    expect(existing.tags).toEqual(['new-tag']);
    expect(existing.sessionId).toBe('sess-2');
  });

  it('clears sessionId when omitted from update', async () => {
    const existing = makeNote();
    vi.mocked(Note.findById).mockResolvedValue(existing as never);

    const result = await _updateNote({
      data: {
        id: 'note-1',
        campaignId: 'camp-1',
        title: 'Updated Title',
        note: 'Updated body',
      },
    });

    expect(result.success).toBe(true);
    expect(existing.sessionId).toBeUndefined();
    expect(existing.save).toHaveBeenCalled();
  });

  it('clears sessionId when update receives the __none__ sentinel', async () => {
    const existing = makeNote({ sessionId: 'sess-1' });
    vi.mocked(Note.findById).mockResolvedValue(existing as never);

    const result = await _updateNote({
      data: {
        id: 'note-1',
        campaignId: 'camp-1',
        sessionId: '__none__',
        title: 'Updated Title',
        note: 'Updated body',
      },
    });

    expect(result.success).toBe(true);
    expect(existing.sessionId).toBeUndefined();
    expect(existing.sessionId).not.toBe('__none__');
    expect(existing.save).toHaveBeenCalled();
  });

  it('throws when note is not found', async () => {
    vi.mocked(Note.findById).mockResolvedValue(null);

    await expect(
      _updateNote({
        data: {
          id: 'nonexistent',
          campaignId: 'camp-1',
          sessionId: 'sess-1',
          title: 'T',
          note: 'B',
        },
      })
    ).rejects.toThrow('Note not found');
  });

  it('throws when note belongs to a different campaign', async () => {
    const existing = makeNote({ campaignId: 'camp-other' });
    vi.mocked(Note.findById).mockResolvedValue(existing as never);

    await expect(
      _updateNote({
        data: { id: 'note-1', campaignId: 'camp-1', sessionId: 'sess-1', title: 'T', note: 'B' },
      })
    ).rejects.toThrow('Forbidden');
  });

  it('throws when user does not own the note', async () => {
    const existing = makeNote({ createdBy: 'other-user' });
    vi.mocked(Note.findById).mockResolvedValue(existing as never);

    await expect(
      _updateNote({
        data: { id: 'note-1', campaignId: 'camp-1', sessionId: 'sess-1', title: 'T', note: 'B' },
      })
    ).rejects.toThrow('Forbidden');
  });

  it('throws when note is read-only', async () => {
    const existing = makeNote({ isReadOnly: true });
    vi.mocked(Note.findById).mockResolvedValue(existing as never);

    await expect(
      _updateNote({
        data: { id: 'note-1', campaignId: 'camp-1', sessionId: 'sess-1', title: 'T', note: 'B' },
      })
    ).rejects.toThrow('Note is read-only');
    expect(existing.save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listNotes
// ---------------------------------------------------------------------------

describe('listNotes', () => {
  it('returns notes for a campaign (default visibility filters to visible notes)', async () => {
    const notes = [makeNote(), makeNote({ _id: 'note-2', title: 'Second Note' })];
    vi.mocked(Note.find).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(notes) }),
      }),
    } as never);

    const result = await _listNotes({ data: { campaignId: 'camp-1' } });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('note-1');
    expect(result[1].title).toBe('Second Note');
    // Default visibility='all' adds $or filter for privacy safety
    expect(vi.mocked(Note.find).mock.calls[0][0]).toMatchObject({
      campaignId: 'camp-1',
      $or: [{ isPublic: true }, { createdBy: 'dbuser-1' }],
    });
  });

  it('does not return other users private notes with default visibility', async () => {
    // Simulate: another user's private note would be filtered by the $or clause
    vi.mocked(Note.find).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
      }),
    } as never);

    await _listNotes({ data: { campaignId: 'camp-1' } });

    const filter = vi.mocked(Note.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    // The $or ensures only public notes or the current user's notes are returned
    expect(filter.$or).toEqual([{ isPublic: true }, { createdBy: 'dbuser-1' }]);
    // No unscoped query that would leak private notes
    expect(filter).not.toHaveProperty('isPublic');
    expect(filter).not.toHaveProperty('createdBy');
  });

  it('list responses omit note body field', async () => {
    const notes = [makeNote()];
    vi.mocked(Note.find).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(notes) }),
      }),
    } as never);

    const result = await _listNotes({ data: { campaignId: 'camp-1' } });

    // NoteListItem does not include 'note' field
    expect(result[0]).not.toHaveProperty('note');
  });

  it('filters by sessionId', async () => {
    vi.mocked(Note.find).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
      }),
    } as never);

    await _listNotes({ data: { campaignId: 'camp-1', sessionId: 'sess-2' } });

    expect(vi.mocked(Note.find).mock.calls[0][0]).toMatchObject({
      campaignId: 'camp-1',
      sessionId: 'sess-2',
    });
  });

  it('filters by visibility=public', async () => {
    vi.mocked(Note.find).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
      }),
    } as never);

    await _listNotes({ data: { campaignId: 'camp-1', visibility: 'public' } });

    expect(vi.mocked(Note.find).mock.calls[0][0]).toMatchObject({
      isPublic: true,
    });
  });

  it('filters by visibility=private (own notes only)', async () => {
    vi.mocked(Note.find).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
      }),
    } as never);

    await _listNotes({ data: { campaignId: 'camp-1', visibility: 'private' } });

    expect(vi.mocked(Note.find).mock.calls[0][0]).toMatchObject({
      isPublic: false,
      createdBy: 'dbuser-1',
    });
  });

  it('applies text search filter', async () => {
    vi.mocked(Note.find).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
      }),
    } as never);

    await _listNotes({ data: { campaignId: 'camp-1', search: 'dragon' } });

    expect(vi.mocked(Note.find).mock.calls[0][0]).toMatchObject({
      $text: { $search: 'dragon' },
    });
  });

  it('ignores empty search string', async () => {
    vi.mocked(Note.find).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
      }),
    } as never);

    await _listNotes({ data: { campaignId: 'camp-1', search: '   ' } });

    expect(vi.mocked(Note.find).mock.calls[0][0]).not.toHaveProperty('$text');
  });

  it('filters for notes with no session when sessionId is "__none__"', async () => {
    vi.mocked(Note.find).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
      }),
    } as never);

    await _listNotes({ data: { campaignId: 'camp-1', sessionId: '__none__' } });

    const filter = vi.mocked(Note.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(filter.sessionId).toEqual({ $exists: false });
  });

  it('throws when not authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    await expect(_listNotes({ data: { campaignId: 'camp-1' } })).rejects.toThrow(
      'Not authenticated'
    );
  });
});

// ---------------------------------------------------------------------------
// getNote
// ---------------------------------------------------------------------------

describe('getNote', () => {
  it('returns a note for the owner', async () => {
    const note = makeNote();
    vi.mocked(Note.findById).mockResolvedValue(note as never);

    const result = await _getNote({ data: { id: 'note-1', campaignId: 'camp-1' } });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('note-1');
  });

  it('returns null when note does not exist', async () => {
    vi.mocked(Note.findById).mockResolvedValue(null);

    const result = await _getNote({ data: { id: 'nonexistent', campaignId: 'camp-1' } });

    expect(result).toBeNull();
  });

  it('returns null for private notes not owned by the user', async () => {
    const note = makeNote({ createdBy: 'other-user', isPublic: false });
    vi.mocked(Note.findById).mockResolvedValue(note as never);

    const result = await _getNote({ data: { id: 'note-1', campaignId: 'camp-1' } });

    expect(result).toBeNull();
  });

  it('returns public notes even from other users', async () => {
    const note = makeNote({ createdBy: 'other-user', isPublic: true });
    vi.mocked(Note.findById).mockResolvedValue(note as never);

    const result = await _getNote({ data: { id: 'note-1', campaignId: 'camp-1' } });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('note-1');
  });

  it('returns null when note belongs to a different campaign', async () => {
    const note = makeNote({ campaignId: 'camp-other' });
    vi.mocked(Note.findById).mockResolvedValue(note as never);

    const result = await _getNote({ data: { id: 'note-1', campaignId: 'camp-1' } });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteNote
// ---------------------------------------------------------------------------

describe('deleteNote', () => {
  it('deletes a note and cleans up GM Screen refs', async () => {
    const existing = makeNote({ deleteOne: vi.fn() });
    vi.mocked(Note.findById).mockResolvedValue(existing as never);

    const result = await _deleteNote({ data: { id: 'note-1', campaignId: 'camp-1' } });

    expect(result.success).toBe(true);
    expect(existing.deleteOne).toHaveBeenCalled();
    expect(removeDocumentRefsFromScreens).toHaveBeenCalledWith('camp-1', 'note', 'note-1');
  });

  it('throws when note is not found', async () => {
    vi.mocked(Note.findById).mockResolvedValue(null);

    await expect(
      _deleteNote({ data: { id: 'nonexistent', campaignId: 'camp-1' } })
    ).rejects.toThrow('Note not found');
  });

  it('throws when note belongs to a different campaign', async () => {
    const existing = makeNote({ campaignId: 'camp-other' });
    vi.mocked(Note.findById).mockResolvedValue(existing as never);

    await expect(_deleteNote({ data: { id: 'note-1', campaignId: 'camp-1' } })).rejects.toThrow(
      'Forbidden'
    );
  });

  it('throws when user does not own the note', async () => {
    const existing = makeNote({ createdBy: 'other-user' });
    vi.mocked(Note.findById).mockResolvedValue(existing as never);

    await expect(_deleteNote({ data: { id: 'note-1', campaignId: 'camp-1' } })).rejects.toThrow(
      'Forbidden'
    );
  });

  it('throws when note is read-only', async () => {
    const existing = makeNote({ isReadOnly: true });
    vi.mocked(Note.findById).mockResolvedValue(existing as never);

    await expect(_deleteNote({ data: { id: 'note-1', campaignId: 'camp-1' } })).rejects.toThrow(
      'Note is read-only'
    );
  });

  it('succeeds even when cleanup fails', async () => {
    const existing = makeNote({ deleteOne: vi.fn() });
    vi.mocked(Note.findById).mockResolvedValue(existing as never);
    const cleanupError = new Error('MongoDB timeout during cleanup');
    vi.mocked(removeDocumentRefsFromScreens).mockRejectedValueOnce(cleanupError);

    const result = await _deleteNote({ data: { id: 'note-1', campaignId: 'camp-1' } });

    expect(result.success).toBe(true);
    expect(existing.deleteOne).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Zod schemas — validation
// ---------------------------------------------------------------------------

describe('createNoteSchema', () => {
  it('rejects when title is empty', () => {
    const result = createNoteSchema.safeParse({
      campaignId: 'camp-1',
      sessionId: 'sess-1',
      title: '',
      note: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when note body is empty', () => {
    const result = createNoteSchema.safeParse({
      campaignId: 'camp-1',
      sessionId: 'sess-1',
      title: 'Title',
      note: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only title', () => {
    const result = createNoteSchema.safeParse({
      campaignId: 'camp-1',
      sessionId: 'sess-1',
      title: '   ',
      note: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only note body', () => {
    const result = createNoteSchema.safeParse({
      campaignId: 'camp-1',
      sessionId: 'sess-1',
      title: 'Title',
      note: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only sessionId when provided', () => {
    const result = createNoteSchema.safeParse({
      campaignId: 'camp-1',
      sessionId: '   ',
      title: 'Title',
      note: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('accepts when sessionId is omitted', () => {
    const result = createNoteSchema.safeParse({
      campaignId: 'camp-1',
      title: 'Title',
      note: 'body',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBeUndefined();
    }
  });

  it('rejects whitespace-only campaignId', () => {
    const result = createNoteSchema.safeParse({
      campaignId: '   ',
      sessionId: 'sess-1',
      title: 'Title',
      note: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid input with defaults', () => {
    const result = createNoteSchema.safeParse({
      campaignId: 'camp-1',
      sessionId: 'sess-1',
      title: 'Title',
      note: 'body',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isPublic).toBe(false);
      expect(result.data.tags).toEqual([]);
    }
  });
});

describe('updateNoteSchema', () => {
  it('rejects when id is missing', () => {
    const result = updateNoteSchema.safeParse({
      campaignId: 'camp-1',
      sessionId: 'sess-1',
      title: 'Title',
      note: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when title is empty', () => {
    const result = updateNoteSchema.safeParse({
      id: 'note-1',
      campaignId: 'camp-1',
      sessionId: 'sess-1',
      title: '',
      note: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only title', () => {
    const result = updateNoteSchema.safeParse({
      id: 'note-1',
      campaignId: 'camp-1',
      sessionId: 'sess-1',
      title: '   ',
      note: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only note body', () => {
    const result = updateNoteSchema.safeParse({
      id: 'note-1',
      campaignId: 'camp-1',
      sessionId: 'sess-1',
      title: 'Title',
      note: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only sessionId when provided', () => {
    const result = updateNoteSchema.safeParse({
      id: 'note-1',
      campaignId: 'camp-1',
      sessionId: '   ',
      title: 'Title',
      note: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('accepts when sessionId is omitted', () => {
    const result = updateNoteSchema.safeParse({
      id: 'note-1',
      campaignId: 'camp-1',
      title: 'Title',
      note: 'body',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBeUndefined();
    }
  });
});

describe('listNotesSchema', () => {
  it('defaults visibility to all', () => {
    const result = listNotesSchema.safeParse({ campaignId: 'camp-1' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe('all');
    }
  });

  it('rejects invalid visibility value', () => {
    const result = listNotesSchema.safeParse({ campaignId: 'camp-1', visibility: 'secret' });
    expect(result.success).toBe(false);
  });
});
