import { useEffect, useRef, useState } from 'react';
import { Pencil, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SpellData } from '~/types/spell';
import { MARKDOWN_PROSE_CLASSES } from '~/utils/markdownProseClasses';
import { formatSpellLevel, formatSchool } from '~/constants/spells';
import {
  formatCastingTime,
  formatRange,
  formatDuration,
  formatComponents,
  formatAttackSave,
  formatDamageEffect,
} from './spellFormat';
import { scaledDice, rollSpellModifier, type SpellRollOutcome } from './spellDice';
import { requestChatBroadcast, onChatDelivery } from '~/utils/chatBridge';

/** Plain-text spell summary for chat (chat renders plain text, not markdown). */
function spellToChatText(spell: SpellData): string {
  const header = `🔮 ${spell.name} — ${formatSpellLevel(spell.level)} ${formatSchool(spell.school)}${
    spell.ritual ? ' (ritual)' : ''
  }`;
  const stats = `Casting: ${formatCastingTime(spell.castingTime)} · Range: ${formatRange(
    spell.range
  )} · Components: ${formatComponents(spell.components)} · Duration: ${formatDuration(
    spell.duration
  )}`;
  const desc = spell.description
    .replace(/\*\*/g, '')
    .replace(/(^|[\s(])_([^_]+)_/g, '$1$2')
    .replace(/^#+\s*/gm, '')
    .trim();
  return `${header}\n${stats}\n\n${desc}`;
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-sans font-bold uppercase tracking-widest text-slate-500">
        {label}
      </div>
      <div className="text-xs font-semibold text-slate-200 truncate">{value}</div>
    </div>
  );
}

interface SpellWindowProps {
  spell: SpellData;
  onEdit?: () => void;
}

export function SpellWindow({ spell, onEdit }: SpellWindowProps) {
  const rollable = spell.modifiers.filter((m) => m.dice);
  const scaling = spell.higherLevelScaling;
  const [castLevel, setCastLevel] = useState(scaling.type === 'character-level' ? 1 : spell.level);
  const [crit, setCrit] = useState(false);
  const [lastRoll, setLastRoll] = useState<SpellRollOutcome | null>(null);
  const [shareStatus, setShareStatus] = useState<'idle' | 'shared' | 'no-session'>('idle');
  const pendingShareId = useRef<string | null>(null);

  useEffect(() => {
    return onChatDelivery(({ requestId, delivered }) => {
      if (requestId !== pendingShareId.current) return;
      pendingShareId.current = null;
      setShareStatus(delivered ? 'shared' : 'no-session');
      setTimeout(() => setShareStatus('idle'), 3000);
    });
  }, []);

  const handleShare = () => {
    const requestId = crypto.randomUUID();
    pendingShareId.current = requestId;
    requestChatBroadcast({ requestId, text: spellToChatText(spell), channel: 'general' });
  };

  const levelOptions =
    scaling.type === 'character-level'
      ? Array.from({ length: 20 }, (_, i) => i + 1)
      : Array.from({ length: 10 - spell.level }, (_, i) => spell.level + i);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 px-4 pt-3 shrink-0">
        <div>
          <h3 className="text-base font-bold text-slate-100">{spell.name}</h3>
          <p className="text-[11px] italic text-slate-500">
            {formatSpellLevel(spell.level)} · {formatSchool(spell.school)}
            {spell.ritual ? ' (ritual)' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {shareStatus !== 'idle' && (
            <span
              className={`text-[10px] font-semibold ${
                shareStatus === 'shared' ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {shareStatus === 'shared' ? 'Shared to chat' : 'No active session'}
            </span>
          )}
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors text-xs font-bold shadow-sm shadow-blue-500/30"
            aria-label="Share spell in chat"
          >
            <Send className="h-4 w-4" /> Share in Chat
          </button>
          {spell.canEdit && onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="p-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white transition-colors"
              aria-label="Edit spell"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 px-4 py-3 mt-2 border-y border-white/[0.05] shrink-0">
        <Cell label="Level" value={formatSpellLevel(spell.level)} />
        <Cell label="Casting Time" value={formatCastingTime(spell.castingTime)} />
        <Cell label="Range/Area" value={formatRange(spell.range)} />
        <Cell label="Components" value={formatComponents(spell.components)} />
        <Cell label="Duration" value={formatDuration(spell.duration)} />
        <Cell label="School" value={formatSchool(spell.school)} />
        <Cell label="Attack/Save" value={formatAttackSave(spell.attackSave)} />
        <Cell label="Damage/Effect" value={formatDamageEffect(spell)} />
      </div>

      {rollable.length > 0 && (
        <div className="px-4 py-3 border-b border-white/[0.05] shrink-0 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            {scaling.enabled && (
              <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                {scaling.type === 'character-level' ? 'Character level' : 'Slot level'}
                <select
                  value={castLevel}
                  onChange={(e) => setCastLevel(Number(e.target.value))}
                  className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
                >
                  {levelOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
              <input
                type="checkbox"
                checked={crit}
                onChange={(e) => setCrit(e.target.checked)}
                className="h-3.5 w-3.5 accent-blue-600"
              />
              Crit
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {rollable.map((m) => {
              const dice = scaledDice(m, spell, castLevel);
              if (!dice) return null;
              const label = `${crit ? dice.count * 2 : dice.count}d${dice.sides}${
                m.damageType ? ` ${m.damageType}` : m.type === 'healing' ? ' healing' : ''
              }`;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    const outcome = rollSpellModifier({ spell, modifier: m, castLevel, crit });
                    if (outcome) setLastRoll(outcome);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-semibold hover:bg-blue-500/20 transition-colors"
                  data-testid={`roll-${m.id}`}
                >
                  <span aria-hidden>⚄</span> {label}
                </button>
              );
            })}
          </div>
          {lastRoll && (
            <div
              data-testid="spell-roll-result"
              className="flex items-baseline gap-2 rounded-lg bg-white/[0.04] border border-white/[0.07] px-3 py-2"
            >
              <span className="text-[11px] font-semibold text-slate-400">{lastRoll.title}</span>
              <span className="text-[11px] text-slate-500">{lastRoll.formula}</span>
              <span className="ml-auto text-lg font-bold text-blue-300 tabular-nums">
                {lastRoll.total}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {spell.components.material && spell.components.materialDescription && (
          <p className="text-[11px] text-slate-500 mb-3">
            <span className="font-semibold">Material:</span> {spell.components.materialDescription}
          </p>
        )}
        <div className={MARKDOWN_PROSE_CLASSES}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{spell.description}</ReactMarkdown>
        </div>

        {spell.higherLevels.length > 0 && (
          <div className="mt-4 border-t border-white/[0.05] pt-3">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">
              At Higher Levels
            </div>
            {spell.higherLevels.map((h) => (
              <p key={h.id} className="text-xs text-slate-300 mb-1">
                <span className="font-semibold">Level {h.level}:</span> {h.description}
              </p>
            ))}
          </div>
        )}

        {spell.classes.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1">
            {spell.classes.map((c) => (
              <span
                key={c}
                className="inline-flex items-center px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.07] text-slate-300 text-[10px] font-semibold"
              >
                {c}
              </span>
            ))}
          </div>
        )}

        {spell.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {spell.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-sans font-bold text-[9px] tracking-tight"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {spell.source === 'srd' && (
          <p className="mt-4 text-[10px] text-slate-600 italic">
            Content from the SRD 5.2.1, © Wizards of the Coast, licensed under CC-BY-4.0. See
            Settings → SRD Licensing.
          </p>
        )}
      </div>
    </div>
  );
}
