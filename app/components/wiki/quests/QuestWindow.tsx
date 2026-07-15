import type React from 'react';
import { Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { QuestData, QuestLink, QuestLinkKind, QuestStatus } from '~/types/quest';
import type { PictureCrop } from '~/types/character';
import { MARKDOWN_PROSE_CLASSES } from '~/utils/markdownProseClasses';

const STATUS_LABELS: Record<QuestStatus, string> = {
  not_started: 'Not started',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  failed: 'Failed',
};

const LINK_KIND_LABELS: Record<QuestLinkKind, string> = {
  character: 'Characters',
  player: 'Players',
  location: 'Locations',
  organization: 'Organizations',
};

const LINK_KIND_ORDER: QuestLinkKind[] = ['character', 'player', 'location', 'organization'];

function getCropStyle(crop: PictureCrop): React.CSSProperties {
  const centerX = (crop.x + crop.width / 2) * 100;
  const centerY = (crop.y + crop.height / 2) * 100;
  const scale = 1 / crop.width;
  return {
    objectPosition: `${centerX}% ${centerY}%`,
    transform: `scale(${scale})`,
  };
}

interface QuestWindowProps {
  quest: QuestData;
  onEdit?: () => void;
}

export function QuestWindow({ quest, onEdit }: QuestWindowProps) {
  const showMeta = quest.tags.length > 0 || (quest.canEdit && !!onEdit);

  const linksByKind = LINK_KIND_ORDER.map((kind) => ({
    kind,
    items: quest.links.filter((l) => l.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col h-full" data-testid="quest-window">
      {showMeta && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.05] shrink-0">
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {quest.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-sans font-bold text-[9px] tracking-tight"
              >
                #{tag}
              </span>
            ))}
          </div>
          {quest.canEdit && onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="shrink-0 p-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white transition-colors"
              aria-label="Edit quest"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 min-h-0 space-y-5">
        {/* Header: name, status, type, giver */}
        <div className="space-y-2">
          <h3 className="text-base font-bold text-slate-100">{quest.name}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-slate-300 font-sans font-bold text-[10px] uppercase tracking-tight">
              {STATUS_LABELS[quest.status]}
            </span>
            {quest.type && <span className="text-xs text-slate-400">{quest.type}</span>}
          </div>
          {quest.giver && quest.giver.label && (
            <p className="text-xs text-slate-400">
              Given by: <span className="text-slate-200 font-semibold">{quest.giver.label}</span>
            </p>
          )}
        </div>

        {/* Parent quest + sub-quests */}
        {(quest.parentQuest || quest.subQuests.length > 0) && (
          <div className="space-y-2">
            {quest.parentQuest && (
              <p className="text-xs text-slate-400">
                Part of:{' '}
                <span className="text-blue-400 font-semibold">{quest.parentQuest.name}</span>
              </p>
            )}
            {quest.subQuests.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                  Sub-quests
                </p>
                <div className="flex flex-col gap-1">
                  {quest.subQuests.map((sq) => (
                    <div
                      key={sq.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5"
                    >
                      <span className="text-xs font-semibold text-slate-200 truncate">
                        {sq.name}
                      </span>
                      <span className="text-[10px] text-slate-500 shrink-0 uppercase tracking-tight">
                        {STATUS_LABELS[sq.status]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Images gallery */}
        {quest.images.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Images</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {quest.images.map((image, idx) => (
                <div key={idx} className="flex flex-col gap-1">
                  <div className="w-full aspect-square overflow-hidden rounded-lg border border-white/[0.08]">
                    <img
                      src={image.url}
                      alt={image.caption || `Quest image ${idx + 1}`}
                      className="w-full h-full object-cover"
                      style={image.crop ? getCropStyle(image.crop) : undefined}
                    />
                  </div>
                  {image.caption && (
                    <p className="text-[10px] text-slate-500 text-center leading-tight">
                      {image.caption}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Public info */}
        {quest.publicInfo && (
          <div className={MARKDOWN_PROSE_CLASSES}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{quest.publicInfo}</ReactMarkdown>
          </div>
        )}

        {/* GM-only private info */}
        {quest.privateInfo && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80 mb-2">
              GM Only
            </p>
            <div className={MARKDOWN_PROSE_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{quest.privateInfo}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* Linked entities, grouped by kind */}
        {linksByKind.map((group) => (
          <div key={group.kind}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
              {LINK_KIND_LABELS[group.kind]}
            </p>
            <div className="flex flex-col gap-2">
              {group.items.map((link: QuestLink) => (
                <div
                  key={`${link.kind}-${link.id}`}
                  className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-200 truncate">
                      {link.label || 'Unknown'}
                    </span>
                    {link.role && (
                      <span className="text-[11px] text-blue-400 shrink-0">{link.role}</span>
                    )}
                  </div>
                  {link.publicInfo && (
                    <div className={`${MARKDOWN_PROSE_CLASSES} mt-1`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{link.publicInfo}</ReactMarkdown>
                    </div>
                  )}
                  {link.privateInfo && (
                    <div className="mt-1 rounded border border-amber-500/20 bg-amber-500/[0.04] px-2 py-1">
                      <div className={MARKDOWN_PROSE_CLASSES}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {link.privateInfo}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Linked events */}
        {quest.events.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
              Events
            </p>
            <div className="flex flex-col gap-2">
              {quest.events.map((ev) => (
                <div
                  key={ev.eventId}
                  className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-200 truncate">
                      {ev.label || 'Unknown event'}
                    </span>
                    {ev.role && (
                      <span className="text-[11px] text-blue-400 shrink-0">{ev.role}</span>
                    )}
                  </div>
                  {ev.publicInfo && (
                    <div className={`${MARKDOWN_PROSE_CLASSES} mt-1`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{ev.publicInfo}</ReactMarkdown>
                    </div>
                  )}
                  {ev.privateInfo && (
                    <div className="mt-1 rounded border border-amber-500/20 bg-amber-500/[0.04] px-2 py-1">
                      <div className={MARKDOWN_PROSE_CLASSES}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{ev.privateInfo}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
