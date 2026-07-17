import { useState, type ComponentType } from 'react';
import { useParams } from '@tanstack/react-router';
import { Cog, ScrollText } from 'lucide-react';
import { GameSettingsModal } from './settings/GameSettingsModal';
import { SrdLicensingModal } from './settings/SrdLicensingModal';
import { useCampaign } from '~/hooks/useCampaigns';

type SettingsCategoryId = 'game-settings' | 'srd-licensing';

interface SettingsCategory {
  id: SettingsCategoryId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  gmOnly: boolean;
}

const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: 'game-settings', label: 'Game Settings', icon: Cog, gmOnly: true },
  { id: 'srd-licensing', label: 'SRD Licensing', icon: ScrollText, gmOnly: false },
];

export function SettingsPanel() {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const [openCategory, setOpenCategory] = useState<SettingsCategoryId | null>(null);

  const visibleCategories = SETTINGS_CATEGORIES.filter((c) => !c.gmOnly || isGM);

  return (
    <div className="h-full flex flex-col bg-[#080A12] w-full" data-testid="settings-panel">
      <div className="flex-1 overflow-y-auto">
        {visibleCategories.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="font-sans font-semibold text-xs text-slate-500">No settings available.</p>
          </div>
        ) : (
          visibleCategories.map((category, index) => {
            const Icon = category.icon;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setOpenCategory(category.id)}
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
          })
        )}
      </div>

      {isGM && (
        <GameSettingsModal
          isOpen={openCategory === 'game-settings'}
          onClose={() => setOpenCategory(null)}
          campaignId={campaignId}
        />
      )}

      <SrdLicensingModal
        isOpen={openCategory === 'srd-licensing'}
        onClose={() => setOpenCategory(null)}
      />
    </div>
  );
}
