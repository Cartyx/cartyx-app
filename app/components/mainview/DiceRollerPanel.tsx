import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import {
  DIE_SIDES_DESC,
  MODIFIER_MAX,
  MODIFIER_MIN,
  rollDice,
  toParsedDiceRoll,
  type DieSides,
  type RollMode,
} from '~/utils/dice';
import { onDiceDelivery, requestDiceBroadcast } from '~/utils/diceRollerBridge';
import { DiceRollCard } from './DicePanel';
import type { DiceRollMessage } from '~/hooks/useDiceRolls';

const MODES: { id: RollMode; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'advantage', label: 'Adv' },
  { id: 'disadvantage', label: 'Dis' },
];

export function DiceRollerPanel() {
  const [counts, setCounts] = useState<Partial<Record<DieSides, number>>>({});
  const [modifier, setModifier] = useState(0);
  const [mode, setMode] = useState<RollMode>('normal');
  const [isPublic, setIsPublic] = useState(true);
  const [lastRoll, setLastRoll] = useState<DiceRollMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingRequestId = useRef<string | null>(null);

  useEffect(
    () =>
      onDiceDelivery(({ requestId, delivered }) => {
        if (requestId !== pendingRequestId.current) return;
        pendingRequestId.current = null;
        if (!delivered) {
          setNotice("Couldn't broadcast — not connected. The roll stayed on your screen.");
        }
      }),
    []
  );

  const pool = DIE_SIDES_DESC.filter((s) => (counts[s] ?? 0) > 0).map((s) => ({
    sides: s,
    count: counts[s]!,
  }));

  const addDie = (sides: DieSides) =>
    setCounts((c) => ({ ...c, [sides]: Math.min((c[sides] ?? 0) + 1, 99) }));
  const removeDie = (sides: DieSides) =>
    setCounts((c) => ({ ...c, [sides]: Math.max((c[sides] ?? 0) - 1, 0) }));

  function handleRoll() {
    if (pool.length === 0) return;
    setNotice(null);
    const result = rollDice({ pool, mode, modifier });
    const parsed = toParsedDiceRoll(result);
    setLastRoll({
      ...parsed,
      id: crypto.randomUUID(),
      seq: 0,
      sessionId: '',
      campaignId: '',
      character: 'You',
      timestamp: Date.now(),
    });
    if (isPublic) {
      const requestId = crypto.randomUUID();
      pendingRequestId.current = requestId;
      requestDiceBroadcast({ requestId, roll: parsed });
    }
  }

  return (
    <div
      data-testid="dice-roller-panel"
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto bg-[#0D1117] p-3"
    >
      {/* Dice grid */}
      <div className="grid grid-cols-4 gap-2">
        {DIE_SIDES_DESC.map((sides) => {
          const count = counts[sides] ?? 0;
          return (
            <div key={sides} className="relative">
              <button
                type="button"
                data-testid={`dice-roller-die-${sides}`}
                aria-label={`Add d${sides}`}
                onClick={() => addDie(sides)}
                className={[
                  'flex h-12 w-full items-center justify-center rounded border font-mono text-sm transition-colors',
                  count > 0
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-300'
                    : 'border-white/[0.07] bg-[#080A12] text-slate-300 hover:bg-white/5',
                ].join(' ')}
              >
                d{sides}
              </button>
              {count > 0 && (
                <button
                  type="button"
                  data-testid={`dice-roller-count-${sides}`}
                  aria-label={`Remove one d${sides} (${count} queued)`}
                  onClick={() => removeDie(sides)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 font-mono text-[10px] font-bold text-white hover:bg-red-600"
                >
                  {count}
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          data-testid="dice-roller-reset"
          aria-label="Reset dice pool"
          onClick={() => setCounts({})}
          className="flex h-12 w-full items-center justify-center gap-1 rounded border border-white/[0.07] bg-[#080A12] font-sans text-[11px] text-slate-400 hover:bg-white/5"
        >
          <RotateCcw size={12} />
          Reset
        </button>
      </div>

      {/* Modifier stepper */}
      <div className="flex items-center justify-between rounded border border-white/[0.07] bg-[#080A12] px-3 py-2">
        <span className="font-sans text-[11px] text-slate-500">Modifier</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="dice-roller-modifier-dec"
            aria-label="Decrease modifier"
            onClick={() => setModifier((m) => Math.max(m - 1, MODIFIER_MIN))}
            className="flex h-6 w-6 items-center justify-center rounded bg-white/5 text-slate-300 hover:bg-white/10"
          >
            <Minus size={12} />
          </button>
          <span
            data-testid="dice-roller-modifier-value"
            className="w-10 text-center font-mono text-sm text-white"
          >
            {modifier > 0 ? `+${modifier}` : modifier}
          </span>
          <button
            type="button"
            data-testid="dice-roller-modifier-inc"
            aria-label="Increase modifier"
            onClick={() => setModifier((m) => Math.min(m + 1, MODIFIER_MAX))}
            className="flex h-6 w-6 items-center justify-center rounded bg-white/5 text-slate-300 hover:bg-white/10"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Roll mode */}
      <div
        role="group"
        aria-label="Roll mode"
        className="flex rounded border border-white/[0.07] bg-[#080A12] p-0.5"
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            data-testid={`dice-roller-mode-${m.id}`}
            aria-pressed={mode === m.id}
            onClick={() => setMode(m.id)}
            className={[
              'flex-1 rounded px-2 py-1.5 font-sans text-[11px] transition-colors',
              mode === m.id ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300',
            ].join(' ')}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Privacy */}
      <div
        role="group"
        aria-label="Roll visibility"
        className="flex rounded border border-white/[0.07] bg-[#080A12] p-0.5"
      >
        <button
          type="button"
          data-testid="dice-roller-privacy-public"
          aria-pressed={isPublic}
          onClick={() => setIsPublic(true)}
          className={[
            'flex-1 rounded px-2 py-1.5 font-sans text-[11px] transition-colors',
            isPublic ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300',
          ].join(' ')}
        >
          Public
        </button>
        <button
          type="button"
          data-testid="dice-roller-privacy-private"
          aria-pressed={!isPublic}
          onClick={() => setIsPublic(false)}
          className={[
            'flex-1 rounded px-2 py-1.5 font-sans text-[11px] transition-colors',
            !isPublic ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300',
          ].join(' ')}
        >
          Private
        </button>
      </div>

      {/* Roll */}
      <button
        type="button"
        data-testid="dice-roller-roll"
        disabled={pool.length === 0}
        onClick={handleRoll}
        className="rounded bg-[#2563EB] px-3 py-2 font-sans text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600"
      >
        Roll{pool.length > 0 ? ` ${pool.map((p) => `${p.count}d${p.sides}`).join(' + ')}` : ''}
      </button>

      {/* Delivery notice */}
      {notice && (
        <div
          data-testid="dice-roller-notice"
          className="rounded border border-amber-800/30 bg-amber-900/20 px-3 py-2 font-sans text-[11px] text-amber-300"
        >
          {notice}
        </div>
      )}

      {/* Last result */}
      {lastRoll && (
        <div data-testid="dice-roller-result">
          <DiceRollCard roll={lastRoll} />
        </div>
      )}
    </div>
  );
}
