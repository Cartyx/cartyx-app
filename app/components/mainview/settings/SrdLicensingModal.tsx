import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { SRD_ATTRIBUTION, SRD_LICENSE_URL, SRD_SOURCE_URL } from '~/constants/srd';

interface SrdLicensingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SrdLicensingModal({ isOpen, onClose }: SrdLicensingModalProps) {
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="srd-licensing-title"
        className="w-full max-w-lg max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="srd-licensing-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            SRD Licensing
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
          <p className="text-xs text-slate-400 leading-relaxed">
            Cartyx includes Dungeons &amp; Dragons content from the System Reference Document 5.2.1
            under the Creative Commons Attribution 4.0 International License. Required attribution:
          </p>
          <blockquote className="text-xs text-slate-300 leading-relaxed border-l-2 border-blue-500/40 pl-3 italic">
            {SRD_ATTRIBUTION}
          </blockquote>
          <div className="flex flex-col gap-2 pt-2">
            <a
              href={SRD_SOURCE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs font-semibold text-blue-400 hover:text-blue-300"
            >
              Official SRD 5.2.1 →
            </a>
            <a
              href={SRD_LICENSE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs font-semibold text-blue-400 hover:text-blue-300"
            >
              CC-BY-4.0 License →
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
