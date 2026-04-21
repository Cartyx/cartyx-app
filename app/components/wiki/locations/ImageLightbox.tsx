import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ImageLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  title: string;
}

export function ImageLightbox({ isOpen, onClose, imageUrl, title }: ImageLightboxProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors"
        aria-label="Close fullscreen view"
      >
        <X className="h-6 w-6" />
      </button>

      <div className="relative max-w-[95vw] max-h-[95vh] flex items-center justify-center">
        <img
          src={imageUrl}
          alt={title}
          className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg"
        />
        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-4 py-3 rounded-b-lg">
          <p className="text-sm font-semibold text-white text-center">{title}</p>
        </div>
      </div>
    </div>,
    document.body
  );
}
