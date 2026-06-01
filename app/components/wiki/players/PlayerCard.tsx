import type { PlayerListItem } from '~/types/player';

interface PlayerCardProps {
  player: PlayerListItem;
  onClick: () => void;
}

function getInitials(firstName: string, lastName: string): string {
  const f = firstName.charAt(0).toUpperCase();
  const l = lastName.charAt(0).toUpperCase();
  return l ? `${f}${l}` : f;
}

export function PlayerCard({ player, onClick }: PlayerCardProps) {
  const fullName = `${player.firstName} ${player.lastName}`.trim();
  const initials = getInitials(player.firstName, player.lastName);
  const isDeceased = player.status?.value === 'deceased';

  const infoSegments: string[] = [];
  if (player.race) infoSegments.push(player.race);
  if (player.characterClass) infoSegments.push(player.characterClass);

  return (
    <div
      role="button"
      tabIndex={0}
      draggable="true"
      onDragStart={(e) => {
        e.dataTransfer.setData(
          'application/x-cartyx-document',
          JSON.stringify({
            collection: 'player',
            documentId: player.id,
            title: fullName,
          })
        );
        e.dataTransfer.effectAllowed = 'copy';
        e.currentTarget.style.opacity = '0.4';
      }}
      onDragEnd={(e) => {
        e.currentTarget.style.opacity = '';
      }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`flex items-center gap-3 w-full px-4 py-3 border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors text-left cursor-grab active:cursor-grabbing${isDeceased ? ' opacity-70' : ''}`}
      style={
        isDeceased
          ? {
              borderLeftWidth: 4,
              borderLeftStyle: 'solid',
              borderLeftColor: player.color,
              backgroundColor: `${player.color}08`,
            }
          : { borderLeftWidth: 4, borderLeftStyle: 'solid', borderLeftColor: player.color }
      }
    >
      {/* Avatar */}
      <div
        className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden"
        style={player.picture ? undefined : { backgroundColor: player.color }}
      >
        {player.picture ? (
          <img src={player.picture} alt={fullName} className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm text-white font-semibold">{initials}</span>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-slate-200 truncate">{fullName}</span>
          {isDeceased && (
            <span className="ml-auto text-[10px] text-red-400 shrink-0">Deceased</span>
          )}
        </div>

        {infoSegments.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            {infoSegments.map((segment, i) => (
              <span key={segment} className="flex items-center gap-1.5">
                {i > 0 && <span className="opacity-40">&middot;</span>}
                <span>{segment}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
