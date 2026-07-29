import { useState } from 'react';
import { AUDIO_KINDS, AUDIO_ENVIRONMENTS, AUDIO_MOODS } from '~/types/audio';
import type { AudioKind, AudioEnvironment, AudioMood } from '~/types/audio';
import { ConfirmDialog } from '~/components/shared/ConfirmDialog';

/** Mirrors `bulkTagAudioAssetsSchema` (`app/types/schemas/audio.ts`) minus `ids`. */
export type BulkTagPayload = {
  kind?: AudioKind;
  environment?: AudioEnvironment[];
  mood?: AudioMood[];
  intensity?: number | null;
  tags?: string[];
  tagMode: 'add' | 'replace';
};

export interface AudioBulkTagBarProps {
  /** Number of assets currently selected. Renders nothing when 0. */
  selectedCount: number;
  /** Called with a payload shaped like `bulkTagAudioAssetsSchema` minus `ids`. */
  onApply: (payload: BulkTagPayload) => void;
  /** Optional "clear selection" affordance; omitted when not provided. */
  onClear?: () => void;
}

const INTENSITY_OPTIONS = [1, 2, 3, 4, 5];

function chipClass(active: boolean): string {
  return [
    'rounded px-1.5 py-0.5 text-[11px] transition-colors',
    active
      ? 'bg-blue-600 text-white'
      : 'bg-white/[0.06] text-slate-400 hover:bg-white/[0.1] hover:text-slate-200',
  ].join(' ');
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/**
 * Multi-select bulk classification bar for the audio library. A bulk upload
 * lands unclassified; this is the intended way to classify dozens of assets
 * at once rather than editing them one at a time (see
 * `docs/specs/2026-07-28-audio-library-plan.md`).
 *
 * Renders nothing when `selectedCount` is 0 — there's nothing to bulk-edit
 * and no reason to occupy space above the list.
 *
 * Facets (kind/environment/mood/intensity) live in an always-visible second
 * row rather than behind a `<details>` disclosure. Task 16's
 * `AudioFilterBar` tried the `<details>/<summary>` collapsible the design
 * doc sketches and dropped it: this project's unit tests run under
 * happy-dom, and whether `getByRole` treats content inside a closed
 * `<details>` as accessible depends on `getComputedStyle(...).display`,
 * which is unverified cross-engine behavior not worth depending on for
 * "can a chip be clicked in a test." Same tension applies here, so the same
 * resolution: no collapsible, one extra row.
 *
 * Environment/mood are whole-array replace in the schema (there is no
 * per-facet add/merge mode) — chips selected here become the exact value
 * sent for those fields, and no chips selected means the field is omitted
 * entirely (existing values on the selected assets are left alone). Tags
 * are the only field with an add/replace toggle, because `bulkTagAudioAssets`
 * (Task 6) implements a real merge behaviour for `add` mode
 * ($addToSet) that the other fields don't have.
 *
 * Empty-`replace` on tags is a deliberate, irreversible "clear all tags"
 * action — Task 6's `bulkTagAudioAssets` was fixed so `{ tags: [], tagMode:
 * 'replace' }` clears rather than no-ops, specifically so this bar could
 * offer that as a real feature (bulk-fixing a bad round of tagging). Doing
 * that to up to 200 assets from a single click with no confirmation would
 * make an accidental empty replace (e.g. clicking Apply before typing new
 * tags, after switching the mode selector to "Replace") an unrecoverable
 * mistake, so it goes through the same `ConfirmDialog` the rest of the app
 * uses for destructive actions rather than a bespoke dialog.
 */
export function AudioBulkTagBar({ selectedCount, onApply, onClear }: AudioBulkTagBarProps) {
  const [kind, setKind] = useState<AudioKind | ''>('');
  const [environment, setEnvironment] = useState<AudioEnvironment[]>([]);
  const [mood, setMood] = useState<AudioMood[]>([]);
  const [intensityChoice, setIntensityChoice] = useState<'' | 'clear' | `${number}`>('');
  const [tagText, setTagText] = useState('');
  const [tagMode, setTagMode] = useState<'add' | 'replace'>('add');
  const [pendingWipe, setPendingWipe] = useState<BulkTagPayload | null>(null);

  if (selectedCount === 0) return null;

  const reset = () => {
    setKind('');
    setEnvironment([]);
    setMood([]);
    setIntensityChoice('');
    setTagText('');
    setTagMode('add');
  };

  const buildPayload = (): BulkTagPayload => {
    const parsedTags = tagText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    // In `add` mode, an empty tag field has nothing to add — a genuine
    // no-op, so `tags` is omitted rather than sent as `[]`. In `replace`
    // mode the field's value (including empty) *is* the instruction: set
    // the tags to exactly this, which is how a deliberate clear-all is
    // expressed.
    const tags = tagMode === 'replace' ? parsedTags : parsedTags.length ? parsedTags : undefined;

    const intensity: number | null | undefined =
      intensityChoice === ''
        ? undefined
        : intensityChoice === 'clear'
          ? null
          : Number(intensityChoice);

    return {
      tagMode,
      ...(kind && { kind }),
      ...(environment.length > 0 && { environment }),
      ...(mood.length > 0 && { mood }),
      ...(intensity !== undefined && { intensity }),
      ...(tags !== undefined && { tags }),
    };
  };

  const handleApply = () => {
    const payload = buildPayload();
    const isDestructiveClear =
      payload.tagMode === 'replace' && Array.isArray(payload.tags) && payload.tags.length === 0;

    if (isDestructiveClear) {
      setPendingWipe(payload);
      return;
    }

    onApply(payload);
    reset();
  };

  const confirmWipe = () => {
    if (!pendingWipe) return;
    onApply(pendingWipe);
    setPendingWipe(null);
    reset();
  };

  return (
    <div className="flex flex-col gap-2 border-b border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-200">{selectedCount} selected</span>

        <select
          aria-label="Kind to apply"
          value={kind}
          onChange={(e) => setKind(e.target.value as AudioKind | '')}
          className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-sm text-slate-200 focus:border-blue-500/50 focus:outline-none"
        >
          <option value="">Keep kind</option>
          {AUDIO_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>

        <input
          type="text"
          aria-label="Tags to apply (comma separated)"
          placeholder="storm, rain"
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          className="min-w-0 flex-1 rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-sm text-slate-200 placeholder-slate-600 focus:border-blue-500/50 focus:outline-none sm:flex-none sm:basis-48"
        />

        <select
          aria-label="Tag mode"
          value={tagMode}
          onChange={(e) => setTagMode(e.target.value as 'add' | 'replace')}
          className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-sm text-slate-200 focus:border-blue-500/50 focus:outline-none"
        >
          <option value="add">Add</option>
          <option value="replace">Replace</option>
        </select>

        <button
          type="button"
          onClick={handleApply}
          className="rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-500"
        >
          Apply
        </button>

        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            Clear selection
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="flex flex-wrap gap-1">
          {AUDIO_ENVIRONMENTS.map((env) => (
            <button
              key={env}
              type="button"
              aria-pressed={environment.includes(env)}
              onClick={() => setEnvironment((prev) => toggle(prev, env))}
              className={chipClass(environment.includes(env))}
            >
              {env}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          {AUDIO_MOODS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mood.includes(m)}
              onClick={() => setMood((prev) => toggle(prev, m))}
              className={chipClass(mood.includes(m))}
            >
              {m}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
          Intensity
          <select
            aria-label="Intensity to apply"
            value={intensityChoice}
            onChange={(e) => setIntensityChoice(e.target.value as '' | 'clear' | `${number}`)}
            className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-slate-200 focus:border-blue-500/50 focus:outline-none"
          >
            <option value="">Keep</option>
            {INTENSITY_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            <option value="clear">Clear</option>
          </select>
        </label>
      </div>

      {pendingWipe && (
        <ConfirmDialog
          title="Clear tags?"
          message={`This will remove all tags from ${selectedCount} selected asset${
            selectedCount === 1 ? '' : 's'
          }. This cannot be undone.`}
          confirmLabel="Clear tags"
          danger
          onConfirm={confirmWipe}
          onCancel={() => setPendingWipe(null)}
        />
      )}
    </div>
  );
}
