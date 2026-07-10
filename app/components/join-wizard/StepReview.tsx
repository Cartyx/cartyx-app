import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { PixelButton } from '~/components/PixelButton';
import { SectionHeader } from '~/components/SectionHeader';
import { StatusBanner } from '~/components/StatusBanner';
import { useCompleteJoinWizard } from '~/hooks/usePlayers';
import { clearStorage } from './JoinWizard';
import type { WizardState } from './JoinWizard';
import { Swords, CheckCircle2, BookOpen } from 'lucide-react';

interface StepReviewProps {
  wizardState: WizardState;
  onBack: () => void;
}

export function StepReview({ wizardState, onBack }: StepReviewProps) {
  const navigate = useNavigate();
  const { complete, isLoading, error } = useCompleteJoinWizard();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { player, characters, lore, campaignId, campaignName } = wizardState;

  async function handleJoin() {
    setSubmitError(null);

    const result = await complete({
      campaignId,
      player: {
        firstName: player.firstName.trim(),
        lastName: player.lastName.trim(),
        race: player.race.trim(),
        characterClass: player.characterClass.trim(),
        age: player.age ?? 1,
        gender: player.gender.trim(),
        location: player.location.trim(),
        link: player.link.trim(),
        picture: player.picture,
        pictureCrop: player.pictureCrop
          ? {
              x: player.pictureCrop.x,
              y: player.pictureCrop.y,
              width: player.pictureCrop.width,
              height: player.pictureCrop.height,
            }
          : null,
        description: player.description,
        backstory: player.backstory,
        color: player.color,
        eyeColor: player.eyeColor.trim(),
        hairColor: player.hairColor.trim(),
        weight: player.weight,
        height: player.height.trim(),
        size: player.size.trim(),
        appearance: player.appearance,
      },
      characters: characters.map((c) => ({
        firstName: c.firstName.trim(),
        lastName: c.lastName.trim(),
        race: c.race.trim(),
        characterClass: c.characterClass.trim(),
        age: c.age,
        location: c.location.trim(),
        link: c.link.trim(),
        picture: c.picture,
        pictureCrop: c.pictureCrop
          ? {
              x: c.pictureCrop.x,
              y: c.pictureCrop.y,
              width: c.pictureCrop.width,
              height: c.pictureCrop.height,
            }
          : null,
        notes: c.notes,
        isPublic: c.isPublic,
        relationship: {
          descriptor: c.relationship.descriptor.trim(),
          isPublic: c.relationship.isPublic,
        },
      })),
      lore: (wizardState.lore ?? []).map((l) => ({
        title: l.title.trim(),
        content: l.content,
        isPublic: l.isPublic,
      })),
    });

    if (result) {
      clearStorage(campaignId);
      navigate({
        to: '/campaigns/$campaignId/play',
        params: { campaignId },
        search: { tab: 'dashboard' },
      });
    } else {
      setSubmitError('Failed to join campaign. Please try again.');
    }
  }

  const displayError = error || submitError;

  return (
    <div className="bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden">
      <div className="p-8 pb-6 space-y-5">
        <SectionHeader size="xs" tracking="tracking-[3px]" className="mb-7">
          REVIEW
        </SectionHeader>

        {displayError && <StatusBanner variant="error" message={displayError} />}

        {/* Campaign */}
        <div>
          <SectionHeader color="muted" tracking="tracking-widest" className="mb-2">
            CAMPAIGN
          </SectionHeader>
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3">
            <p className="text-sm text-white font-medium">{campaignName}</p>
          </div>
        </div>

        {/* Player character card */}
        <div>
          <SectionHeader color="muted" tracking="tracking-widest" className="mb-2">
            YOUR CHARACTER
          </SectionHeader>
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3">
            <div className="flex items-center gap-4">
              {player.picture ? (
                <img
                  src={player.picture}
                  alt={player.firstName}
                  className="w-12 h-12 rounded-full object-cover border border-white/10"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-sm text-slate-500 font-bold">
                  {player.firstName.charAt(0).toUpperCase() || '?'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">
                  {player.firstName} {player.lastName}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {[player.race, player.characterClass].filter(Boolean).join(' / ') ||
                    'No race or class set'}
                </p>
              </div>
              {player.color && (
                <div
                  className="w-5 h-5 rounded-full border border-white/10 shrink-0"
                  style={{ backgroundColor: player.color }}
                  title="Player color"
                />
              )}
            </div>
          </div>
        </div>

        {/* Backstory status */}
        <div>
          <SectionHeader color="muted" tracking="tracking-widest" className="mb-2">
            BACKSTORY
          </SectionHeader>
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3 flex items-center gap-2">
            {player.backstory ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <span className="text-xs text-slate-400">
                  Written ({player.backstory.length} characters)
                </span>
              </>
            ) : (
              <span className="text-xs text-slate-600 italic">Skipped — can be added later</span>
            )}
          </div>
        </div>

        {/* Characters */}
        <div>
          <SectionHeader color="muted" tracking="tracking-widest" className="mb-2">
            RELATED CHARACTERS ({characters.length})
          </SectionHeader>
          {characters.length > 0 ? (
            <div className="space-y-2">
              {characters.map((char, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3"
                >
                  {char.picture ? (
                    <img
                      src={char.picture}
                      alt={char.firstName}
                      className="w-8 h-8 rounded-full object-cover border border-white/10"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-xs text-slate-500 font-bold">
                      {char.firstName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white font-medium truncate">
                      {char.firstName} {char.lastName}
                    </p>
                    {char.relationship.descriptor && (
                      <p className="text-[10px] text-slate-500 truncate">
                        {char.relationship.descriptor}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3">
              <span className="text-xs text-slate-600 italic">
                No related characters — can be added later
              </span>
            </div>
          )}
        </div>

        {/* Lore entries */}
        <div>
          <SectionHeader color="muted" tracking="tracking-widest" className="mb-2">
            LORE ENTRIES ({(lore ?? []).length})
          </SectionHeader>
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3 flex items-center gap-2">
            {(lore ?? []).length > 0 ? (
              <>
                <BookOpen className="h-4 w-4 text-indigo-400 shrink-0" />
                <span className="text-xs text-slate-400">
                  {(lore ?? []).length} {(lore ?? []).length === 1 ? 'entry' : 'entries'} —{' '}
                  {(lore ?? []).filter((l) => l.isPublic).length} public,{' '}
                  {(lore ?? []).filter((l) => !l.isPublic).length} private
                </span>
              </>
            ) : (
              <span className="text-xs text-slate-600 italic">
                No lore entries — can be added later
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between px-8 py-5 border-t border-white/[0.06]">
        <PixelButton
          variant="secondary"
          size="sm"
          onClick={onBack}
          disabled={isLoading}
          type="button"
        >
          &larr; Back
        </PixelButton>
        <PixelButton
          variant="primary"
          size="sm"
          icon={<Swords className="h-3.5 w-3.5" />}
          onClick={handleJoin}
          disabled={isLoading}
          type="button"
        >
          {isLoading ? 'Joining...' : 'Join Campaign'}
        </PixelButton>
      </div>
    </div>
  );
}
