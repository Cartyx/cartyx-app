import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { AUDIO_KINDS, AUDIO_ENVIRONMENTS, AUDIO_MOODS } from '~/types/audio';
import type { AudioAssetData, AudioKind, AudioEnvironment, AudioMood } from '~/types/audio';
import { formatDuration } from './AudioAssetRow';
import { chipClass, toggleInArray } from './chipStyles';
import { useFocusTrap } from '~/hooks/useFocusTrap';

/**
 * Mirrors `updateAudioAssetSchema` (`app/types/schemas/audio.ts`) minus
 * `id`. Task 19 spreads `{ id, ...payload }` into `updateAudioAssetFn`.
 */
export type AudioAssetDetailPayload = {
  title?: string;
  kind?: AudioKind;
  environment?: AudioEnvironment[];
  mood?: AudioMood[];
  intensity?: number | null;
  tags?: string[];
};

/** Props for the AudioAssetDetail component. */
export interface AudioAssetDetailProps {
  /** The asset being edited. */
  asset: AudioAssetData;
  /**
   * Called with only the fields that changed from `asset`'s current values
   * — never the full record. Keeps the modal consistent with a PATCH-style
   * update, and means concurrently-edited fields (e.g. a bulk tag applied
   * by someone else while this modal was open) aren't stomped by
   * resubmitting values the user never touched.
   */
  onSave: (payload: AudioAssetDetailPayload) => void;
  /** Called to dismiss the modal: Cancel, the close button, Escape, or a backdrop click. */
  onClose: () => void;
  /** Disables the form and shows a saving state on the Save control. */
  saving?: boolean;
  /** Surfaced above the fields when the last save attempt failed. */
  error?: string | null;
}

const MAX_FACETS = 10;
const MAX_TAGS = 30;
const MAX_TAG_LENGTH = 40;
const INTENSITY_OPTIONS = [1, 2, 3, 4, 5];

/** Order-insensitive equality — chip selections and parsed tags don't preserve the original array order. */
function sameElements(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

function parseTags(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH)
    .slice(0, MAX_TAGS);
}

/**
 * Single-asset edit modal. The only place in the product that can rename an
 * asset — `AudioBulkTagBar` (Task 18) deliberately has no title field, since
 * one title across many assets is meaningless, but a bulk drop names every
 * asset from its filename (`titleFromFilename`), so fixing a title has to
 * happen one asset at a time. Also the only way to fix a single asset's
 * facets without touching the other 49 selected in a bulk tag.
 *
 * Owns no fetching and no mutations — `onSave`/`onClose` are the entire
 * contract, exactly like the other audio components (Tasks 15-18). Task 19
 * wires `onSave` to `updateAudioAssetFn`.
 *
 * Structural shell (portal, backdrop-click-to-close, header/body/footer)
 * follows `QuestModal`/`OrganizationModal`. Focus management follows
 * `ConfirmDialog`: `useFocusTrap` traps Tab inside the dialog and restores
 * focus to the opener on unmount, and the title field's `autoFocus` moves
 * focus in on open (per `useFocusTrap`'s doc comment, a child `autoFocus`
 * commits before the hook's own effect runs, so it wins the race safely).
 * Like the sibling modals, Escape and the backdrop close unconditionally —
 * they are not gated on `saving`.
 */
