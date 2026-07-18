import React, { useMemo } from 'react';
import type { NoteListItem } from '~/types/note';
import type { CampaignData } from '~/types/campaign';
import { fromNow } from '~/utils/date';
import { Calendar, Tag, Lock, Globe } from 'lucide-react';
import { WikiCardMenu } from '~/components/wiki/shared/WikiCardMenu';

type Session = CampaignData['sessions'][number];

interface NotesListWidgetProps {
  notes: NoteListItem[];
  sessions: CampaignData['sessions'];
  isLoading: boolean;
  error: string | null;
  onNoteClick: (note: NoteListItem) => void;
  /** Delete a note (owner only). Absent → the card menu omits Delete. */
  onNoteDelete?: (note: NoteListItem) => void;
}

export function NotesListWidget({
  notes,
  sessions,
  isLoading,
  error,
  onNoteClick,
  onNoteDelete,
}: NotesListWidgetProps) {
  const sessionMap = useMemo(() => {
    return sessions.reduce(
      (acc, s) => {
        acc[s.id] = s;
        return acc;
      },
      {} as Record<string, Session>
    );
  }, [sessions]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
          Loading notes...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
          <Tag className="h-6 w-6 text-slate-600" />
        </div>
        <p className="font-sans font-semibold text-xs text-slate-500">
          No notes found matching your filters.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="flex flex-col">
        {notes.map((note) => {
          const session = note.sessionId ? sessionMap[note.sessionId] : undefined;
          return (
            <div
              key={note.id}
              role="button"
              tabIndex={0}
              draggable="true"
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'application/x-cartyx-document',
                  JSON.stringify({
                    collection: 'note',
                    documentId: note.id,
                    title: note.title,
                  })
                );
                e.dataTransfer.effectAllowed = 'copy';
                e.currentTarget.style.opacity = '0.4';
              }}
              onDragEnd={(e) => {
                e.currentTarget.style.opacity = '';
              }}
              onClick={() => onNoteClick(note)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNoteClick(note);
                }
              }}
              className="relative flex flex-col gap-2 p-4 text-left border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors group cursor-grab active:cursor-grabbing"
            >
              {/* Overflow menu. Not draggable, and swallows its own clicks so
                  interacting with it never opens or drags the note. */}
              <div
                className="absolute right-2 top-2"
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="presentation"
              >
                <WikiCardMenu
                  collection="note"
                  documentId={note.id}
                  label="Note actions"
                  canEdit={note.canEdit}
                  canDelete={note.canEdit}
                  onEdit={() => onNoteClick(note)}
                  onDelete={onNoteDelete ? () => onNoteDelete(note) : undefined}
                />
              </div>

              <div className="flex items-start justify-between gap-3 pr-7">
                <h3 className="font-sans font-bold text-sm text-slate-200 group-hover:text-blue-400 transition-colors line-clamp-1">
                  {note.title}
                </h3>
                <div className="shrink-0 pt-0.5">
                  {note.isPublic ? (
                    <Globe className="h-3 w-3 text-slate-600" aria-label="Public note" />
                  ) : (
                    <Lock className="h-3 w-3 text-slate-600" aria-label="Private note" />
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="flex items-center gap-1.5 text-slate-500">
                  <Calendar className="h-3 w-3" />
                  <span className="font-sans font-semibold text-[10px] uppercase tracking-wider">
                    {session ? `Session ${session.number}` : 'No Session'}
                  </span>
                </div>
                <div className="text-slate-600 font-sans text-[10px] uppercase tracking-wider">
                  Updated {fromNow(note.updatedAt)}
                </div>
              </div>

              {note.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-0.5">
                  {note.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-sans font-bold text-[9px] tracking-tight"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
