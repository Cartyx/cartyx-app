import { useCallback, useRef, useState } from 'react';
import { Upload, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { uploadAudioFile } from '~/utils/uploadAudio';
import { AUDIO_KINDS, AUDIO_MAX_BYTES } from '~/types/audio';
import type { AudioKind } from '~/types/audio';

type UploadItemStatus = 'pending' | 'uploading' | 'done' | 'error';

type UploadItem = {
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
 * The client-side size check against `AUDIO_MAX_BYTES` is a courtesy that
 * saves a pointless transfer for an obviously-oversized file; it is not the
 * enforcement boundary. A presigned PUT URL can't cap Content-Length, so the
 * server's `HeadObject` in `confirmAudioUpload` is what actually enforces
 * the limit (see `uploadAudioFile`'s doc comment in `~/utils/uploadAudio`).
 */
export function AudioUploadDropzone({ onUploaded }: AudioUploadDropzoneProps) {
  const [kind, setKind] = useState<AudioKind>('ambience');
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  // Counts nested dragenter/dragleave pairs (the zone has children), so
  // only the outermost dragleave — actually exiting the zone — clears the
  // active state.
  const dragDepth = useRef(0);

  const handleFiles = useCallback(
    async (fileList: FileList | Iterable<File> | null) => {
      if (!fileList) return;
      const files = Array.from(fileList);
      if (files.length === 0) return;
      setItems(files.map((f) => ({ name: f.name, status: 'pending' })));

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: 'uploading' } : it)));
        try {
          if (file.size > AUDIO_MAX_BYTES) {
            throw new Error(`File exceeds the ${formatMaxSize(AUDIO_MAX_BYTES)} limit`);
          }
          await uploadAudioFile(file, { kind });
          setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: 'done' } : it)));
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Upload failed';
          setItems((prev) =>
            prev.map((it, j) => (j === i ? { ...it, status: 'error', error: message } : it))
          );
        }
      }
      onUploaded?.();
    },
    [kind, onUploaded]
  );

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
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
        <p className="text-sm text-slate-400">
          Drag audio files here, or{' '}
          <label
            htmlFor="audio-files"
            className="cursor-pointer text-blue-400 underline-offset-2 hover:underline"
          >
            choose audio files
          </label>
        </p>
        <input
          id="audio-files"
          type="file"
          multiple
          accept="audio/*"
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
          {items.map((it, i) => (
            <li key={`${it.name}-${i}`} className="flex items-center gap-2">
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