export function AudioAssetDetail({
  asset,
  onSave,
  onClose,
  saving = false,
  error = null,
}: AudioAssetDetailProps) {
  const trapRef = useFocusTrap<HTMLFormElement>();

  const [title, setTitle] = useState(asset.title);
  const [kind, setKind] = useState<AudioKind>(asset.kind);
  const [environment, setEnvironment] = useState<AudioEnvironment[]>(
    asset.environment as AudioEnvironment[]
  );
  const [mood, setMood] = useState<AudioMood[]>(asset.mood as AudioMood[]);
  const [intensity, setIntensity] = useState<number | null>(asset.intensity);
  const [tagText, setTagText] = useState(asset.tags.join(', '));
  const [titleError, setTitleError] = useState<string | null>(null);

  // Defensive reset if the caller swaps `asset` without unmounting this
  // component (Task 19 is expected to mount it per-asset, but this keeps
  // the form correct either way).
  useEffect(() => {
    setTitle(asset.title);
    setKind(asset.kind);
    setEnvironment(asset.environment as AudioEnvironment[]);
    setMood(asset.mood as AudioMood[]);
    setIntensity(asset.intensity);
    setTagText(asset.tags.join(', '));
    setTitleError(null);
  }, [asset]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const toggleEnvironment = (env: AudioEnvironment) => {
    setEnvironment((prev) =>
      prev.includes(env) || prev.length < MAX_FACETS ? toggleInArray(prev, env) : prev
    );
  };

  const toggleMood = (m: AudioMood) => {
    setMood((prev) =>
      prev.includes(m) || prev.length < MAX_FACETS ? toggleInArray(prev, m) : prev
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError('Title is required.');
      return;
    }
    setTitleError(null);

    const parsedTags = parseTags(tagText);

    const payload: AudioAssetDetailPayload = {};
    if (trimmedTitle !== asset.title) payload.title = trimmedTitle;
    if (kind !== asset.kind) payload.kind = kind;
    if (!sameElements(environment, asset.environment)) payload.environment = environment;
    if (!sameElements(mood, asset.mood)) payload.mood = mood;
    if (intensity !== asset.intensity) payload.intensity = intensity;
    if (!sameElements(parsedTags, asset.tags)) payload.tags = parsedTags;

    onSave(payload);
  };

  const fieldClass =
    'w-full rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm text-slate-200 focus:border-blue-500/50 focus:outline-none disabled:opacity-50';

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        ref={trapRef}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audio-asset-detail-title"
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0D1117] shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <h2
            id="audio-asset-detail-title"
            className="font-sans text-sm font-bold uppercase tracking-widest text-blue-400"
          >
            Edit audio asset
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-500 transition-colors hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {error && (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>
              Duration: <span>{formatDuration(asset.durationMs)}</span>
            </span>
            <span>
              Status: <span>{asset.status}</span>
            </span>
          </div>
          {asset.status === 'failed' && asset.lastError && (
            <p className="text-xs text-red-400">{asset.lastError}</p>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-semibold tracking-wide text-slate-400">
              Title
            </span>
            <input
              type="text"
              aria-label="Title"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- moves focus into the dialog on open, per useFocusTrap's doc comment (child autoFocus wins the race against the hook's own effect).
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              disabled={saving}
              className={fieldClass}
            />
            {titleError && <p className="mt-1 text-xs text-red-400">{titleError}</p>}
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold tracking-wide text-slate-400">
              Kind
            </span>
            <select
              aria-label="Kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as AudioKind)}
              disabled={saving}
              className={fieldClass}
            >
              {AUDIO_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-400">
              Environment
            </span>
            <div className="flex flex-wrap gap-1">
              {AUDIO_ENVIRONMENTS.map((env) => (
                <button
                  key={env}
                  type="button"
                  aria-pressed={environment.includes(env)}
                  onClick={() => toggleEnvironment(env)}
                  disabled={saving}
                  className={chipClass(environment.includes(env), 'xs')}
                >
                  {env}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-400">
              Mood
            </span>
            <div className="flex flex-wrap gap-1">
              {AUDIO_MOODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mood.includes(m)}
                  onClick={() => toggleMood(m)}
                  disabled={saving}
                  className={chipClass(mood.includes(m), 'xs')}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold tracking-wide text-slate-400">
              Intensity
            </span>
            <select
              aria-label="Intensity"
              value={intensity ?? ''}
              onChange={(e) => setIntensity(e.target.value === '' ? null : Number(e.target.value))}
              disabled={saving}
              className={fieldClass}
            >
              <option value="">None</option>
              {INTENSITY_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold tracking-wide text-slate-400">
              Tags (comma separated)
            </span>
            <input
              type="text"
              aria-label="Tags"
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              disabled={saving}
              className={fieldClass}
            />
          </label>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-white/[0.07] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded px-3 py-1.5 text-sm text-slate-400 transition-colors hover:text-slate-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
