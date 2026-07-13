import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PlayerData } from '~/types/player';
import type { PictureCrop } from '~/types/character';
import { MARKDOWN_PROSE_CLASSES } from '~/utils/markdownProseClasses';
import { TabBar } from '~/components/shared/TabBar';
import { RelationshipList } from '~/components/shared/RelationshipList';
import { RelationshipModal } from '~/components/shared/RelationshipModal';
import {
  useAddPlayerRelationship,
  useUpdatePlayerRelationship,
  useRemovePlayerRelationship,
} from '~/hooks/usePlayers';
import { PlayerLoreTab } from '~/components/wiki/players/PlayerLoreTab';
import { MemberOrganizationsTab } from '~/components/shared/MemberOrganizationsTab';
import { useCampaign } from '~/hooks/useCampaigns';

function getCropStyle(crop: PictureCrop): React.CSSProperties {
  const centerX = (crop.x + crop.width / 2) * 100;
  const centerY = (crop.y + crop.height / 2) * 100;
  const scale = 1 / crop.width;
  return {
    objectPosition: `${centerX}% ${centerY}%`,
    transform: `scale(${scale})`,
  };
}

interface PlayerWindowProps {
  player: PlayerData;
  onEdit?: () => void;
}

const GRADIENT_PAIRS = [
  ['#3b82f6', '#8b5cf6'],
  ['#f59e0b', '#ef4444'],
  ['#10b981', '#06b6d4'],
  ['#ec4899', '#8b5cf6'],
  ['#f97316', '#eab308'],
  ['#14b8a6', '#3b82f6'],
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInitials(firstName: string, lastName: string): string {
  const f = firstName.charAt(0).toUpperCase();
  const l = lastName.charAt(0).toUpperCase();
  return l ? `${f}${l}` : f;
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/[0.04] border border-white/[0.06] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</p>
      <p className="text-xs text-slate-300 font-medium truncate">{value}</p>
    </div>
  );
}

function FieldCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</p>
      <p className="text-xs text-slate-300">{value}</p>
    </div>
  );
}

