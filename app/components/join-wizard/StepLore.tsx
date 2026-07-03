import { PixelButton } from '~/components/PixelButton';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import { SectionHeader } from '~/components/SectionHeader';
import { BookOpen, Plus, Trash2, Globe, Lock } from 'lucide-react';
import type { WizardLore } from './JoinWizard';

interface StepLoreProps {
  lore: WizardLore[];
  onUpdate: (lore: WizardLore[]) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepLore({ lore, onUpdate, onNext, onBack }: StepLoreProps) {
  function addEntry() {
    onUpdate([...lore, { title: '', content: '', isPublic: false }]);
  }

  function removeEntry(index: number) {
    onUpdate(lore.filter((_, i) => i !== index));
  }

  function updateEntry(index: number, patch: Partial<WizardLore>) {
    onUpdate(lore.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }

  return (
    <div className="bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden">
      <div className="p-8 pb-6 space-y-5">
        <SectionHeader size="xs" tracking="tracking-[3px]" className="mb-7">
          LORE ENTRIES
        </SectionHeader>

        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-xl">
          <BookOpen className="h-5 w-5 text-indigo-400 mt-0.5 shrink-0" />
          <p className="text-xs text-indigo-300/80 leading-relaxed">
            Add lore entries about your character — legends, secrets, journal entries, or world
            knowledge. Mark entries public to share them with other players.
          </p>
        </div>

        {/* Lore entry list */}
        {lore.length > 0 && (
          <div className="space-y-4">
            {lore.map((entry, index) => (
              <div
                key={index}
                data-testid={`lore-entry-${index}`}
                className="border border-white/[0.07] rounded-xl overflow-hidden"
              >
                <div className="p-4 space-y-3 bg-white/[0.02]">
                  {/* Title row */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={entry.title}
                      onChange={(e) => updateEntry(index, { title: e.target.value })}
                      placeholder="Entry title..."
                      data-testid={`lore-title-${index}`}
                      className="flex-1 bg-transparent border border-white/[0.1] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-white/30 transition-colors"
                    />
                    {/* Public/private toggle */}
                    <button
                      type="button"
                      onClick={() => updateEntry(index, { isPublic: !entry.isPublic })}
                      data-testid={`lore-visibility-${index}`}
                      title={
                        entry.isPublic
                          ? 'Public — visible to all players'
                          : 'Private — only you and the GM'
                      }
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        entry.isPublic
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                          : 'bg-white/[0.03] border-white/[0.1] text-slate-500 hover:text-slate-400'
                      }`}
                    >
                      {entry.isPublic ? (
                        <>
                          <Globe className="h-3 w-3" />
                          Public
                        </>
                      ) : (
                        <>
                          <Lock className="h-3 w-3" />
                          Private
                        </>
                      )}
                    </button>
                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => removeEntry(index)}
                      data-testid={`lore-remove-${index}`}
                      title="Remove entry"
                      className="p-1.5 text-slate-600 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Content */}
                  <MarkdownEditor
                    label=""
                    value={entry.content}
                    onChange={(content) => updateEntry(index, { content })}
                    placeholder="Write the lore entry content here..."
                    minHeight="120px"
                    id={`lore-content-${index}`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add button */}
        <button
          type="button"
          onClick={addEntry}
          data-testid="lore-add-entry"
          className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors font-medium py-1"
        >
          <Plus className="h-4 w-4" />
          Add lore entry
        </button>

        {lore.length === 0 && (
          <button
            type="button"
            onClick={onNext}
            className="text-xs text-slate-500 hover:text-slate-400 transition-colors font-medium"
          >
            Skip for now &rarr;
          </button>
        )}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between px-8 py-5 border-t border-white/[0.06]">
        <PixelButton variant="secondary" size="sm" onClick={onBack} type="button">
          &larr; Back
        </PixelButton>
        <PixelButton variant="primary" size="sm" onClick={onNext} type="button">
          Next: Review &rarr;
        </PixelButton>
      </div>
    </div>
  );
}
