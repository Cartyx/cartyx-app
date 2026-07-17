import { WikiFilterBar } from '~/components/wiki/shared/WikiFilterBar';
import { SPELL_SCHOOLS, formatSpellLevel, formatSchool } from '~/constants/spells';
import type { SpellSchool } from '~/types/spell';

interface SpellsFilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  onCreateClick?: () => void;
  campaignId: string;
  filterTags: string[];
  onFilterTagsChange: (tags: string[]) => void;
  level: number | undefined;
  onLevelChange: (level: number | undefined) => void;
  school: SpellSchool | undefined;
  onSchoolChange: (school: SpellSchool | undefined) => void;
}

export function SpellsFilterBar(props: SpellsFilterBarProps) {
  return (
    <div>
      <WikiFilterBar
        search={props.search}
        onSearchChange={props.onSearchChange}
        onCreateClick={props.onCreateClick}
        campaignId={props.campaignId}
        filterTags={props.filterTags}
        onFilterTagsChange={props.onFilterTagsChange}
        searchPlaceholder="Search spells..."
        showSessionFilter={false}
        showVisibilityFilter={false}
        visibility="all"
        onVisibilityChange={() => {}}
      />
      <div className="flex gap-2 px-3 pb-3 bg-[#0D1117] border-b border-white/[0.07]">
        <div className="flex-1">
          <label htmlFor="spell-level-filter" className="sr-only">
            Filter by level
          </label>
          <select
            id="spell-level-filter"
            value={props.level ?? ''}
            onChange={(e) =>
              props.onLevelChange(e.target.value === '' ? undefined : Number(e.target.value))
            }
            className="w-full bg-[#080A12] border border-white/[0.07] rounded px-2 py-1.5 font-sans font-semibold text-[11px] text-slate-300 outline-none focus:border-blue-500/50"
          >
            <option value="">All Levels</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>
                {formatSpellLevel(n)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="spell-school-filter" className="sr-only">
            Filter by school
          </label>
          <select
            id="spell-school-filter"
            value={props.school ?? ''}
            onChange={(e) =>
              props.onSchoolChange((e.target.value || undefined) as SpellSchool | undefined)
            }
            className="w-full bg-[#080A12] border border-white/[0.07] rounded px-2 py-1.5 font-sans font-semibold text-[11px] text-slate-300 outline-none focus:border-blue-500/50"
          >
            <option value="">All Schools</option>
            {SPELL_SCHOOLS.map((s) => (
              <option key={s} value={s}>
                {formatSchool(s)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
