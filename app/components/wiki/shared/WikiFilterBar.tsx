import { Plus, Search } from 'lucide-react';
import type { CampaignData } from '~/types/campaign';
import { TagAutocompleteInput } from '~/components/shared/TagAutocompleteInput';

interface WikiFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  sessionId?: string;
  onSessionChange?: (value: string) => void;
  visibility: 'all' | 'public' | 'private';
  onVisibilityChange: (value: 'all' | 'public' | 'private') => void;
  sessions?: CampaignData['sessions'];
  onCreateClick?: () => void;
  createButtonTestId?: string;
  campaignId: string;
  filterTags: string[];
  onFilterTagsChange: (tags: string[]) => void;
  searchPlaceholder?: string;
  showSessionFilter?: boolean;
  showVisibilityFilter?: boolean;
}

export function WikiFilterBar({
  search,
  onSearchChange,
  sessionId = '',
  onSessionChange,
  visibility = 'all',
  onVisibilityChange,
  sessions = [],
  onCreateClick,
  createButtonTestId,
  campaignId,
  filterTags,
  onFilterTagsChange,
  searchPlaceholder = 'Search...',
  showSessionFilter = true,
  showVisibilityFilter = true,
}: WikiFilterBarProps) {
  return (
    <div className="flex flex-col gap-3 p-3 border-b border-white/[0.07] bg-[#0D1117]">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-[#080A12] border border-white/[0.07] rounded px-9 py-2 font-sans font-semibold text-xs text-white outline-none focus:border-blue-500/50 transition-colors placeholder:text-slate-600"
          />
        </div>
        {onCreateClick && (
          <button
            type="button"
            onClick={onCreateClick}
            className="flex items-center justify-center h-8 w-8 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            aria-label="Create new item"
            data-testid={createButtonTestId}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      <TagAutocompleteInput
        campaignId={campaignId}
        selectedTags={filterTags}
        onTagsChange={onFilterTagsChange}
        placeholder="Filter by tags..."
      />

      {(showSessionFilter || showVisibilityFilter) && (
        <div className="flex gap-2">
          {showSessionFilter && sessions && onSessionChange && (
            <div className="flex-1">
              <label htmlFor="wiki-session-filter" className="sr-only">
                Filter by session
              </label>
              <select
                id="wiki-session-filter"
                value={sessionId ?? ''}
                onChange={(e) => onSessionChange(e.target.value)}
                className="w-full bg-[#080A12] border border-white/[0.07] rounded px-2 py-1.5 font-sans font-semibold text-[11px] text-slate-300 outline-none focus:border-blue-500/50 transition-colors"
              >
                <option value="">All Sessions</option>
                <option value="__none__">No Session</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    Session {session.number}: {session.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {showVisibilityFilter && (
            <div className={showSessionFilter && sessions && onSessionChange ? 'w-32' : 'flex-1'}>
              <label htmlFor="wiki-visibility-filter" className="sr-only">
                Filter by visibility
              </label>
              <select
                id="wiki-visibility-filter"
                value={visibility}
                onChange={(e) => onVisibilityChange(e.target.value as 'all' | 'public' | 'private')}
                className="w-full bg-[#080A12] border border-white/[0.07] rounded px-2 py-1.5 font-sans font-semibold text-[11px] text-slate-300 outline-none focus:border-blue-500/50 transition-colors"
              >
                <option value="all">All</option>
                <option value="public">Public Only</option>
                <option value="private">Private Only</option>
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
