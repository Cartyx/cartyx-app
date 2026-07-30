import { useEffect, useRef, useState } from 'react';
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
  /**
   * Task 18: attach a `∞`/`1×` once-variant source file for a `music`
   * asset. Omitted entirely hides the control — same "owns no fetching, no
   * mutations" contract as `onSave`/`onClose`: this component only hands
   * the picked `File` back to the caller, which owns the actual
   * presign/PUT/confirm sequence (`~/utils/uploadAudio.ts`'s
   * `uploadOnceVariantFile`).
   */
  onAttachOnceVariant?: (file: File) => void;
  /** True while a once-variant upload is presigning/PUTting/confirming. */
  attachingOnceVariant?: boolean;
  /** Surfaced above the once-variant control when the last attach attempt failed. */
  onceVariantError?: string | null;
}

const MAX_FACETS = 10;
const MAX_TAGS = 30;
const MAX_TAG_LENGTH = 40;
const INTENSITY_OPTIONS = [1, 2, 3, 4, 5];

/**
 * Multiset (order-insensitive, count-sensitive) equality — chip selections
 * and parsed tags don't preserve the original array order, but duplicate
 * counts still matter. A same-*set* comparison (dropping duplicates before
 * comparing) is wrong here: `['storm', 'rain']` vs. `['storm', 'storm']`
 * have the same unique elements but are not the same edit, and treating
 * them as equal would silently drop a real tags change from the payload.
 */
function sameElements(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((x, i) => x === sortedB[i]);
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
  onAttachOnceVariant,
  attachingOnceVariant = false,
  onceVariantError = null,
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

  // Read through a ref (not `asset` directly) so the reset effect below can
  // key off `asset.id` alone without needing `asset` itself in its deps.
  const assetRef = useRef(asset);
  assetRef.current = asset;

  // The snapshot every field is diffed against on Save (see handleSubmit) —
  // deliberately not the live `asset` prop. It only advances when the reset
  // effect below runs (asset.id changes), so a same-id refetch mid-edit
  // can't make an untouched field look changed, or — worse — look
  // unchanged and get silently resubmitted with a value that's gone stale
  // relative to what the server now has, clobbering a legitimate
  // concurrent update (e.g. a bulk tag applied to this same asset while
  // the modal was open).
  const baselineRef = useRef(asset);

  // Resets the form when the *identity* of the edited asset changes — e.g.
  // Task 19 swapping which asset this modal is open for, or a fresh mount.
  // Deliberately keyed on `asset.id`, not the `asset` object reference:
  // Task 19 polls the asset list every 4s while any asset is non-terminal,
  // so a background refetch produces a new object for the *same* asset on
  // every poll. Resetting on every new reference would wipe an in-progress,
  // unsaved edit out from under the user mid-typing. Read-only context
  // (duration/status/lastError) still reads `asset` directly in the JSX
  // below, so it keeps refreshing from the latest poll even though the
  // editable fields — and the baseline they're compared against — don't.
  useEffect(() => {
    const current = assetRef.current;
    baselineRef.current = current;
    setTitle(current.title);
    setKind(current.kind);
    setEnvironment(current.environment as AudioEnvironment[]);
    setMood(current.mood as AudioMood[]);
    setIntensity(current.intensity);
    setTagText(current.tags.join(', '));
    setTitleError(null);
  }, [asset.id]);

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
    const baseline = baselineRef.current;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError('Title is required.');
      return;
    }
    setTitleError(null);

    const parsedTags = parseTags(tagText);

    const payload: AudioAssetDetailPayload = {};
    if (trimmedTitle !== baseline.title) payload.title = trimmedTitle;
    if (kind !== baseline.kind) payload.kind = kind;
    if (!sameElements(environment, baseline.environment)) payload.environment = environment;
    if (!sameElements(mood, baseline.mood)) payload.mood = mood;
    if (intensity !== baseline.intensity) payload.intensity = intensity;
    if (!sameElements(parsedTags, baseline.tags)) payload.tags = parsedTags;

    onSave(payload);
  };

  const fieldClass =
    'w-full rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm text-slate-200 focus:border-blue-500/50 focus:outline-none disabled:opacity-50';

  // Matches BoardPad's exact gating expression (Task 16) — that component
  // shows the ∞/1× control on precisely this condition, so "attached" here
  // must mean the same thing it means there.
  const hasOnceVariant = Boolean(asset.onceRenditions?.opus ?? asset.onceRenditions?.aac);

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

          {asset.kind === 'music' && onAttachOnceVariant && (
            <div>
              <span className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-400">
                Once-variant (1× ending)
              </span>
              <p className="text-xs text-slate-500">
                {hasOnceVariant
                  ? 'A once-variant is attached. Choose a new file to replace it.'
                  : "Optional. The board's ∞/1× control plays this file instead of looping when set to 1×."}
              </p>
              {onceVariantError && (
                <p role="alert" className="mt-1 text-xs text-red-400">
                  {onceVariantError}
                </p>
              )}
              <input
                type="file"
                accept="audio/*"
                aria-label="Attach once-variant audio file"
                disabled={saving || attachingOnceVariant || asset.status !== 'ready'}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Reset so picking the same file again still fires onChange.
                  e.target.value = '';
                  if (file) onAttachOnceVariant(file);
                }}
                className="mt-1.5 block w-full text-xs text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-blue-600 file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-blue-500 disabled:opacity-50"
              />
              {attachingOnceVariant && <p className="mt-1 text-xs text-slate-400">Uploading…</p>}
              {asset.status !== 'ready' && !attachingOnceVariant && (
                <p className="mt-1 text-xs text-slate-500">
                  Available once the main audio finishes processing.
                </p>
              )}
            </div>
          )}
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
