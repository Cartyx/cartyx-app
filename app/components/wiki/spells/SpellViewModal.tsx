import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { SpellWindow } from './SpellWindow';
import { useSpell } from '~/hooks/useSpells';

interface SpellViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  spellId: string;
  campaignId: string;
}

export function SpellViewModal({ isOpen, onClose, spellId, campaignId }: SpellViewModalProps) {
  const { spell, isLoading } = useSpell(spellId, campaignId);

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
        aria-labelledby="spell-view-modal-title"
        className="w-full max-w-2xl max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="spell-view-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest truncate"
          >
            {spell?.name ?? 'Spell'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500 animate-pulse">Loading spell...</p>
            </div>
          ) : spell ? (
            <SpellWindow spell={spell} />
          ) : (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500">Spell not found</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
