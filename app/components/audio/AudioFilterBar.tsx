import React, { useState } from 'react';
import { X } from 'lucide-react';
import { AUDIO_KINDS, AUDIO_ENVIRONMENTS, AUDIO_MOODS } from '~/types/audio';
import type { AudioKind } from '~/types/audio';
import { chipClass } from './chipStyles';

/**
 * Mirrors `listAudioAssetsSchema` (`app/types/schemas/audio.ts`) field for
 * field. Filtering is server-side — this is only the shape of the query the
 * caller sends upward, never anything used to filter locally.
 */
export type AudioFilters = {
  kind?: AudioKind;
  environment?: string[];
  mood?: string[];
  tags?: string[];
  search?: string;
  needsTagging?: boolean;
  intensityMin?: number;
  intensityMax?: number;
};

/** Props for the AudioFilterBar component. */
export interface AudioFilterBarProps {
  /** The current filter values (controlled). */
  value: AudioFilters;
  /** Called with the next filter value whenever the user changes a control. */
  onChange: (next: AudioFilters) => void;
}

/**
 * Emits query changes for the server-side audio asset list. Owns no
 * fetching, no filtering, and no knowledge of what the results feed —
 * `AudioLibraryBrowser` (and, in phase 2, an in-campaign picker) just wire
 * `value`/`onChange` to their own state and re-query.
 */
export function AudioFilterBar({ value, onChange }: AudioFilterBarProps) {
  const [tagDraft, setTagDraft] = useState('');

  const toggleMulti = (field: 'environment' | 'mood', item: string) => {
    const current = value[field] ?? [];
    const next = current.includes(item) ? current.filter((x) => x !== item) : [...current, item];
    onChange({ ...value, [field]: next.length ? next : undefined });
  };

  const addTag = () => {
    const tag = tagDraft.trim();
    setTagDraft('');
    if (!tag) return;
    const current = value.tags ?? [];
    if (current.includes(tag)) return;
    onChange({ ...value, tags: [...current, tag] });
  };

  const removeTag = (tag: string) => {
    const next = (value.tags ?? []).filter((t) => t !== tag);
    onChange({ ...value, tags: next.length ? next : undefined });
  };

  const handleIntensity = (field: 'intensityMin' | 'intensityMax', raw: string) => {
    if (raw === '') {
      onChange({ ...value, [field]: undefined });
      return;
    }
    const parsed = Number(raw);
    onChange({ ...value, [field]: Number.isNaN(parsed) ? undefined : parsed });
  };

  return (
    <div className="flex flex-col gap-3 border-b border-white/[0.06] p-3">
      <div className="flex flex-wrap items-center gap-2">
        {AUDIO_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={value.kind === k}
            onClick={() => onChange({ ...value, kind: value.kind === k ? undefined : k })}
            className={chipClass(value.kind === k)}
          >
            {k}
          </button>
        ))}

        <input
          type="search"
          aria-label="Search by title"
          placeholder="Search…"
          value={value.search ?? ''}
          onChange={(e) => onChange({ ...value, search: e.target.value || undefined })}
          className="ml-auto min-w-0 flex-1 rounded border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-blue-500/50 focus:outline-none sm:flex-none sm:basis-64"
        />

        <label className="flex shrink-0 items-center gap-1.5 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={Boolean(value.needsTagging)}
            onChange={(e) => onChange({ ...value, needsTagging: e.target.checked || undefined })}
            className="h-4 w-4 rounded border-white/20 bg-white/[0.05] text-blue-500 focus:ring-blue-500/30"
          />
          Needs tagging
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-1">
          {AUDIO_ENVIRONMENTS.map((env) => (
            <button
              key={env}
              type="button"
              aria-pressed={(value.environment ?? []).includes(env)}
              onClick={() => toggleMulti('environment', env)}
              className={chipClass((value.environment ?? []).includes(env), 'xs')}
            >
              {env}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          {AUDIO_MOODS.map((mood) => (
            <button
              key={mood}
              type="button"
              aria-pressed={(value.mood ?? []).includes(mood)}
              onClick={() => toggleMulti('mood', mood)}
              className={chipClass((value.mood ?? []).includes(mood), 'xs')}
            >
              {mood}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {(value.tags ?? []).map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded bg-white/[0.06] py-0.5 pl-1.5 pr-1 text-[11px] text-slate-400"
            >
              #{tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`Remove tag ${tag}`}
                className="rounded p-0.5 hover:bg-white/[0.1] hover:text-slate-200"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            aria-label="Add tag"
            placeholder="Add tag…"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            className="w-24 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-slate-200 placeholder-slate-600 focus:border-blue-500/50 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <span>Intensity</span>
          <input
            type="number"
            min={1}
            max={5}
            aria-label="Minimum intensity"
            value={value.intensityMin ?? ''}
            onChange={(e) => handleIntensity('intensityMin', e.target.value)}
            className="w-12 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-slate-200 focus:border-blue-500/50 focus:outline-none"
          />
          <span aria-hidden="true">–</span>
          <input
            type="number"
            min={1}
            max={5}
            aria-label="Maximum intensity"
            value={value.intensityMax ?? ''}
            onChange={(e) => handleIntensity('intensityMax', e.target.value)}
            className="w-12 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-slate-200 focus:border-blue-500/50 focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}
