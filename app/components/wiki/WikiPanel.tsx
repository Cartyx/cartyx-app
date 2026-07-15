import React, { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import {
  Users,
  Dna,
  ScrollText,
  UserCircle,
  MapPin,
  Map as MapIcon,
  Skull,
  BookOpen,
  CalendarDays,
  CalendarClock,
  Sparkles,
  Building2,
  Swords,
} from 'lucide-react';
import { CharactersPanel } from './characters/CharactersPanel';
import { RacesPanel } from './races/RacesPanel';
import { RulesPanel } from './rules/RulesPanel';
import { SpellsPanel } from './spells/SpellsPanel';
import { PlayersPanel } from './players/PlayersPanel';
import { LocationsPanel } from './locations/LocationsPanel';
import { MapsPanel } from './maps/MapsPanel';
import { MonstersPanel } from './monsters/MonstersPanel';
import { LorePanel } from './lore/LorePanel';
import { OrganizationsPanel } from './organizations/OrganizationsPanel';
import { QuestsPanel } from './quests/QuestsPanel';
import { CalendarPanel } from './calendar/CalendarPanel';
import { EventsPanel } from './calendar/EventsPanel';
import { useCampaign } from '~/hooks/useCampaigns';

type WikiCategoryId =
  | 'characters'
  | 'players'
  | 'races'
  | 'rules'
  | 'spells'
  | 'locations'
  | 'lore'
  | 'organizations'
  | 'quests'
  | 'maps'
  | 'monsters'
  | 'calendar'
  | 'events';

interface WikiCategory {
  id: WikiCategoryId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** When true, only renders when the viewer is a GM. */
  gmOnly?: boolean;
}

const WIKI_CATEGORIES: WikiCategory[] = [
  { id: 'characters', label: 'Characters', icon: Users },
  { id: 'players', label: 'Players', icon: UserCircle },
  { id: 'races', label: 'Races', icon: Dna },
  { id: 'rules', label: 'Rules', icon: ScrollText },
  { id: 'spells', label: 'Spells', icon: Sparkles },
  { id: 'locations', label: 'Locations', icon: MapPin },
  { id: 'lore', label: 'Lore', icon: BookOpen },
  { id: 'organizations', label: 'Organizations', icon: Building2 },
  { id: 'quests', label: 'Quests', icon: Swords },
  { id: 'maps', label: 'Maps', icon: MapIcon, gmOnly: true },
  { id: 'monsters', label: 'Monsters', icon: Skull, gmOnly: true },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'events', label: 'Events', icon: CalendarClock, gmOnly: true },
];

export function WikiPanel() {
  const [selectedCategory, setSelectedCategory] = useState<WikiCategoryId | null>(null);
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const visibleCategories = WIKI_CATEGORIES.filter((c) => !c.gmOnly || isGM);

  return (
    <div className="h-full flex flex-col bg-[#080A12] w-full">
      {selectedCategory === null ? (
        <div className="flex-1 overflow-y-auto">
          {visibleCategories.map((category, index) => {
            const Icon = category.icon;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setSelectedCategory(category.id)}
                className={[
                  'flex w-full items-center px-4 py-3 text-left transition-colors hover:bg-white/[0.05]',
                  index < visibleCategories.length - 1 ? 'border-b border-white/[0.07]' : '',
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
      ) : selectedCategory === 'spells' ? (
        <SpellsPanel onBack={() => setSelectedCategory(null)} />
      ) : selectedCategory === 'locations' ? (
        <LocationsPanel onBack={() => setSelectedCategory(null)} />
      ) : selectedCategory === 'lore' ? (
        <LorePanel onBack={() => setSelectedCategory(null)} />
      ) : selectedCategory === 'organizations' ? (
        <OrganizationsPanel onBack={() => setSelectedCategory(null)} />
      ) : selectedCategory === 'quests' ? (
        <QuestsPanel onBack={() => setSelectedCategory(null)} />
      ) : selectedCategory === 'maps' && isGM ? (
        <MapsPanel onBack={() => setSelectedCategory(null)} />
      ) : selectedCategory === 'monsters' && isGM ? (
        <MonstersPanel onBack={() => setSelectedCategory(null)} />
      ) : selectedCategory === 'calendar' ? (
        <CalendarPanel onBack={() => setSelectedCategory(null)} />
      ) : selectedCategory === 'events' && isGM ? (
        <EventsPanel onBack={() => setSelectedCategory(null)} />
      ) : null}
    </div>
  );
}
