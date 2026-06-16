import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Widget } from '~/components/mainview/Widget';
import { CharacterViewModal } from '~/components/wiki/characters/CharacterViewModal';
import { useCharacters } from '~/hooks/useCharacters';
import type { CharacterListItem } from '~/types/character';
import type { KeyAlly } from '~/services/mocks/types';

/** Characters carrying this tag are surfaced as key allies. */
const ALLY_TAG = 'ally';

/** Allies shown per page before the widget paginates. */
const PAGE_SIZE = 10;

export interface KeyAlliesWidgetProps {
  /**
   * Explicit allies to render. When provided, the widget renders these
   * directly and skips fetching — used by Storybook and tests. In the app the
   * widget fetches the campaign's characters tagged `ally` via `campaignId`.
   */
  allies?: ReadonlyArray<Readonly<KeyAlly>>;
  campaignId?: string;
  className?: string;
}

function characterToAlly(character: CharacterListItem): KeyAlly {
  return {
    id: character.id,
    name: `${character.firstName} ${character.lastName}`.trim(),
    town: character.location,
    avatarUrl: character.picture || undefined,
  };
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function KeyAlliesWidget({ allies, campaignId, className = '' }: KeyAlliesWidgetProps) {
  // Hook is always called (React rules); its result is ignored when `allies`
  // is provided. useCharacters is disabled when campaignId is falsy.
  const {
    characters,
    isLoading,
    error: fetchError,
  } = useCharacters(campaignId ?? '', { tags: [ALLY_TAG] });

  const resolvedAllies: KeyAlly[] = allies
    ? allies.map((ally) => ({ ...ally }))
    : characters.map(characterToAlly);

  const isFetching = !allies && isLoading;
  const error = !allies && fetchError ? 'Unable to load allies.' : null;

  const totalPages = Math.max(1, Math.ceil(resolvedAllies.length / PAGE_SIZE));
  const [page, setPage] = useState(0);

  // Clamp the page when the dataset shrinks (e.g. a refetch returns fewer allies).
  useEffect(() => {
    setPage((current) => Math.min(current, totalPages - 1));
  }, [totalPages]);

  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const pageAllies = resolvedAllies.slice(start, start + PAGE_SIZE);
  const showPager = resolvedAllies.length > PAGE_SIZE;

  // Clicking a card opens the read-only character popup, but only when we know
  // which campaign to fetch the full character from (the app always passes
  // campaignId; Storybook/tests render explicit allies without one).
  const [selectedAllyId, setSelectedAllyId] = useState<string | null>(null);
  const canOpenDetail = Boolean(campaignId);

  return (
    <Widget title="Key Allies" className={className}>
      {isFetching ? (
        <p className="font-sans font-semibold text-xs text-slate-500">Loading allies...</p>
      ) : error ? (
        <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
      ) : resolvedAllies.length === 0 ? (
        <p className="font-sans font-semibold text-xs text-slate-500">No allies found</p>
      ) : (
        <div className="space-y-3">
          {pageAllies.map((ally) => {
            const cardClass =
              'flex w-full items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-left';
            const cardBody = (
              <>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/[0.07] bg-slate-800 font-sans font-semibold text-xs text-white">
                  {ally.avatarUrl ? (
                    <img
                      src={ally.avatarUrl}
                      alt={ally.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span aria-hidden="true">{getInitials(ally.name)}</span>
                  )}
                </div>

                <div className="min-w-0">
                  <p className="truncate font-sans font-semibold text-xs text-white">{ally.name}</p>
                  <p className="truncate font-sans font-semibold text-xs text-slate-400">
                    {ally.town}
                  </p>
                </div>
              </>
            );

            // Only render an interactive control when a detail view is actually
            // reachable (needs campaignId). Otherwise render a plain row so
            // assistive tech isn't presented a focusable, do-nothing button.
            return canOpenDetail ? (
              <button
                key={ally.id}
                type="button"
                onClick={() => setSelectedAllyId(ally.id)}
                aria-label={`View ${ally.name}`}
                className={`${cardClass} transition-colors hover:border-white/20 hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60`}
              >
                {cardBody}
              </button>
            ) : (
              <div key={ally.id} className={cardClass}>
                {cardBody}
              </div>
            );
          })}

          {showPager ? (
            <nav
              className="flex items-center justify-between pt-1"
              aria-label="Key allies pagination"
            >
              <p className="font-sans font-semibold text-xs text-slate-500">
                {start + 1}–{start + pageAllies.length} of {resolvedAllies.length}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  disabled={safePage === 0}
                  aria-label="Previous allies"
                  className="rounded-md border border-white/[0.07] p-1 text-slate-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-slate-400"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                  disabled={safePage >= totalPages - 1}
                  aria-label="Next allies"
                  className="rounded-md border border-white/[0.07] p-1 text-slate-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-slate-400"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </nav>
          ) : null}
        </div>
      )}

      {campaignId && selectedAllyId ? (
        <CharacterViewModal
          isOpen={Boolean(selectedAllyId)}
          onClose={() => setSelectedAllyId(null)}
          characterId={selectedAllyId}
          campaignId={campaignId}
        />
      ) : null}
    </Widget>
  );
}
