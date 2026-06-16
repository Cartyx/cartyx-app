import React from 'react';
import { Globe, Lock, Pencil, Trash2, Plus } from 'lucide-react';
import type { LoreListItem } from '~/types/lore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoreListProps {
  lore: LoreListItem[];
  canManage: boolean;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LoreList({ lore, canManage, onAdd, onOpen, onEdit, onRemove }: LoreListProps) {
  return (
    <div className="flex flex-col gap-2">
      {canManage && (
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors mb-1"
        >
          <Plus className="h-3.5 w-3.5" />
          Add lore
        </button>
      )}

      {lore.length === 0 && <p className="text-xs text-slate-500">No lore yet.</p>}

      {lore.map((entry) => (
        <div
          key={entry.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(entry.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen(entry.id);
            }
          }}
          className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 hover:bg-white/[0.04] transition-colors cursor-pointer"
        >
          {/* Title */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-200 truncate">{entry.title}</p>
          </div>

          {/* Public / Private badge */}
          {entry.isPublic ? (
            <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
              <Globe className="h-2.5 w-2.5" />
              Public
            </span>
          ) : (
            <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20">
              <Lock className="h-2.5 w-2.5" />
              Private
            </span>
          )}

          {/* Action buttons */}
          {canManage && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(entry.id);
                }}
                className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] transition-colors"
                aria-label={`Edit ${entry.title}`}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(entry.id);
                }}
                className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-white/[0.05] transition-colors"
                aria-label={`Remove ${entry.title}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
