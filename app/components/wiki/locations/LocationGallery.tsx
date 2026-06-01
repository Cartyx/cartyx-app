import { useState } from 'react';
import type { LocationImage } from '~/types/location';
import { ImageLightbox } from './ImageLightbox';

interface LocationGalleryProps {
  images: LocationImage[];
}

export function LocationGallery({ images }: LocationGalleryProps) {
  const [lightboxImage, setLightboxImage] = useState<LocationImage | null>(null);

  if (images.length === 0) {
    return <p className="text-xs text-slate-600 italic">No images yet.</p>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {images.map((img) => (
          <button
            key={img.imageKey}
            type="button"
            onClick={() => setLightboxImage(img)}
            className="relative aspect-square overflow-hidden rounded-lg group cursor-pointer border border-white/[0.07]"
          >
            <img
              src={img.url}
              alt={img.title}
              className="w-full h-full object-cover transition-opacity group-hover:opacity-80"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-1">
              <p className="text-[10px] text-white font-semibold truncate text-center">
                {img.title}
              </p>
            </div>
          </button>
        ))}
      </div>

      {lightboxImage && (
        <ImageLightbox
          isOpen={!!lightboxImage}
          onClose={() => setLightboxImage(null)}
          imageUrl={lightboxImage.url}
          title={lightboxImage.title}
        />
      )}
    </>
  );
}
