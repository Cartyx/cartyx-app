import { useState } from 'react';
import { X } from 'lucide-react';
import { resolveItemState } from '~/lib/soundboard/resolve';
import { MAX_PACKAGE_MOODS } from '~/types/soundboard';
import type { MoodData, MoodStateData, PackageItemData } from '~/types/soundboard';

export interface MoodEditorProps {
  /** The package's items — every mood's row list is driven by this, not by `states[]`, so an item with no override in a mood still gets a row showing "not playing, inheriting nothing." */
  items: PackageItemData[];
  /** The package's current moods. Fully controlled — this component holds no mood state of its own except which one is selected for editing. */
  moods: MoodData[];
  /** Called with the complete next moods array on every add/remove/rename mood or per-item state edit. The caller owns persistence timing, same convention as `PackageEditor.onItemsChange`. */
  onMoodsChange: (moods: MoodData[]) => void;
  /** System packages are immutable server-side — hides mood add/remove/rename and disables every state control, matching `PackageEditor`'s `readOnly`. */
  readOnly?: boolean;
}

function displayLabel(item: PackageItemData): string {
  return item.label ?? `Asset ${item.assetId.slice(-6)}`;
}

function toNumberOrUndefined(raw: string): number | undefined {
  if (raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

interface OverridableFieldProps {
  label: string;
  ariaLabel: string;
  clearAriaLabel: string;
  testId: string;
  value: number | undefined;
  overridden: boolean;
  min: number;
  max: number;
  step: number;
  type?: 'number' | 'range';
  readOnly: boolean;
  onOverride: (raw: string) => void;
  onClear: () => void;
}

/**
 * The one piece of UI this whole task exists to build: a field that always
 * shows the *resolved* value (never asks the reader to merge item + mood
 * mentally), plus a marker when that value came from an override, plus a way
 * to clear the override that restores "inherit" — not the item's current
 * number — so a later change to the item is followed again.
 *
 * `overridden` MUST be computed by the caller from the raw `MoodStateData`
 * field (`moodState?.field !== undefined`), never from comparing `value` to
 * the item's own value — a mood that overrides a field to exactly the item's
 * value is legal and must still show the marker (Task 8's report flagged
 * this trap explicitly). This component only renders what it's told; it does
 * not re-derive "overridden" itself.
 */
function OverridableField({
  label,
  ariaLabel,
  clearAriaLabel,
  testId,
  value,
  overridden,
  min,
  max,
  step,
  type = 'number',
  readOnly,
  onOverride,
  onClear,
}: OverridableFieldProps) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
      {label}
      <input
        type={type}
        min={min}
        max={max}
        step={step}
        value={value ?? ''}
        disabled={readOnly}
        aria-label={ariaLabel}
        onChange={(e) => onOverride(e.target.value)}
        className={`${type === 'range' ? 'w-24 accent-amber-400' : 'w-16 rounded border bg-white/[0.04] px-1.5 py-0.5 text-slate-200 focus:outline-none'} disabled:opacity-50 ${
          overridden ? 'border-amber-400/60' : 'border-white/10 focus:border-blue-500/50'
        }`}
      />
      {overridden && (
        <span
          data-testid={testId}
          title="Overridden by this mood"
          className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300"
        >
          mood
        </span>
      )}
      {overridden && !readOnly && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearAriaLabel}
          className="text-slate-500 transition-colors hover:text-slate-300"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </label>
  );
}

interface MoodItemStateRowProps {
  item: PackageItemData;
  moodState: MoodStateData | undefined;
  onChange: (patch: Partial<MoodStateData>) => void;
  readOnly: boolean;
}

/**
 * One item's row within the selected mood. Always renders the *resolved*
 * value (`resolveItemState`) — never the raw item value and raw mood value
 * side by side — because making the reader merge two records in their head
 * is exactly the ambiguity the design calls out as the source of repeated
 * phase-1 bugs. The override marker on each field is driven by the raw
 * `moodState` field's presence, computed here and passed down, never
 * inferred from `resolved` (see `OverridableField`'s doc comment).
 */
