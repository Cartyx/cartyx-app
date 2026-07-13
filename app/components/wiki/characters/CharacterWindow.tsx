import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CharacterData, PictureCrop } from '~/types/character';
import { MARKDOWN_PROSE_CLASSES } from '~/utils/markdownProseClasses';
import { TabBar } from '~/components/shared/TabBar';
import { RelationshipList } from '~/components/shared/RelationshipList';
import { RelationshipModal } from '~/components/shared/RelationshipModal';
import {
  useAddCharacterRelationship,
  useUpdateCharacterRelationship,
  useRemoveCharacterRelationship,
} from '~/hooks/useCharacters';
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

interface CharacterWindowProps {
  character: CharacterData;
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

export function CharacterWindow({ character, onEdit }: CharacterWindowProps) {
  const [activeTab, setActiveTab] = useState('general');
  const [relationshipModal, setRelationshipModal] = useState<{
    open: boolean;
    mode: 'add' | 'edit';
    editCharacterId?: string;
  }>({ open: false, mode: 'add' });

  const { addRelationship } = useAddCharacterRelationship();
  const { updateRelationship } = useUpdateCharacterRelationship();
  const { removeRelationship } = useRemoveCharacterRelationship();
  const { campaign } = useCampaign(character.campaignId);
  const isGM = campaign?.isGM ?? false;

  const fullName = `${character.firstName} ${character.lastName}`.trim();
  const initials = getInitials(character.firstName, character.lastName);
  const gradientIndex = hashName(fullName) % GRADIENT_PAIRS.length;
  const [gradFrom, gradTo] = GRADIENT_PAIRS[gradientIndex]!;

  const stats: { label: string; value: string }[] = [];
  if (character.race) stats.push({ label: 'Race', value: character.race });
  if (character.characterClass) stats.push({ label: 'Class', value: character.characterClass });
  if (character.age != null) stats.push({ label: 'Age', value: String(character.age) });
  if (character.location) stats.push({ label: 'Location', value: character.location });

  const showMeta = character.tags.length > 0 || (character.canEdit && !!onEdit);
  const isDeceased = character.status?.value === 'deceased';

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'gmnotes', label: 'GM Notes', hidden: !character.canEdit },
    { id: 'relationships', label: 'Relationships' },
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
              character.picture
                ? undefined
                : { background: `linear-gradient(135deg, ${gradFrom}, ${gradTo})` }
            }
          >
            {character.picture ? (
              <img
                src={character.picture}
                alt={fullName}
                className="w-full h-full object-cover"
                style={character.pictureCrop ? getCropStyle(character.pictureCrop) : undefined}
              />
            ) : (
              <span className="text-2xl text-white font-semibold">{initials}</span>
            )}
          </div>
        </div>

        {/* Tags + edit button below portrait */}
        {showMeta && (
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            {character.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-sans font-bold text-[9px] tracking-tight"
              >
                #{tag}
              </span>
            ))}
            {character.canEdit && onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="shrink-0 p-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white transition-colors"
                aria-label="Edit character"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Stats grid + deceased indicator */}
        {(stats.length > 0 || isDeceased) && (
          <div className="flex flex-col gap-2">
            {isDeceased && (
              <div className="flex justify-center">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20">
                  Deceased
                </span>
              </div>
            )}
            {stats.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {stats.map((s) => (
                  <StatBlock key={s.label} label={s.label} value={s.value} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab content */}
      <div className="p-4">
        {activeTab === 'general' && (
          <div>
            {character.notes ? (
              <div className={MARKDOWN_PROSE_CLASSES}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{character.notes}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-xs text-slate-500">No details yet.</p>
            )}
            {character.sessions && character.sessions.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Sessions</p>
                <p className="text-xs text-slate-400">
                  Appeared in {character.sessions.length} session
                  {character.sessions.length !== 1 ? 's' : ''}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'gmnotes' && (
          <div>
            {character.gmNotes ? (
              <div className={MARKDOWN_PROSE_CLASSES}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{character.gmNotes}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-xs text-slate-500">No GM notes yet.</p>
            )}
          </div>
        )}

        {activeTab === 'relationships' && (
          <>
            <RelationshipList
              relationships={character.relationships}
              campaignId={character.campaignId}
              canManage={character.canEdit}
              onAdd={() => setRelationshipModal({ open: true, mode: 'add' })}
              onEdit={(charId) =>
                setRelationshipModal({ open: true, mode: 'edit', editCharacterId: charId })
              }
              onRemove={(charId) => {
                removeRelationship({
                  characterId: character.id,
                  campaignId: character.campaignId,
                  targetCharacterId: charId,
                });
              }}
            />
            {relationshipModal.open && (
              <RelationshipModal
                campaignId={character.campaignId}
                mode={relationshipModal.mode}
                showReciprocal
                existingRelationship={
                  relationshipModal.mode === 'edit' && relationshipModal.editCharacterId
                    ? character.relationships.find(
                        (r) => r.characterId === relationshipModal.editCharacterId
                      )
                    : undefined
                }
                excludeCharacterIds={[
                  character.id,
                  ...character.relationships.map((r) => r.characterId),
                ]}
                onSave={(data) => {
                  if (relationshipModal.mode === 'add') {
                    addRelationship({
                      characterId: character.id,
                      campaignId: character.campaignId,
                      targetCharacterId: data.characterId,
                      descriptor: data.descriptor,
                      reciprocalDescriptor: data.reciprocalDescriptor!,
                      isPublic: data.isPublic,
                    });
                  } else {
                    updateRelationship({
                      characterId: character.id,
                      campaignId: character.campaignId,
                      targetCharacterId: data.characterId,
                      descriptor: data.descriptor,
                      reciprocalDescriptor: data.reciprocalDescriptor,
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

        {activeTab === 'organizations' && (
          <MemberOrganizationsTab
            campaignId={character.campaignId}
            memberKind="character"
            memberId={character.id}
            isGM={isGM}
            canManage={character.canEdit}
          />
        )}
      </div>
    </div>
  );
}
