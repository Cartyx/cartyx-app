import { useState } from 'react';
import { Pencil, Globe, Lock, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { LocationData } from '~/types/location';
import { MARKDOWN_PROSE_CLASSES } from '~/utils/markdownProseClasses';
import { LocationGallery } from './LocationGallery';
import { EntityQuestsTab } from '~/components/shared/EntityQuestsTab';

interface LocationWindowProps {
  location: LocationData;
  isGM?: boolean;
  onEdit?: () => void;
  onOpenLocation?: (locationId: string) => void;
}

type Tab = 'general' | 'gallery' | 'gm-notes' | 'hierarchy' | 'quests';

export function LocationWindow({ location, isGM, onEdit, onOpenLocation }: LocationWindowProps) {
  const [activeTab, setActiveTab] = useState<Tab>('general');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'gallery', label: 'Gallery' },
    ...(isGM ? [{ id: 'gm-notes' as Tab, label: 'GM Notes' }] : []),
    { id: 'hierarchy', label: 'Hierarchy' },
    { id: 'quests', label: 'Quests' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Meta bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.05] shrink-0">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-400 font-sans font-bold text-[9px] tracking-tight capitalize">
          {location.locationType}
        </span>
        {location.isPublic ? (
          <Globe className="h-3 w-3 text-emerald-400 shrink-0" aria-label="Public" />
        ) : (
          <Lock className="h-3 w-3 text-amber-400 shrink-0" aria-label="Private" />
        )}
        {location.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {location.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-sans font-bold text-[9px] tracking-tight"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
        <div className="flex-1" />
        {isGM && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 p-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white transition-colors"
            aria-label="Edit location"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-white/[0.05] shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={[
              'px-3 py-1.5 font-sans font-semibold text-[10px] tracking-wide transition-colors',
              activeTab === tab.id
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-500 hover:text-slate-300',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        {activeTab === 'general' && (
          <div className={MARKDOWN_PROSE_CLASSES}>
            {location.description ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{location.description}</ReactMarkdown>
            ) : (
              <p className="text-xs text-slate-600 italic">No description yet.</p>
            )}
          </div>
        )}

        {activeTab === 'gallery' && <LocationGallery images={location.images} />}

        {activeTab === 'gm-notes' && isGM && (
          <div>
            <div className="flex items-center gap-2 mb-2 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
              <span className="font-sans font-semibold text-[10px] text-amber-400">
                GM Only — not visible to players
              </span>
            </div>
            <div className={MARKDOWN_PROSE_CLASSES}>
              {location.gmNotes ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{location.gmNotes}</ReactMarkdown>
              ) : (
                <p className="text-xs text-slate-600 italic">No GM notes yet.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'hierarchy' && (
          <div className="space-y-3">
            {location.parentLocations.length > 0 && (
              <div>
                <h4 className="font-sans font-bold text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  Located In
                </h4>
                <ul className="space-y-1">
                  {location.parentLocations.map((ref) => (
                    <li key={ref.id}>
                      <button
                        type="button"
                        onClick={() => onOpenLocation?.(ref.id)}
                        className="flex items-center gap-2 w-full text-left text-xs text-slate-300 px-2 py-1.5 bg-white/[0.02] rounded hover:bg-white/[0.06] hover:text-blue-400 transition-colors"
                      >
                        <span>{ref.name}</span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-400 font-sans font-bold text-[8px] tracking-tight capitalize">
                          {ref.locationType}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {location.childLocations.length > 0 && (
              <div>
                <h4 className="font-sans font-bold text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  Contains
                </h4>
                <ul className="space-y-1">
                  {location.childLocations.map((ref) => (
                    <li key={ref.id}>
                      <button
                        type="button"
                        onClick={() => onOpenLocation?.(ref.id)}
                        className="flex items-center gap-2 w-full text-left text-xs text-slate-300 px-2 py-1.5 bg-white/[0.02] rounded hover:bg-white/[0.06] hover:text-blue-400 transition-colors"
                      >
                        <span>{ref.name}</span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-400 font-sans font-bold text-[8px] tracking-tight capitalize">
                          {ref.locationType}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {location.parentLocations.length === 0 && location.childLocations.length === 0 && (
              <p className="text-xs text-slate-600 italic">No location hierarchy configured yet.</p>
            )}
          </div>
        )}

        {activeTab === 'quests' && (
          <EntityQuestsTab campaignId={location.campaignId} kind="location" id={location.id} />
        )}
      </div>
    </div>
  );
}
