import { useState } from 'react';
import { Widget } from '../Widget';
import { PlayerViewModal } from '~/components/wiki/players/PlayerViewModal';
import { usePlayers } from '~/hooks/usePlayers';
import type { PlayerListItem } from '~/types/player';
import type { PartyMember } from '~/services/mocks/types';

export interface PartyMembersWidgetProps {
  /**
   * Explicit members to render. When provided, the widget renders these
   * directly and skips fetching — used by Storybook and tests. In the app the
   * widget fetches the campaign's real players via `campaignId`.
   */
  members?: ReadonlyArray<Readonly<PartyMember>>;
  campaignId?: string;
  className?: string;
}

/** Normalized shape the widget renders, sourced from real players or props. */
interface PartyMemberView {
  id: string;
  name: string;
  characterClass: string;
  race: string;
  avatarUrl?: string;
  color?: string;
}

function playerToView(player: PlayerListItem): PartyMemberView {
  return {
    id: player.id,
    name: `${player.firstName} ${player.lastName}`.trim(),
    characterClass: player.characterClass,
    race: player.race,
    avatarUrl: player.picture || undefined,
    color: player.color,
  };
}

export function PartyMembersWidget({
  members,
  campaignId,
  className = '',
}: PartyMembersWidgetProps) {
  // Hook is always called (React rules); its result is ignored when `members`
  // is provided. usePlayers is disabled when campaignId is falsy.
  const { players, isLoading, error: fetchError } = usePlayers(campaignId ?? '');

  const resolvedMembers: PartyMemberView[] = members
    ? members.map((member) => ({ ...member }))
    : players.map(playerToView);

  const isFetching = !members && isLoading;
  const error = !members && fetchError ? 'Unable to load party members.' : null;

  // Clicking a card opens the read-only player popup, but only when we know
  // which campaign to fetch the full player from (the app always passes
  // campaignId; Storybook/tests render explicit members without one).
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const canOpenDetail = Boolean(campaignId);

  return (
    <Widget title="Party Members" className={className}>
      {isFetching ? (
        <div className="flex items-center justify-center py-8">
          <p className="font-sans font-semibold text-xs text-slate-500">Loading party members...</p>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center py-8">
          <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
        </div>
      ) : resolvedMembers.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <p className="font-sans font-semibold text-xs text-slate-500">No party members found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {resolvedMembers.map((member) => {
            const cardClass =
              'flex w-full items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-left';
            const cardBody = (
              <>
                {member.avatarUrl ? (
                  <img
                    src={member.avatarUrl}
                    alt={`${member.name} avatar`}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-700 font-sans font-semibold text-xs text-slate-200"
                    style={member.color ? { backgroundColor: member.color } : undefined}
                  >
                    {member.name.charAt(0)}
                  </div>
                )}

                <div className="min-w-0">
                  <p className="truncate font-sans font-semibold text-xs text-white">
                    {member.name}
                  </p>
                  <p className="font-sans font-semibold text-xs text-slate-400">
                    {member.characterClass}
                  </p>
                  <p className="font-sans font-semibold text-xs text-slate-400">{member.race}</p>
                </div>
              </>
            );

            // Only render an interactive control when a detail view is actually
            // reachable (needs campaignId). Otherwise render a plain row so
            // assistive tech isn't presented a focusable, do-nothing button.
            return canOpenDetail ? (
              <button
                key={member.id}
                type="button"
                onClick={() => setSelectedMemberId(member.id)}
                aria-label={`View ${member.name}`}
                className={`${cardClass} transition-colors hover:border-white/20 hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60`}
              >
                {cardBody}
              </button>
            ) : (
              <div key={member.id} className={cardClass}>
                {cardBody}
              </div>
            );
          })}
        </div>
      )}

      {campaignId && selectedMemberId ? (
        <PlayerViewModal
          isOpen={Boolean(selectedMemberId)}
          onClose={() => setSelectedMemberId(null)}
          playerId={selectedMemberId}
          campaignId={campaignId}
        />
      ) : null}
    </Widget>
  );
}
