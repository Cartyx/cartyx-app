import React, { useState, useRef } from 'react';
import { Upload, X, ImageIcon } from 'lucide-react';
import { PixelButton } from '~/components/PixelButton';
import { useAddLocationImage, useDeleteLocationImage } from '~/hooks/useLocations';
import { compressImage } from '~/utils/compressImage';
import { uploadToR2 } from '~/utils/uploadToR2';
import type { LocationImage } from '~/types/location';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface LocationImageUploadProps {
  locationId: string;
  campaignId: string;
  images: LocationImage[];
  disabled?: boolean;
}

export function LocationImageUpload({
  locationId,
  campaignId,
  images,
  disabled,
}: LocationImageUploadProps) {
  const { addImage, isLoading: isAdding } = useAddLocationImage();
  const { deleteImage, isLoading: isDeleting } = useDeleteLocationImage();

  const [title, setTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Only JPEG, PNG, and WebP images are allowed');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Image must be under 5MB');
      return;
    }
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !title.trim()) return;
    setError(null);
    setIsUploading(true);

    try {
      const compressed = await compressImage(selectedFile);
      const { imageKey, publicUrl } = await uploadToR2(compressed, 'uploads/locations');
      const result = await addImage({
        id: locationId,
        campaignId,
        imageKey,
        url: publicUrl,
        title: title.trim(),
      });

      if (result) {
        setTitle('');
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        setError('Failed to save image. Please try again.');
      }
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (imageKey: string) => {
    setError(null);
    const result = await deleteImage({ id: locationId, campaignId, imageKey });
    if (!result) {
      setError('Failed to remove image.');
    }
    setConfirmDeleteKey(null);
  };

  const isBusy = disabled || isUploading || isAdding;

  return (
    <div className="space-y-3">
      {error && <p className="text-[10px] text-rose-400 font-semibold">{error}</p>}

      {/* Upload controls */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            className="flex items-center gap-1.5 px-3 py-2 rounded bg-white/[0.03] border border-white/[0.07] text-xs text-slate-300 hover:bg-white/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {selectedFile ? selectedFile.name : 'Choose image...'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Image title (required)"
          disabled={isBusy}
          className="w-full bg-[#080A12] border border-white/[0.07] rounded px-3 py-2 font-sans font-semibold text-xs text-white outline-none focus:border-blue-500/50 transition-colors placeholder:text-slate-600"
        />

        <PixelButton
          variant="primary"
          size="sm"
          onClick={handleUpload}
          disabled={isBusy || !selectedFile || !title.trim()}
          type="button"
        >
          <span className="flex items-center gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            {isUploading ? 'Uploading...' : 'Upload Image'}
          </span>
        </PixelButton>
      </div>

      {/* Existing images */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img) => (
            <div
              key={img.imageKey}
              className="relative group rounded-lg overflow-hidden border border-white/[0.07]"
            >
              <img src={img.url} alt={img.title} className="w-full aspect-square object-cover" />
              <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-0.5">
                <p className="text-[9px] text-white font-semibold truncate text-center">
                  {img.title}
                </p>
              </div>

              {confirmDeleteKey === img.imageKey ? (
                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-1.5 p-2">
                  <p className="text-[10px] text-rose-400 font-semibold text-center">Remove?</p>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleDelete(img.imageKey)}
                      disabled={isDeleting}
                      className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-semibold hover:bg-rose-500 disabled:opacity-40"
                    >
                      {isDeleting ? '...' : 'Yes'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteKey(null)}
                      disabled={isDeleting}
                      className="px-2 py-0.5 rounded bg-white/10 text-slate-300 text-[10px] font-semibold hover:bg-white/20"
                    >
                      No
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteKey(img.imageKey)}
                  disabled={disabled}
                  className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded-full bg-black/60 text-white/60 hover:text-rose-400 hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100"
                  aria-label={`Remove ${img.title}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
