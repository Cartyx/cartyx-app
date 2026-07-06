import React, { useEffect, useRef } from 'react';
import { Dice5, ExternalLink } from 'lucide-react';
import type { DiceRollMessage } from '~/hooks/useDiceRolls';

function getDamageLabels(flags: number): string[] {
  const labels: string[] = [];
  if (flags & 2) labels.push('Versatile');
  if (flags & 4) labels.push('Additional');
  if (flags & 8) labels.push('Healing');
  if (flags & 16) labels.push('Critical');
  if (flags & 32) labels.push('Conditional');
  return labels;
}

function RollBreakdown({
  attackRolls,
  damageRolls,
  rollInfo,
  variant = 'beyond20',
}: {
  attackRolls: DiceRollMessage['attackRolls'];
  damageRolls: DiceRollMessage['damageRolls'];
  rollInfo: DiceRollMessage['rollInfo'];
  variant?: 'beyond20' | 'custom';
}) {
  return (
    <div className="mt-2 space-y-1.5">
      {rollInfo.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {rollInfo.map(([label, value], i) => (
            <span
              key={i}
              className="rounded bg-white/[0.05] px-2 py-0.5 font-sans text-[10px] text-slate-400"
            >
              {label}: {value}
            </span>
          ))}
        </div>
      )}

      {attackRolls.map((roll, i) => {
        const dice = roll.dice ?? [];
        const diceSum = dice.reduce((a, b) => a + b, 0);
        const bonus = dice.length > 0 ? roll.total - diceSum : 0;
        const formula = roll.formula ?? '';
        const isDiscarded = roll.discarded ?? false;
        return (
          <div key={i} className="space-y-0.5">
            <div
              className={`flex items-baseline gap-2 flex-wrap ${isDiscarded ? 'opacity-40' : ''}`}
            >
              <span
                className={`rounded bg-[#0D1117] px-2 py-1 font-mono text-sm font-bold ${isDiscarded ? 'line-through' : ''}`}
                style={{
                  color: isDiscarded
                    ? '#64748b'
                    : roll.type === 'crit'
                      ? '#ffd740'
                      : roll.type === 'crit-fail'
                        ? '#ef5350'
                        : roll.type === 'miss'
                          ? '#ef5350'
                          : '#69f0ae',
                }}
              >
                {roll.total}
              </span>
              <span className="font-sans text-[11px] text-slate-500">
                {variant === 'custom' ? 'Result' : 'To Hit'}
                {isDiscarded ? ' (dropped)' : ''}
              </span>
              {formula && <span className="font-mono text-[11px] text-slate-400">{formula}</span>}
              {!isDiscarded && roll.type === 'crit' && (
                <span className="font-sans text-[10px] font-bold text-yellow-400">CRIT!</span>
              )}
              {!isDiscarded && roll.type === 'crit-fail' && (
                <span className="font-sans text-[10px] font-bold text-red-400">NAT 1</span>
              )}
            </div>
            {dice.length > 0 && !isDiscarded && (
              <div className="pl-2 font-mono text-[10px] text-slate-500">
                ({variant === 'custom' ? dice.join(' + ') : dice[0]})
                {bonus !== 0 && ` ${bonus > 0 ? '+' : '-'} ${Math.abs(bonus)}`} = {roll.total}
              </div>
            )}
          </div>
        );
      })}

      {damageRolls.map((roll, i) => {
        const flagLabels = roll.flags > 1 ? getDamageLabels(roll.flags) : [];
        const flagLabel = flagLabels.length > 0 ? flagLabels.join(', ') : null;
        const dice = roll.dice ?? [];
        const diceSum = dice.reduce((a, b) => a + b, 0);
        const bonus = dice.length > 0 ? roll.total - diceSum : 0;
        return (
          <div key={i} className="space-y-0.5">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="rounded bg-[#0D1117] px-2 py-1 font-mono text-sm font-bold text-orange-300">
                {roll.total}
              </span>
              <span className="font-sans text-[11px] text-slate-500">
                {roll.damageType}
                {flagLabel && ` (${flagLabel})`}
              </span>
              {roll.formula && (
                <span className="font-mono text-[11px] text-slate-400">{roll.formula}</span>
              )}
            </div>
            {dice.length > 0 && (
              <div className="pl-2 font-mono text-[10px] text-slate-500">
                ({dice.join(' + ')}){bonus !== 0 && ` ${bonus > 0 ? '+' : '-'} ${Math.abs(bonus)}`}{' '}
                = {roll.total}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function DiceRollCard({ roll }: { roll: DiceRollMessage }) {
  const d = new Date(roll.timestamp);
  const time = `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  // Detect advantage/disadvantage from attack rolls
  const hasDiscard = roll.attackRolls.length === 2 && roll.attackRolls.some((r) => r.discarded);
  let rollMode: 'normal' | 'advantage' | 'disadvantage' = 'normal';
  if (hasDiscard) {
    const kept = roll.attackRolls.find((r) => !r.discarded);
    const dropped = roll.attackRolls.find((r) => r.discarded);
    if (kept && dropped) {
      rollMode = kept.total >= dropped.total ? 'advantage' : 'disadvantage';
    }
  }

  return (
    <div className="rounded-lg bg-[#252542] border-l-4 border-purple-500 p-3 mb-2">
      <div className="flex items-baseline justify-between mb-1">
        <div className="flex items-baseline gap-2">
          <span className="font-sans text-xs font-semibold text-purple-300">{roll.character}</span>
          {rollMode === 'advantage' && (
            <span className="rounded bg-green-900/40 px-1.5 py-0.5 font-sans text-[9px] font-bold uppercase tracking-wider text-green-400">
              ADV
            </span>
          )}
          {rollMode === 'disadvantage' && (
            <span className="rounded bg-red-900/40 px-1.5 py-0.5 font-sans text-[9px] font-bold uppercase tracking-wider text-red-400">
              DIS
            </span>
          )}
        </div>
        <span className="font-sans text-[10px] text-slate-600">{time}</span>
      </div>
      <div className="font-sans text-xs text-slate-300 mb-1">{roll.title}</div>
      <RollBreakdown
        attackRolls={roll.attackRolls}
        damageRolls={roll.damageRolls}
        rollInfo={roll.rollInfo}
        variant={roll.rollType === 'custom' ? 'custom' : 'beyond20'}
      />
      {Object.keys(roll.totalDamages).length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/[0.05] flex items-baseline gap-2 flex-wrap">
          <span className="font-sans text-[10px] text-slate-500 uppercase tracking-wider">
            Total:
          </span>
          {Object.entries(roll.totalDamages).map(([type, total]) => (
            <span key={type} className="font-mono text-xs font-bold text-orange-200">
              {total}{' '}
              <span className="font-sans text-[10px] font-normal text-slate-500">{type}</span>
            </span>
          ))}
        </div>
      )}
      {roll.description && (
        <details className="mt-2">
          <summary className="cursor-pointer font-sans text-[11px] text-slate-500">
            Description
          </summary>
          <p className="mt-1 font-sans text-xs text-slate-400 leading-relaxed">
            {roll.description}
          </p>
        </details>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <Dice5 className="h-10 w-10 text-slate-600" />
      <div>
        <h3 className="font-sans text-sm font-semibold text-slate-300 mb-2">No dice rolls yet</h3>
        <p className="font-sans text-xs text-slate-500 leading-relaxed max-w-[240px]">
          Install the{' '}
          <a
            href="https://beyond20.here-for-more.info/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            Beyond 20
            <ExternalLink className="h-3 w-3" />
          </a>{' '}
          browser extension, then add this site&apos;s domain to Beyond 20&apos;s Custom Domains in
          the extension settings.
        </p>
        <p className="font-sans text-xs text-slate-600 mt-2">
          Open a character sheet on D&amp;D Beyond and click any roll button to see it appear here.
        </p>
      </div>
    </div>
  );
}

export interface DicePanelProps {
  rolls: DiceRollMessage[];
  isConnected: boolean;
  sessions: Array<{ id: string; name: string; number: number }>;
  activeSessionId: string;
  onSessionChange: (sessionId: string) => void;
  saveError: string | null;
  onDismissError: () => void;
}

export function DicePanel({
  rolls,
  isConnected,
  sessions,
  activeSessionId,
  onSessionChange,
  saveError,
  onDismissError,
}: DicePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);

  useEffect(() => {
    if (isAtBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rolls]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isAtBottom.current = scrollHeight - scrollTop - clientHeight < 40;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#080A12] w-full">
      {/* Session selector */}
      <div className="border-b border-white/[0.07] p-3">
        <label htmlFor="dice-session-selector" className="sr-only">
          Session selector
        </label>
        <select
          id="dice-session-selector"
          value={activeSessionId}
          onChange={(e) => onSessionChange(e.target.value)}
          className="w-full rounded border border-white/[0.07] bg-[#080A12] px-3 py-2 font-sans font-semibold text-xs text-white outline-none"
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              Session {s.number}: {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Connection indicator */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/[0.07]">
        <div
          className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-green-400' : 'bg-slate-600'}`}
        />
        <span className="font-sans text-[10px] text-slate-500">
          {isConnected ? 'Beyond 20 connected' : 'Waiting for Beyond 20...'}
        </span>
      </div>

      {/* Save error banner */}
      {saveError && (
        <div className="flex items-center justify-between bg-red-900/30 px-3 py-2 border-b border-red-800/30">
          <span className="font-sans text-[11px] text-red-300">{saveError}</span>
          <button
            type="button"
            onClick={onDismissError}
            className="font-sans text-[10px] text-red-400 hover:text-red-200"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Roll feed */}
      {rolls.length === 0 && !isConnected ? (
        <EmptyState />
      ) : (
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3">
          {rolls.length === 0 ? (
            <div className="flex flex-1 items-center justify-center h-full">
              <span className="font-sans text-xs text-slate-500">Waiting for dice rolls...</span>
            </div>
          ) : (
            rolls.map((roll) => <DiceRollCard key={roll.id} roll={roll} />)
          )}
        </div>
      )}
    </div>
  );
}
