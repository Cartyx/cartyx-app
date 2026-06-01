import { useEffect, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import { CleanUpPanel } from './CleanUpPanel';

interface GameSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
}

type SettingsOptionId = 'clean-up';

interface SettingsOption {
  id: SettingsOptionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const OPTIONS: SettingsOption[] = [{ id: 'clean-up', label: 'Clean Up', icon: Trash2 }];

export function GameSettingsModal({ isOpen, onClose, campaignId }: GameSettingsModalProps) {
  const [activeOption, setActiveOption] = useState<SettingsOptionId>('clean-up');

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
        aria-labelledby="game-settings-modal-title"
        className="w-full h-full max-w-[90vw] max-h-[90vh] sm:max-w-[80vw] sm:max-h-[80vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="game-settings-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            Game Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors"
            aria-label="Close Game Settings"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex flex-1 min-h-0">
          {/* Option sidebar */}
          <nav
            className="w-48 shrink-0 border-r border-white/[0.07] bg-[#080A12] overflow-y-auto"
            aria-label="Game Settings options"
          >
            <ul role="tablist" aria-orientation="vertical" className="flex flex-col">
              {OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isActive = opt.id === activeOption;
                return (
                  <li key={opt.id}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`game-settings-panel-${opt.id}`}
                      id={`game-settings-tab-${opt.id}`}
                      onClick={() => setActiveOption(opt.id)}
                      className={[
                        'flex w-full items-center gap-2 px-4 py-3 text-left text-xs font-sans font-semibold transition-colors border-l-2',
                        isActive
                          ? 'bg-white/[0.04] text-blue-400 border-blue-400'
                          : 'text-slate-400 border-transparent hover:bg-white/[0.03] hover:text-slate-200',
                      ].join(' ')}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      {opt.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Active option content */}
          <div
            id={`game-settings-panel-${activeOption}`}
            role="tabpanel"
            aria-labelledby={`game-settings-tab-${activeOption}`}
            className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0"
          >
            {activeOption === 'clean-up' && <CleanUpPanel campaignId={campaignId} />}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
