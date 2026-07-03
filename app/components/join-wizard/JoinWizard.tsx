import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '~/routes/campaign/join';
import { Topbar } from '~/components/Topbar';
import { StepWizard } from '~/components/StepWizard';
import { StepInviteCode } from './StepInviteCode';
import { StepPlayerInfo } from './StepPlayerInfo';
import { StepBackstory } from './StepBackstory';
import { StepRelatedCharacters } from './StepRelatedCharacters';
import { StepLore } from './StepLore';
import { StepReview } from './StepReview';
import type { PictureCrop } from '~/types/character';

// ---------------------------------------------------------------------------
// Wizard state shape
// ---------------------------------------------------------------------------

export interface WizardPlayerState {
  firstName: string;
  lastName: string;
  race: string;
  characterClass: string;
  age: number | null;
  gender: string;
  location: string;
  link: string;
  picture: string;
  pictureCrop: PictureCrop | null;
  description: string;
  backstory: string;
  color: string;
  eyeColor: string;
  hairColor: string;
  weight: number | null;
  height: string;
  size: string;
  appearance: string;
}

export interface WizardLore {
  title: string;
  content: string;
  isPublic: boolean;
}

export interface WizardCharacter {
  firstName: string;
  lastName: string;
  race: string;
  characterClass: string;
  age: number | null;
  location: string;
  link: string;
  picture: string;
  pictureCrop: PictureCrop | null;
  notes: string;
  isPublic: boolean;
  relationship: { descriptor: string; isPublic: boolean };
}

export interface WizardState {
  campaignId: string;
  campaignName: string;
  player: WizardPlayerState;
  characters: WizardCharacter[];
  lore: WizardLore[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultPlayer(): WizardPlayerState {
  return {
    firstName: '',
    lastName: '',
    race: '',
    characterClass: '',
    age: null,
    gender: '',
    location: '',
    link: '',
    picture: '',
    pictureCrop: null,
    description: '',
    backstory: '',
    color: '#3498db',
    eyeColor: '',
    hairColor: '',
    weight: null,
    height: '',
    size: '',
    appearance: '',
  };
}

function defaultState(): WizardState {
  return {
    campaignId: '',
    campaignName: '',
    player: defaultPlayer(),
    characters: [],
    lore: [],
  };
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function storageKey(campaignId: string) {
  return `join-wizard-${campaignId}`;
}

function loadFromStorage(campaignId: string): WizardState | null {
  try {
    const raw = localStorage.getItem(storageKey(campaignId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WizardState;
    if (parsed.campaignId === campaignId) return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveToStorage(state: WizardState) {
  if (!state.campaignId) return;
  try {
    localStorage.setItem(storageKey(state.campaignId), JSON.stringify(state));
  } catch {
    // storage full or unavailable — ignore
  }
}

export function clearStorage(campaignId: string) {
  try {
    localStorage.removeItem(storageKey(campaignId));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Step labels
// ---------------------------------------------------------------------------

const STEPS = ['INVITE', 'PLAYER', 'BACKSTORY', 'CHARACTERS', 'LORE', 'REVIEW'];

// ---------------------------------------------------------------------------
// JoinWizard component
// ---------------------------------------------------------------------------

export function JoinWizard() {
  const { step, code, campaignId: searchCampaignId } = Route.useSearch();
  const navigate = useNavigate();

  const [wizardState, setWizardState] = useState<WizardState>(defaultState);
  const initialized = useRef(false);

  // On mount, restore state from localStorage if we have a campaignId already saved
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Try to recover from localStorage using any previously-stored campaignId
    // We iterate localStorage keys that start with "join-wizard-" to find the right one
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('join-wizard-')) {
        const cId = key.replace('join-wizard-', '');
        const saved = loadFromStorage(cId);
        if (saved) {
          setWizardState(saved);
          break;
        }
      }
    }

    // If campaignId is provided in search params (re-entry flow), use it
    if (searchCampaignId) {
      setWizardState((prev) => {
        if (!prev.campaignId) {
          return { ...prev, campaignId: searchCampaignId };
        }
        return prev;
      });
    }
  }, [searchCampaignId]);

  // Persist to localStorage whenever state changes
  useEffect(() => {
    if (wizardState.campaignId) {
      saveToStorage(wizardState);
    }
  }, [wizardState]);

  const goToStep = useCallback(
    (s: number) => {
      navigate({
        to: '/campaign/join',
        search: (prev: Record<string, unknown>) => ({ ...prev, step: s }),
        replace: true,
      });
    },
    [navigate]
  );

  const updateState = useCallback((partial: Partial<WizardState>) => {
    setWizardState((prev) => ({ ...prev, ...partial }));
  }, []);

  const updatePlayer = useCallback((partial: Partial<WizardPlayerState>) => {
    setWizardState((prev) => ({
      ...prev,
      player: { ...prev.player, ...partial },
    }));
  }, []);

  const setCharacters = useCallback((characters: WizardCharacter[]) => {
    setWizardState((prev) => ({ ...prev, characters }));
  }, []);

  const setLore = useCallback((lore: WizardLore[]) => {
    setWizardState((prev) => ({ ...prev, lore }));
  }, []);

  // Only allow step navigation to already-visited steps
  const handleStepClick = useCallback(
    (s: number) => {
      // Allow going back, but not forward past current
      if (s <= step) goToStep(s);
    },
    [step, goToStep]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#080A12]">
      <Topbar />
      <main className="flex-1 w-full max-w-[680px] mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-sans font-semibold text-[13px] text-white tracking-widest">
            JOIN CAMPAIGN
          </h1>
          <a
            href="/campaigns"
            className="text-xs text-slate-500 hover:text-slate-400 transition-colors font-medium"
          >
            &larr; Back
          </a>
        </div>

        <StepWizard steps={STEPS} currentStep={step} onStepClick={handleStepClick} />

        {step === 1 && (
          <StepInviteCode
            initialCode={code}
            wizardState={wizardState}
            onValidated={(campaignId, campaignName) => {
              updateState({ campaignId, campaignName });
              goToStep(2);
            }}
          />
        )}

        {step === 2 && (
          <StepPlayerInfo
            player={wizardState.player}
            campaignId={wizardState.campaignId}
            onUpdate={updatePlayer}
            onNext={() => goToStep(3)}
            onBack={() => goToStep(1)}
          />
        )}

        {step === 3 && (
          <StepBackstory
            backstory={wizardState.player.backstory}
            onUpdate={(backstory) => updatePlayer({ backstory })}
            onNext={() => goToStep(4)}
            onSkip={() => {
              updatePlayer({ backstory: '' });
              goToStep(4);
            }}
            onBack={() => goToStep(2)}
          />
        )}

        {step === 4 && (
          <StepRelatedCharacters
            characters={wizardState.characters}
            onUpdate={setCharacters}
            onNext={() => goToStep(5)}
            onBack={() => goToStep(3)}
          />
        )}

        {step === 5 && (
          <StepLore
            lore={wizardState.lore}
            onUpdate={setLore}
            onNext={() => goToStep(6)}
            onBack={() => goToStep(4)}
          />
        )}

        {step === 6 && <StepReview wizardState={wizardState} onBack={() => goToStep(5)} />}
      </main>
    </div>
  );
}
