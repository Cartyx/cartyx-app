import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { ScrollText } from 'lucide-react';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { WikiFilterBar } from '~/components/wiki/shared/WikiFilterBar';
import { RuleCard } from './RuleCard';
import { RuleModal } from './RuleModal';
import { RuleViewModal } from './RuleViewModal';
import { useRules } from '~/hooks/useRules';
import { useCampaign } from '~/hooks/useCampaigns';
import type { RuleListItem } from '~/types/rule';

interface RulesPanelProps {
  onBack: () => void;
}

export function RulesPanel({ onBack }: RulesPanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState<string | undefined>();
  const [viewRuleId, setViewRuleId] = useState<string | undefined>();

  const { rules, isLoading, error } = useRules(campaignId, {
    search: search || undefined,
    visibility,
    tags: filterTags.length > 0 ? filterTags : undefined,
  });

  const handleCreateClick = () => {
    setSelectedRuleId(undefined);
    setIsModalOpen(true);
  };

  const handleRuleClick = (rule: RuleListItem) => {
    if (isGM) {
      setSelectedRuleId(rule.id);
      setIsModalOpen(true);
    } else {
      setViewRuleId(rule.id);
    }
  };

  // The menu's Edit only renders when canEdit (isGM), so this reaches the editor.
  const handleRuleEdit = (rule: RuleListItem) => {
    setSelectedRuleId(rule.id);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedRuleId(undefined);
  };

  const handleViewModalClose = () => {
    setViewRuleId(undefined);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#080A12]">
      <WikiCategoryHeader title="Rules" onBack={onBack} />
      <WikiFilterBar
        search={search}
        onSearchChange={setSearch}
        visibility={visibility}
        onVisibilityChange={setVisibility}
        onCreateClick={isGM ? handleCreateClick : undefined}
        campaignId={campaignId}
        filterTags={filterTags}
        onFilterTagsChange={setFilterTags}
        searchPlaceholder="Search rules..."
        showSessionFilter={false}
        showVisibilityFilter={isGM}
      />

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
            Loading rules...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
        </div>
      ) : rules.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
            <ScrollText className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans font-semibold text-xs text-slate-500">
            No rules found matching your filters.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col">
            {rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                canEdit={isGM}
                onClick={handleRuleClick}
                onEdit={handleRuleEdit}
              />
            ))}
          </div>
        </div>
      )}

      {isGM && (
        <RuleModal
          isOpen={isModalOpen}
          onClose={handleModalClose}
          campaignId={campaignId}
          ruleId={selectedRuleId}
        />
      )}
      {viewRuleId && (
        <RuleViewModal
          isOpen={!!viewRuleId}
          onClose={handleViewModalClose}
          ruleId={viewRuleId}
          campaignId={campaignId}
        />
      )}
    </div>
  );
}
