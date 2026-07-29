import { useCallback, useRef, useState } from 'react';
import { Upload, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { uploadAudioFile } from '~/utils/uploadAudio';
import { captureException } from '~/utils/telemetry-client';
import { AUDIO_KINDS, AUDIO_MAX_BYTES } from '~/types/audio';
import type { AudioKind } from '~/types/audio';

type UploadItemStatus = 'pending' | 'uploading' | 'done' | 'error';

type UploadItem = {
  /**
   * Unique per item, not the array index. A second batch replaces `items`
   * wholesale while the first batch's loop is still running (in-flight
   * `setItems` updaters were written against the first batch's positions);
   * an id lets each in-flight update find its own row — or safely become a
   * no-op if that row no longer exists — instead of silently overwriting
   * whatever now sits at the same numeric index. Belt-and-suspenders with
   * the `isUploading` guard below, which is the primary fix.
   */
  id: string;
  name: string;
  status: UploadItemStatus;
  error?: string;
};

/** Props for the AudioUploadDropzone component. */
export interface AudioUploadDropzoneProps {
  /**
   * Called once after the whole batch has settled — every file either
   * `done` or `error` — so the caller (Task 19's library route) can
   * invalidate its asset-list query a single time. Never called per-file.
   */
  onUploaded?: () => void;
}

function formatMaxSize(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/**
 * Multi-file audio upload with a batch-default `kind` and per-file status.
 *
 * Files can be dropped onto the zone or chosen via the file input. The
 * input is the accessible path — visually hidden (`sr-only`, not
 * `display:none`) but reachable by keyboard via its `<label>`, so a
 * drag-and-drop-only interaction never locks out a keyboard or
 * screen-reader user. Dragging is a convenience layered on top, not a
 * replacement.
 *
 * `kind` is a single batch default, not per-file: a folder of ambience is
 * usually dropped together, and `kind` drives phase-2 playback defaults, so
 * asking for it once per batch (rather than leaving every row unset) is the
 * useful default. Per-file override happens afterwards via the bulk-tag bar
 * or the detail modal — not here.
 *
 * Uploads run sequentially, not concurrently: `uploadAudioFile` is a
 * presign -> PUT -> confirm round trip per file, and a bulk drop of dozens
 * of files must not open that many concurrent PUTs. Sequential execution
 * also keeps failures isolated — one file's row goes to `error` without
 * touching the files queued behind it, which still get their own attempt.
 *
 * Only one batch runs at a time. While a batch is in flight, the file input
 * is disabled and drops are refused (no highlight, no queued files) rather
 * than starting a second, overlapping loop — a second batch is deliberately
 * rejected outright, not queued. Queueing was considered (friendlier — no
 * dropped input) but rejected here: it would need the queued files to
 * appear immediately as `pending` rows without actually uploading yet,
 * which is easy to mistake for "stuck," and it adds a second piece of state
 * (a pending queue) for what's expected to be a rare collision — GM upload
 * sessions are "drop a folder, wait, drop the next," not a firehose.
 * Disabling is simpler to reason about and the zone's state (disabled
 * input, no drag highlight) tells the user why up front.
 *
 * The client-side size check against `AUDIO_MAX_BYTES` is a courtesy that
 * saves a pointless transfer for an obviously-oversized file; it is not the
 * enforcement boundary, and neither is the server's `HeadObject` in
 * `confirmAudioUpload`. A presigned PUT URL cannot cap Content-Length and stays
 * valid and reusable for 300 s after confirm measured it, so `HeadObject`
 * describes the object as it was at one instant and nothing re-measures it
 * afterwards. The real enforcement is the audio worker's `downloadSource`,
 * which counts the bytes as they arrive, refuses the source permanently if they
 * exceed the cap, and deletes the R2 object so an oversized file cannot squat
 * in storage behind a `failed` row.
 */
export function AudioUploadDropzone({ onUploaded }: AudioUploadDropzoneProps) {
  const [kind, setKind] = useState<AudioKind>('ambience');
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  // Counts nested dragenter/dragleave pairs (the zone has children), so
  // only the outermost dragleave — actually exiting the zone — clears the
  // active state.
  const dragDepth = useRef(0);
  // Mirrors isUploading for handleFiles's synchronous guard: state updates
  // are async, so a second drop/change event arriving before React
  // re-renders would still read the stale `false` from the isUploading
  // closure. A ref is readable/writable synchronously within the same tick.
  const uploadingRef = useRef(false);

  const handleFiles = useCallback(
    async (fileList: FileList | Iterable<File> | null) => {
      if (!fileList) return;
      const files = Array.from(fileList);
      if (files.length === 0) return;
      if (uploadingRef.current) {
        // A batch is already running — refuse the second one outright
        // rather than interleaving two loops' index-addressed updates
        // (see the class doc comment). The caller gets no feedback beyond
        // the disabled input / suppressed drag highlight; nothing is
        // queued.
        return;
      }
      uploadingRef.current = true;
      setIsUploading(true);

      const batch = files.map((file) => ({ id: crypto.randomUUID(), file }));
      setItems(batch.map(({ id, file }) => ({ id, name: file.name, status: 'pending' })));

      for (const { id, file } of batch) {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'uploading' } : it)));
        try {
          if (file.size > AUDIO_MAX_BYTES) {
            throw new Error(`File exceeds the ${formatMaxSize(AUDIO_MAX_BYTES)} limit`);
          }
          await uploadAudioFile(file, { kind });
          setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'done' } : it)));
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Upload failed';
          setItems((prev) =>
            prev.map((it) => (it.id === id ? { ...it, status: 'error', error: message } : it))
          );
        }
      }

      uploadingRef.current = false;
      setIsUploading(false);
      try {
        onUploaded?.();
      } catch (e) {
        // onUploaded is caller-provided (e.g. Task 19's query
        // invalidation). handleFiles is invoked as `void handleFiles(...)`
        // at both call sites below, so an uncaught throw here would become
        // an unhandled promise rejection instead of a normal error the
        // caller can see in its own telemetry.
        captureException(e, { action: 'AudioUploadDropzone.onUploaded' });
      }
    },
    [kind, onUploaded]
  );

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (isUploading) return; // don't imply a drop would be accepted right now
    if (!e.dataTransfer.types.includes('Files')) return;
    dragDepth.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    // Required so the browser allows a drop on this element at all.
    e.preventDefault();
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (isUploading) return; // refuse a second, overlapping batch
    void handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      data-testid="audio-upload-dropzone"
      // Non-interactive role: the drop behavior is a mouse-only convenience
      // layered on top of the real, keyboard-accessible control below (the
      // file input via its label). Assistive tech has no use for "drag a
      // file here," so this container makes no claim of being an
      // interactive widget itself.
      role="group"
      aria-label="Audio file upload"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`rounded border border-dashed p-4 transition-colors ${
        isDragging ? 'border-blue-500 bg-blue-500/[0.04]' : 'border-white/10'
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="audio-batch-kind" className="text-sm text-slate-400">
          Kind for this batch
        </label>
        <select
          id="audio-batch-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as AudioKind)}
          className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-sm text-slate-200 focus:border-blue-500/50 focus:outline-none"
        >
          {AUDIO_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <Upload className="h-6 w-6 text-slate-500" aria-hidden="true" />
        <p className={isUploading ? 'text-sm text-slate-500' : 'text-sm text-slate-400'}>
          {isUploading ? 'Uploading batch — ' : 'Drag audio files here, or '}
          {/* The <label> stays rendered (and associated with the input)
              in both states, disabled or not, so the input keeps an
              accessible name and getByLabelText keeps resolving it even
              while a batch is in flight. */}
          <label
            htmlFor="audio-files"
            className={
              isUploading
                ? 'text-slate-500'
                : 'cursor-pointer text-blue-400 underline-offset-2 hover:underline'
            }
          >
            choose audio files
          </label>
          {isUploading && ' once this batch finishes'}
        </p>
        <input
          id="audio-files"
          type="file"
          multiple
          accept="audio/*"
          disabled={isUploading}
          className="sr-only"
          onChange={(e) => {
            void handleFiles(e.target.files);
            // Reset so choosing the same file(s) again re-fires onChange.
            e.target.value = '';
          }}
        />
      </div>

      {items.length > 0 && (
        // aria-live: per-file status changes silently otherwise — a
        // screen-reader user would have no way to learn a file finished or
        // failed short of re-reading the whole list.
        <ul aria-live="polite" className="mt-3 space-y-1 text-sm">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-slate-300">{it.name}</span>
              <StatusBadge item={it} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ item }: { item: UploadItem }) {
  switch (item.status) {
    case 'uploading':
      return (
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          Uploading…
        </span>
      );
    case 'done':
      return (
        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Done
        </span>
      );
    case 'error':
      return (
        <span className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {item.error}
        </span>
      );
    default:
      return <span className="text-xs text-slate-600">Pending</span>;
  }
}
