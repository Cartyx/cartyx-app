import type { MoodData } from '~/types/soundboard';

export interface MoodBarProps {
  /** The package's moods. Empty renders a short explanatory placeholder rather than nothing, so a GM who loaded a package with no moods yet knows why the bar is blank. */
  moods: MoodData[];
  /** The currently active mood, or `null` before the GM has picked one (matches `BoardState.moodId` — `initialBoardState` deliberately does not auto-select, see `~/lib/soundboard/reducer`). */
  activeMoodId: string | null;
  /** Called with a mood's id when its button is clicked. The caller dispatches `{ type: 'setMood', moodId }` (Task 9) — this component knows nothing about commands. */
  onSelectMood: (moodId: string) => void;
}

/**
 * The mood bar: one button per mood, one click swaps the whole scene. "The
 * headline interaction" per the design doc — every mood is always visible
 * and reachable in a single click, never behind a dropdown, because a GM
 * mid-combat does not have time to hunt for the right preset.
 *
 * Purely presentational and controlled, like every other soundboard editor
 * component in this phase: no fetching, no local mood data, no knowledge of
 * `SoundboardCommand` or `useSoundboard`. The active mood is highlighted via
 * `aria-pressed`, matching `MoodEditor`'s own mood-selector convention.
 */
export function MoodBar({ moods, activeMoodId, onSelectMood }: MoodBarProps) {
  if (moods.length === 0) {
    return (
      <div
        data-testid="mood-bar"
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-500"
      >
        This package has no moods yet.
      </div>
    );
  }

  return (
    <div
      data-testid="mood-bar"
      role="group"
      aria-label="Moods"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
    >
      {moods.map((mood) => {
        const active = mood.id === activeMoodId;
        return (
          <button
            key={mood.id}
            type="button"
            onClick={() => onSelectMood(mood.id)}
            aria-pressed={active}
            aria-label={`Set mood to ${mood.name}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? 'bg-blue-600 text-white'
                : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] hover:text-slate-100'
            }`}
          >
            {mood.name}
          </button>
        );
      })}
    </div>
  );
}
