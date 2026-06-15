import { Pencil, Skull } from 'lucide-react';
import type { MonsterData } from '~/types/monster';

interface MonsterWindowProps {
  monster: MonsterData;
  onEdit?: () => void;
}

const SIZE_LABELS: Record<MonsterData['size'], string> = {
  tiny: 'Tiny',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  huge: 'Huge',
  gargantuan: 'Gargantuan',
};

function formatCR(value: number): string {
  if (value === 0.125) return '1/8';
  if (value === 0.25) return '1/4';
  if (value === 0.5) return '1/2';
  return String(value);
}

const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

const ABILITIES = [
  ['STR', 'str'],
  ['DEX', 'dex'],
  ['CON', 'con'],
  ['INT', 'int'],
  ['WIS', 'wis'],
  ['CHA', 'cha'],
] as const;

/** Read-only stat-block view of a monster, shown in a tabletop window. */
export function MonsterWindow({ monster, onEdit }: MonsterWindowProps) {
  const typeText = [monster.type, monster.subtype && `(${monster.subtype})`]
    .filter(Boolean)
    .join(' ');
  const featureSections = [...new Set(monster.features.map((f) => f.section))];

  return (
    <div className="flex h-full flex-col" data-testid="monster-window">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/[0.05] px-3 py-2">
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
          style={monster.picture ? undefined : { backgroundColor: monster.color }}
        >
          {monster.picture ? (
            <img src={monster.picture} alt="" className="h-full w-full object-cover" />
          ) : (
            <Skull className="h-4 w-4 text-white" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-sans truncate text-sm font-semibold text-slate-100">{monster.name}</p>
          <p className="font-sans truncate text-[11px] text-slate-500">
            {SIZE_LABELS[monster.size]} {typeText}
            {monster.alignment ? ` · ${monster.alignment}` : ''}
          </p>
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit monster"
            className="flex-shrink-0 rounded bg-white/[0.05] p-1 text-slate-400 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 font-sans text-xs text-slate-300">
        {/* Top stats */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <span className="text-slate-500">AC</span> {monster.armorClass}
            {monster.armorClassNote ? ` (${monster.armorClassNote})` : ''}
          </span>
          <span>
            <span className="text-slate-500">HP</span> {monster.hitPoints.average}
            {monster.hitPoints.formula ? ` (${monster.hitPoints.formula})` : ''}
          </span>
          <span>
            <span className="text-slate-500">CR</span> {formatCR(monster.cr.value)}
          </span>
        </div>

        {/* Ability scores */}
        <div className="grid grid-cols-6 gap-1 rounded border border-white/[0.05] bg-white/[0.02] p-2 text-center">
          {ABILITIES.map(([label, key]) => {
            const a = monster.abilities[key];
            return (
              <div key={key}>
                <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
                  {label}
                </div>
                <div className="font-mono text-[11px] text-slate-200">
                  {a.score} <span className="text-slate-500">({signed(a.mod)})</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Speeds / senses / languages */}
        {monster.speeds.length > 0 && (
          <p>
            <span className="text-slate-500">Speed</span>{' '}
            {monster.speeds
              .map((s) => `${s.kind === 'walk' ? '' : s.kind + ' '}${s.feet} ft.`)
              .join(', ')}
          </p>
        )}
        {monster.senses.length > 0 && (
          <p>
            <span className="text-slate-500">Senses</span>{' '}
            {monster.senses
              .map((s) => `${s.name}${s.range != null ? ` ${s.range} ft.` : ''}`)
              .join(', ')}{' '}
            · passive Perception {monster.passivePerception}
          </p>
        )}
        {monster.languages.length > 0 && (
          <p>
            <span className="text-slate-500">Languages</span> {monster.languages.join(', ')}
          </p>
        )}

        {/* Features grouped by section */}
        {featureSections.map((section) => (
          <div key={section} className="space-y-1.5">
            <h3 className="font-sans text-[10px] font-bold uppercase tracking-widest text-amber-300/80">
              {section}
            </h3>
            {monster.features
              .filter((f) => f.section === section)
              .map((f, i) => (
                <p key={`${section}-${i}`} className="leading-snug">
                  <span className="font-semibold text-slate-100">{f.name}.</span> {f.description}
                </p>
              ))}
          </div>
        ))}

        {/* GM notes */}
        {monster.gmNotes && (
          <div className="space-y-1 border-t border-white/[0.05] pt-2">
            <h3 className="font-sans text-[10px] font-bold uppercase tracking-widest text-slate-500">
              GM Notes
            </h3>
            <p className="whitespace-pre-wrap leading-snug text-slate-400">{monster.gmNotes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
