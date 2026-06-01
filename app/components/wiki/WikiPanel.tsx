import React, { useState } from 'react';
import { Users, Dna, ScrollText, UserCircle, MapPin } from 'lucide-react';
import { CharactersPanel } from './characters/CharactersPanel';
import { RacesPanel } from './races/RacesPanel';
import { RulesPanel } from './rules/RulesPanel';
import { PlayersPanel } from './players/PlayersPanel';
import { LocationsPanel } from './locations/LocationsPanel';

type WikiCategoryId = 'characters' | 'players' | 'races' | 'rules' | 'locations';

interface WikiCategory {
  id: WikiCategoryId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const WIKI_CATEGORIES: WikiCategory[] = [
  { id: 'characters', label: 'Characters', icon: Users },
  { id: 'players', label: 'Players', icon: UserCircle },
  { id: 'races', label: 'Races', icon: Dna },
  { id: 'rules', label: 'Rules', icon: ScrollText },
  { id: 'locations', label: 'Locations', icon: MapPin },
];

export function WikiPanel() {
  const [selectedCategory, setSelectedCategory] = useState<WikiCategoryId | null>(null);

  return (
    <div className="h-full flex flex-col bg-[#080A12] w-full">
      {selectedCategory === null ? (
        <div className="flex-1 overflow-y-auto">
          {WIKI_CATEGORIES.map((category, index) => {
            const Icon = category.icon;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setSelectedCategory(category.id)}
                className={[
                  'flex w-full items-center px-4 py-3 text-left transition-colors hover:bg-white/[0.05]',
                  index < WIKI_CATEGORIES.length - 1 ? 'border-b border-white/[0.07]' : '',
                ].join(' ')}
              >
                <Icon className="mr-3 h-4 w-4 shrink-0 text-slate-400" />
                <span className="font-sans font-semibold text-xs text-slate-300">
                  {category.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : selectedCategory === 'characters' ? (
        <CharactersPanel onBack={() => setSelectedCategory(null)} />
      ) : selectedCategory === 'players' ? (
        <PlayersPanel onBack={() => setSelectedCategory(null)} />
      ) : selectedCategory === 'races' ? (
        <RacesPanel onBack={() => setSelectedCategory(null)} />
      ) : selectedCategory === 'rules' ? (
        <RulesPanel onBack={() => setSelectedCategory(null)} />
      ) : selectedCategory === 'locations' ? (
        <LocationsPanel onBack={() => setSelectedCategory(null)} />
      ) : null}
    </div>
  );
}