export function PlayerWindow({ player, onEdit }: PlayerWindowProps) {
  const [activeTab, setActiveTab] = useState('general');
  const [relationshipModal, setRelationshipModal] = useState<{
    open: boolean;
    mode: 'add' | 'edit';
    editCharacterId?: string;
  }>({ open: false, mode: 'add' });

  const { addRelationship } = useAddPlayerRelationship();
  const { updateRelationship } = useUpdatePlayerRelationship();
  const { removeRelationship } = useRemovePlayerRelationship();
  const { campaign } = useCampaign(player.campaignId);
  const isGM = campaign?.isGM ?? false;

  const fullName = `${player.firstName} ${player.lastName}`.trim();
  const initials = getInitials(player.firstName, player.lastName);
  const gradientIndex = hashName(fullName) % GRADIENT_PAIRS.length;
  const [gradFrom, gradTo] = GRADIENT_PAIRS[gradientIndex]!;

  const isDeceased = player.status?.value === 'deceased';

  const headerStats: { label: string; value: string }[] = [];
  if (player.race) headerStats.push({ label: 'Race', value: player.race });
  if (player.characterClass) headerStats.push({ label: 'Class', value: player.characterClass });

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'backstory', label: 'Backstory', hidden: player.backstory === '' },
    { id: 'gmnotes', label: 'GM Notes', hidden: player.gmNotes === '' },
    { id: 'relationships', label: 'Relationships' },
    { id: 'lore', label: 'Lore' },
    { id: 'organizations', label: 'Organizations' },
  ];

  return (
    <div className="flex flex-col">
      {/* Header area */}
      <div className="flex flex-col gap-3 p-4">
        {/* Portrait */}
        <div className="flex justify-center">
          <div
            className="w-24 h-24 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden"
            style={
              player.picture
                ? undefined
                : { background: `linear-gradient(135deg, ${gradFrom}, ${gradTo})` }
            }
          >
            {player.picture ? (
              <img
                src={player.picture}
                alt={fullName}
                className="w-full h-full object-cover"
                style={player.pictureCrop ? getCropStyle(player.pictureCrop) : undefined}
              />
            ) : (
              <span className="text-2xl text-white font-semibold">{initials}</span>
            )}
          </div>
        </div>

        {/* Edit button */}
        {onEdit && (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={onEdit}
              className="shrink-0 p-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white transition-colors"
              aria-label="Edit player"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Stats grid + deceased indicator */}
        {(headerStats.length > 0 || isDeceased) && (
          <div className="flex flex-col gap-2">
            {isDeceased && (
              <div className="flex justify-center">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20">
                  Deceased
                </span>
              </div>
            )}
            {headerStats.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {headerStats.map((s) => (
                  <StatBlock key={s.label} label={s.label} value={s.value} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <TabBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        accentColor={player.color || '#3498db'}
      />

      {/* Tab content */}
      <div className="p-4">
        {activeTab === 'general' && (
          <div className="flex flex-col gap-4">
            {/* Fields grid */}
            <div className="grid grid-cols-2 gap-3">
              {player.characterClass && <FieldCell label="Class" value={player.characterClass} />}
              {player.age != null && <FieldCell label="Age" value={String(player.age)} />}
              {player.gender && <FieldCell label="Gender" value={player.gender} />}
              {player.location && <FieldCell label="Location" value={player.location} />}
              {player.eyeColor && <FieldCell label="Eye Color" value={player.eyeColor} />}
              {player.hairColor && <FieldCell label="Hair Color" value={player.hairColor} />}
              {player.height && <FieldCell label="Height" value={player.height} />}
              {player.weight != null && <FieldCell label="Weight" value={String(player.weight)} />}
              {player.size && <FieldCell label="Size" value={player.size} />}
            </div>

            {/* Description */}
            {player.description ? (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  Description
                </p>
                <div className={MARKDOWN_PROSE_CLASSES}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{player.description}</ReactMarkdown>
                </div>
              </div>
            ) : null}

            {/* Appearance */}
            {player.appearance ? (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  Appearance
                </p>
                <div className={MARKDOWN_PROSE_CLASSES}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{player.appearance}</ReactMarkdown>
                </div>
              </div>
            ) : null}

            {!player.description && !player.appearance && (
              <p className="text-xs text-slate-500">No details yet.</p>
            )}
          </div>
        )}

        {activeTab === 'backstory' && (
          <div>
            <div className="mb-3 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2">
              <p className="text-[10px] text-amber-400">
                Backstory is only visible to you and the GM.
              </p>
            </div>
            <div className={MARKDOWN_PROSE_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{player.backstory}</ReactMarkdown>
            </div>
          </div>
        )}

        {activeTab === 'gmnotes' && (
          <div>
            <div className="mb-3 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2">
              <p className="text-[10px] text-amber-400">GM Notes are only visible to the GM.</p>
            </div>
            <div className={MARKDOWN_PROSE_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{player.gmNotes}</ReactMarkdown>
            </div>
          </div>
        )}

        {activeTab === 'relationships' && (
          <>
            <RelationshipList
              relationships={player.relationships}
              campaignId={player.campaignId}
              canManage={player.canEdit}
              onAdd={() => setRelationshipModal({ open: true, mode: 'add' })}
              onEdit={(charId) =>
                setRelationshipModal({ open: true, mode: 'edit', editCharacterId: charId })
              }
              onRemove={(charId) => {
                removeRelationship({
                  playerId: player.id,
                  campaignId: player.campaignId,
                  characterId: charId,
                });
              }}
            />
            {relationshipModal.open && (
              <RelationshipModal
                campaignId={player.campaignId}
                mode={relationshipModal.mode}
                showReciprocal={false}
                existingRelationship={
                  relationshipModal.mode === 'edit' && relationshipModal.editCharacterId
                    ? player.relationships.find(
                        (r) => r.characterId === relationshipModal.editCharacterId
                      )
                    : undefined
                }
                excludeCharacterIds={player.relationships.map((r) => r.characterId)}
                onSave={(data) => {
                  if (relationshipModal.mode === 'add') {
                    addRelationship({
                      playerId: player.id,
                      campaignId: player.campaignId,
                      characterId: data.characterId,
                      descriptor: data.descriptor,
                      isPublic: data.isPublic,
                    });
                  } else {
                    updateRelationship({
                      playerId: player.id,
                      campaignId: player.campaignId,
                      characterId: data.characterId,
                      descriptor: data.descriptor,
                      isPublic: data.isPublic,
                    });
                  }
                  setRelationshipModal({ open: false, mode: 'add' });
                }}
                onClose={() => setRelationshipModal({ open: false, mode: 'add' })}
              />
            )}
          </>
        )}

        {activeTab === 'lore' && (
          <PlayerLoreTab
            campaignId={player.campaignId}
            playerId={player.id}
            canManage={player.canEdit}
          />
        )}

        {activeTab === 'organizations' && (
          <MemberOrganizationsTab
            campaignId={player.campaignId}
            memberKind="player"
            memberId={player.id}
            isGM={isGM}
            canManage={player.canEdit}
          />
        )}
      </div>
    </div>
  );
}