function MoodItemStateRow({ item, moodState, onChange, readOnly }: MoodItemStateRowProps) {
  const resolved = resolveItemState(item, moodState);
  const label = displayLabel(item);

  const intervalInvalid =
    resolved.randomIntervalMin != null &&
    resolved.randomIntervalMax != null &&
    resolved.randomIntervalMin > resolved.randomIntervalMax;

  return (
    <li
      data-testid="mood-state-row"
      data-item-id={item.id}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5"
    >
      <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <input
          type="checkbox"
          checked={resolved.playing}
          disabled={readOnly}
          aria-label={`Playing ${label} in this mood`}
          onChange={(e) => onChange({ playing: e.target.checked })}
          className="h-4 w-4 rounded border-white/20 bg-white/[0.05] text-blue-500 focus:ring-blue-500/30"
        />
      </label>

      <span className="min-w-0 basis-40 flex-1 truncate text-sm font-medium text-slate-200">
        {label}
      </span>

      <OverridableField
        label="Volume"
        ariaLabel={`Volume for ${label} in this mood`}
        clearAriaLabel={`Clear volume override for ${label}`}
        testId={`override-marker-volume-${item.id}`}
        value={resolved.volume}
        overridden={moodState?.volume !== undefined}
        min={0}
        max={1}
        step={0.01}
        type="range"
        readOnly={readOnly}
        onOverride={(raw) => onChange({ volume: toNumberOrUndefined(raw) ?? 0 })}
        onClear={() => onChange({ volume: undefined })}
      />

      <OverridableField
        label="Fade (s)"
        ariaLabel={`Fade seconds for ${label} in this mood`}
        clearAriaLabel={`Clear fade override for ${label}`}
        testId={`override-marker-fade-${item.id}`}
        value={resolved.fadeSeconds}
        overridden={moodState?.fadeSeconds !== undefined}
        min={0}
        max={30}
        step={0.5}
        readOnly={readOnly}
        onOverride={(raw) => onChange({ fadeSeconds: toNumberOrUndefined(raw) ?? 0 })}
        onClear={() => onChange({ fadeSeconds: undefined })}
      />

      <div className="flex items-center gap-1 text-[11px] text-slate-500">
        <span>Random interval (s)</span>
        <OverridableField
          label=""
          ariaLabel={`Random interval minimum for ${label} in this mood`}
          clearAriaLabel={`Clear random interval minimum override for ${label}`}
          testId={`override-marker-random-min-${item.id}`}
          value={resolved.randomIntervalMin}
          overridden={moodState?.randomIntervalMin !== undefined}
          min={1}
          max={3600}
          step={1}
          readOnly={readOnly}
          onOverride={(raw) => onChange({ randomIntervalMin: toNumberOrUndefined(raw) })}
          onClear={() => onChange({ randomIntervalMin: undefined })}
        />
        <span aria-hidden="true">–</span>
        <OverridableField
          label=""
          ariaLabel={`Random interval maximum for ${label} in this mood`}
          clearAriaLabel={`Clear random interval maximum override for ${label}`}
          testId={`override-marker-random-max-${item.id}`}
          value={resolved.randomIntervalMax}
          overridden={moodState?.randomIntervalMax !== undefined}
          min={1}
          max={3600}
          step={1}
          readOnly={readOnly}
          onOverride={(raw) => onChange({ randomIntervalMax: toNumberOrUndefined(raw) })}
          onClear={() => onChange({ randomIntervalMax: undefined })}
        />
        {intervalInvalid && <span className="text-rose-400">Min must be ≤ max</span>}
      </div>
    </li>
  );
}

/**
 * The mood editor: a mood selector (add/rename/remove, capped at
 * `MAX_PACKAGE_MOODS`, enforced here in the UI same as `PackageEditor` does
 * for items) plus, for whichever mood is selected, one row per package item
 * showing that item's *resolved* playback state for the mood — "what will I
 * hear?" at a glance, per the design doc.
 *
 * Mood ids: `crypto.randomUUID()`, same convention `PackageEditor` uses for
 * item ids (`DiceRollerPanel`, `useChatMessages`, etc.) — stable for the
 * mood's lifetime, unique within the package (capped at 32 moods, so
 * collision odds are not a practical concern), and preserved by Task 5's
 * clone.
 */
