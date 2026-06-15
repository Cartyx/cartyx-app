import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Check, Loader2 } from 'lucide-react';
import { FormInput } from '~/components/FormInput';
import { PixelButton } from '~/components/PixelButton';
import { uploadToR2 } from '~/utils/uploadToR2';
import { useMapsMutations } from '~/hooks/useMaps';
import { useLocations } from '~/hooks/useLocations';
import { MapScaleGizmo } from './MapScaleGizmo';
import type { GridType } from '~/types/schemas/maps';

interface MapUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
}

interface UploadedImage {
  imageKey: string;
  imageUrl: string;
  width: number;
  height: number;
}

type UploadStatus = 'idle' | 'uploading' | 'ready' | 'error';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export function MapUploadModal({ isOpen, onClose, campaignId }: MapUploadModalProps) {
  const { createMap, updateMapScale } = useMapsMutations(campaignId);
  const { locations } = useLocations(campaignId);

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadedImage | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [gridType, setGridType] = useState<GridType>('square');
  const [gizmo, setGizmo] = useState({ centerX: 0, centerY: 0, sizePx: 50 });
  const [createdMapId, setCreatedMapId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setName('');
      setLocationId('');
      setFile(null);
      setPreviewUrl(null);
      setUpload(null);
      setUploadStatus('idle');
      setUploadError(null);
      setGridType('square');
      setGizmo({ centerX: 0, centerY: 0, sizePx: 50 });
      setCreatedMapId(null);
      setIsSaving(false);
    }
  }, [isOpen]);

  // Esc closes the modal (now that the backdrop click is disabled).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Build a local object URL for the preview while we wait for R2.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleFileSelect = useCallback(async (chosen: File) => {
    if (!ALLOWED_TYPES.includes(chosen.type as (typeof ALLOWED_TYPES)[number])) {
      setUploadError('Only PNG, JPEG, GIF, and WebP images are allowed.');
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setUploadError('File is too large (max 25 MB).');
      return;
    }
    setUploadError(null);
    setFile(chosen);

    // Probe dimensions client-side.
    const dims = await probeImageDimensions(chosen);
    if (!dims) {
      setUploadError('Could not read image dimensions.');
      return;
    }

    // Kick off the R2 upload immediately so step 2 is instant.
    setUploadStatus('uploading');
    try {
      const { imageKey, publicUrl } = await uploadToR2(chosen, 'uploads/maps');
      setUpload({ imageKey, imageUrl: publicUrl, width: dims.width, height: dims.height });
      // Initialize the gizmo at the image center, sized to ~10% of the
      // shorter image edge — a sensible default a GM can refine.
      const initialSize = Math.max(20, Math.round(Math.min(dims.width, dims.height) * 0.1));
      setGizmo({
        centerX: dims.width / 2,
        centerY: dims.height / 2,
        sizePx: initialSize,
      });
      setUploadStatus('ready');
    } catch {
      setUploadStatus('error');
      setUploadError('Upload failed. Please try again.');
    }
  }, []);

  const handleDrop = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f) handleFileSelect(f);
    },
    [handleFileSelect]
  );

  const canAdvanceToStep2 = step === 1 && name.trim().length > 0 && uploadStatus === 'ready';

  const handleNext = () => {
    if (!canAdvanceToStep2) return;
    setStep(2);
  };

  const handleSave = async () => {
    if (!upload || !name.trim()) return;
    setIsSaving(true);
    try {
      // Create the map first (locks in image + name), then write the scale.
      let mapId = createdMapId;
      if (!mapId) {
        const created = await createMap.mutateAsync({
          name: name.trim(),
          imageKey: upload.imageKey,
          imageUrl: upload.imageUrl,
          imageWidth: upload.width,
          imageHeight: upload.height,
          locationId: locationId || null,
        });
        mapId = created.id;
        setCreatedMapId(mapId);
      }
      await updateMapScale.mutateAsync({
        id: mapId,
        gridType,
        pixelsPerSquare: Math.max(1, Math.round(gizmo.sizePx)),
      });
      onClose();
    } catch {
      // mutation onError surfaces to PostHog; surface a generic banner.
      setUploadError('Saving failed. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    // Backdrop is intentionally NOT click-to-dismiss. A drag that begins
    // inside the scale gizmo and releases on the backdrop would otherwise
    // close the modal mid-edit. The header X, footer Cancel, and Esc are
    // the supported dismiss paths.
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-upload-title"
        className="flex h-full max-h-[90vh] w-full max-w-[900px] flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0D1117] shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <h2
              id="map-upload-title"
              className="font-sans text-sm font-bold uppercase tracking-widest text-blue-400"
            >
              Upload Map
            </h2>
            <StepIndicator step={step} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-500 transition-colors hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {step === 1 ? (
            <Step1
              name={name}
              onNameChange={setName}
              locationId={locationId}
              onLocationChange={setLocationId}
              locations={locations}
              previewUrl={previewUrl}
              uploadStatus={uploadStatus}
              uploadError={uploadError}
              fileInputRef={fileInputRef}
              onFileChosen={handleFileSelect}
              onDrop={handleDrop}
            />
          ) : (
            upload && (
              <Step2
                imageUrl={upload.imageUrl}
                imageWidth={upload.width}
                imageHeight={upload.height}
                gridType={gridType}
                onGridTypeChange={setGridType}
                gizmo={gizmo}
                onGizmoChange={setGizmo}
                error={uploadError}
              />
            )
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-white/[0.07] px-4 py-3 sm:px-6">
          <div>
            {step === 2 && (
              <PixelButton type="button" variant="secondary" onClick={() => setStep(1)}>
                Back
              </PixelButton>
            )}
          </div>
          <div className="flex items-center gap-2">
            <PixelButton type="button" variant="secondary" onClick={onClose}>
              Cancel
            </PixelButton>
            {step === 1 ? (
              <PixelButton
                type="button"
                variant="primary"
                disabled={!canAdvanceToStep2}
                onClick={handleNext}
              >
                Next
              </PixelButton>
            ) : (
              <PixelButton
                type="button"
                variant="primary"
                disabled={isSaving || !upload}
                onClick={handleSave}
              >
                {isSaving ? 'Saving…' : 'Save'}
              </PixelButton>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Step content
// ---------------------------------------------------------------------------

interface Step1Props {
  name: string;
  onNameChange: (v: string) => void;
  locationId: string;
  onLocationChange: (v: string) => void;
  locations: Array<{ id: string; name: string }>;
  previewUrl: string | null;
  uploadStatus: UploadStatus;
  uploadError: string | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileChosen: (file: File) => void;
  onDrop: (e: ReactDragEvent<HTMLDivElement>) => void;
}

function Step1({
  name,
  onNameChange,
  locationId,
  onLocationChange,
  locations,
  previewUrl,
  uploadStatus,
  uploadError,
  fileInputRef,
  onFileChosen,
  onDrop,
}: Step1Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-3">
        <FormInput
          label="Map Name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Forest Path"
          required
        />
        <div>
          <label
            htmlFor="map-location"
            className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-400"
          >
            Tie to Location (optional)
          </label>
          <select
            id="map-location"
            value={locationId}
            onChange={(e) => onLocationChange(e.target.value)}
            className="w-full rounded border border-white/[0.07] bg-[#080A12] px-2 py-2 font-sans text-xs text-slate-200 outline-none focus:border-blue-500/50"
          >
            <option value="">— None —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span
          id="map-upload-dropzone-label"
          className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-400"
        >
          Image of Your Map
        </span>
        <div
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          aria-labelledby="map-upload-dropzone-label"
          className="relative flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden rounded border border-dashed border-white/20 bg-black/40 transition-colors hover:border-white/40 focus:border-blue-500/60 focus:outline-none"
          data-testid="map-upload-dropzone"
        >
          {previewUrl ? (
            <img src={previewUrl} alt="" className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-slate-500">
              <Upload className="h-6 w-6" />
              <p className="font-sans text-xs">Drag &amp; drop, or click to select</p>
              <p className="font-sans text-[10px] text-slate-600">
                PNG, JPEG, GIF, WebP · 25 MB max
              </p>
            </div>
          )}

          {uploadStatus === 'uploading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="flex items-center gap-2 font-sans text-xs text-slate-200">
                <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
              </div>
            </div>
          )}
          {uploadStatus === 'ready' && (
            <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-emerald-500/80 px-2 py-0.5 font-sans text-[10px] font-semibold text-white">
              <Check className="h-3 w-3" /> Ready
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFileChosen(f);
            e.target.value = '';
          }}
        />
        {uploadError && <p className="mt-1 font-sans text-[11px] text-rose-400">{uploadError}</p>}
      </div>
    </div>
  );
}

interface Step2Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  gridType: GridType;
  onGridTypeChange: (g: GridType) => void;
  gizmo: { centerX: number; centerY: number; sizePx: number };
  onGizmoChange: (g: { centerX: number; centerY: number; sizePx: number }) => void;
  error: string | null;
}

function Step2({
  imageUrl,
  imageWidth,
  imageHeight,
  gridType,
  onGridTypeChange,
  gizmo,
  onGizmoChange,
  error,
}: Step2Props) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-slate-200">
          Speed / View Scale
        </h3>
        <p className="font-sans mt-1 text-[11px] text-slate-500">
          Drag the white shape over a feature on the map whose size you know (a doorway, a tile).
          Resize so its diameter equals one grid square (5 ft).
        </p>
      </div>

      <fieldset className="flex items-center gap-3">
        <legend className="sr-only">Grid Type</legend>
        {(['square', 'gridless'] as const).map((t) => (
          <label
            key={t}
            className="flex cursor-pointer items-center gap-1.5 font-sans text-[11px] text-slate-300"
          >
            <input
              type="radio"
              name="grid-type"
              value={t}
              checked={gridType === t}
              onChange={() => onGridTypeChange(t)}
            />
            {t === 'square' ? 'Square grid' : 'No grid'}
          </label>
        ))}
      </fieldset>

      <div className="min-h-0 flex-1 overflow-hidden rounded border border-white/[0.07]">
        <MapScaleGizmo
          imageUrl={imageUrl}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          gridType={gridType}
          feetPerSquare={5}
          value={gizmo}
          onChange={onGizmoChange}
        />
      </div>

      {error && <p className="font-sans text-[11px] text-rose-400">{error}</p>}
    </div>
  );
}

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
      <span className={step >= 1 ? 'text-orange-300' : 'text-slate-500'}>1 · Map</span>
      <span className="text-slate-700">→</span>
      <span className={step >= 2 ? 'text-orange-300' : 'text-slate-500'}>2 · Scale</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function probeImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      URL.revokeObjectURL(url);
      if (w > 0 && h > 0) resolve({ width: w, height: h });
      else resolve(null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