export function MoodEditor({ items, moods, onMoodsChange, readOnly = false }: MoodEditorProps) {
  const [selectedMoodId, setSelectedMoodId] = useState<string | null>(null);

  const selectedMood = moods.find((m) => m.id === selectedMoodId) ?? moods[0];

  const atCap = moods.length >= MAX_PACKAGE_MOODS;

  const handleAddMood = () => {
    if (atCap) return;
    const id = crypto.randomUUID();
    const newMood: MoodData = { id, name: `Mood ${moods.length + 1}`, states: [] };
    onMoodsChange([...moods, newMood]);
    setSelectedMoodId(id);
  };

  const handleRenameMood = (id: string, name: string) => {
    onMoodsChange(moods.map((m) => (m.id === id ? { ...m, name } : m)));
  };

  const handleRemoveMood = (id: string) => {
    onMoodsChange(moods.filter((m) => m.id !== id));
    if (selectedMoodId === id) setSelectedMoodId(null);
  };

  /**
   * Upserts one item's state within the currently selected mood. `patch` may
   * set a field to a concrete value (creating/updating an override) or to
   * `undefined` (clearing one — the inverse operation, and the one most
   * likely to be implemented wrong: it must produce `undefined`, not the
   * item's current value, or the mood silently stops following the item once
   * the item's own value later changes).
   */
  const handleStateChange = (itemId: string, patch: Partial<MoodStateData>) => {
    if (!selectedMood) return;
    const existing = selectedMood.states.find((s) => s.itemId === itemId);
    const nextState: MoodStateData = existing
      ? { ...existing, ...patch }
      : { itemId, playing: false, ...patch };
    const nextStates = existing
      ? selectedMood.states.map((s) => (s.itemId === itemId ? nextState : s))
      : [...selectedMood.states, nextState];
    onMoodsChange(moods.map((m) => (m.id === selectedMood.id ? { ...m, states: nextStates } : m)));
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-sans text-xs uppercase tracking-widest text-slate-400">
        Moods ({moods.length}/{MAX_PACKAGE_MOODS})
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        {moods.map((mood) => (
          <div
            key={mood.id}
            className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs ${
              selectedMood?.id === mood.id
                ? 'border-blue-500/60 bg-blue-500/10 text-blue-200'
                : 'border-white/10 text-slate-400'
            }`}
          >
            <button
              type="button"
              onClick={() => setSelectedMoodId(mood.id)}
              aria-label={`Select mood ${mood.name}`}
              aria-pressed={selectedMood?.id === mood.id}
            >
              {mood.name}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => handleRemoveMood(mood.id)}
                aria-label={`Remove mood ${mood.name}`}
                className="text-slate-500 hover:text-red-400"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}

        {!readOnly && (
          <button
            type="button"
            onClick={handleAddMood}
            disabled={atCap}
            title={atCap ? `Package is full (${MAX_PACKAGE_MOODS} moods max)` : undefined}
            className="rounded-full border border-dashed border-white/20 px-3 py-1 text-xs text-slate-400 hover:border-blue-500/50 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-white/20 disabled:hover:text-slate-400"
          >
            + Add mood
          </button>
        )}
      </div>

      {atCap && !readOnly && (
        <p role="status" className="text-xs text-amber-400">
          Package is full ({MAX_PACKAGE_MOODS} moods max) — remove a mood to add another.
        </p>
      )}

      {moods.length === 0 && (
        <p className="px-1 py-4 text-sm text-slate-500">
          No moods yet. Add one to start building scenes.
        </p>
      )}

      {selectedMood && (
        <div className="flex flex-col gap-3">
          {!readOnly && (
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
              Mood name
              <input
                type="text"
                value={selectedMood.name}
                aria-label="Mood name"
                onChange={(e) => handleRenameMood(selectedMood.id, e.target.value)}
                className="w-48 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-slate-200 focus:border-blue-500/50 focus:outline-none"
              />
            </label>
          )}

          {items.length === 0 ? (
            <p className="px-1 py-4 text-sm text-slate-500">
              No items in this package yet — add some above.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.06] rounded border border-white/[0.06]">
              {[...items]
                .sort((a, b) => a.sortIndex - b.sortIndex)
                .map((item) => (
                  <MoodItemStateRow
                    key={item.id}
                    item={item}
                    moodState={selectedMood.states.find((s) => s.itemId === item.id)}
                    onChange={(patch) => handleStateChange(item.id, patch)}
                    readOnly={readOnly}
                  />
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
