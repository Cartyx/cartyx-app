# Spells Feature — Plan Part B: UI Layer

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Continue from Part A (`2026-07-12-spells-plan.md`). Steps use `- [ ]`.

**Prerequisite:** Part A is merged (types, constants, schemas, model, server functions, `useSpells` hook, query keys).

**Goal:** Build the six-component spells wiki UI (card, display window, view modal, create/edit modal with full DNDBeyond-parity form, panel with level/school filters) and register it in the wiki.

Follows the Races UI templates exactly (`app/components/wiki/races/*`), adapted for the structured spell model. All new files live in `app/components/wiki/spells/`.

## Global Constraints (inherited)

- `npm test`, `npm run typecheck`, `npm run lint` all clean; no new lint warnings.
- Shared components reused as-is: `FormInput` (`label`, `value`, `onChange`, `error`, `required`, `disabled`, `placeholder`), `FormSelect` (`label`, `value`, `onChange`, `options: {value,label}[]`), `PixelButton` (`variant`, `size`, `type`, `onClick`, `disabled`), `MarkdownEditor` (`label`, `value`, `onChange`, `placeholder`, `error`, `disabled`, `minHeight`), `TagAutocompleteInput` (`campaignId`, `selectedTags`, `onTagsChange`, `disabled`), `useModalForm` (`{ isOpen, onClose, recordId, isEdit, record, reset, populate, validate }` → `{ fieldErrors, runValidation }`), `MARKDOWN_PROSE_CLASSES` from `~/utils/markdownProseClasses`.
- Card/panel dark styling copied from the Race equivalents.

---

## Task 6: Display formatters + SpellCard

**Files:**

- Create: `app/components/wiki/spells/spellFormat.ts`
- Create: `tests/components/wiki/spells/spellFormat.test.ts` (tests live under `tests/`, `~/` imports)
- Create: `app/components/wiki/spells/SpellCard.tsx`

**Interfaces:**

- Produces: `formatCastingTime`, `formatRange`, `formatDuration`, `formatComponents`, `formatAttackSave`, `formatDamageEffect` (all `(spell) => string`), and the `SpellCard` component (`{ spell: SpellListItem, onClick: (s) => void }`).

- [ ] **Step 1: Write `app/components/wiki/spells/spellFormat.ts`**

```ts
import type { SpellData } from '~/types/spell';

export function formatCastingTime(ct: SpellData['castingTime']): string {
  const unitLabel: Record<string, string> = {
    action: 'Action',
    bonus: 'Bonus Action',
    reaction: 'Reaction',
    minute: 'Minute',
    hour: 'Hour',
  };
  const label = unitLabel[ct.unit] ?? ct.unit;
  const plural = ct.value !== 1 && (ct.unit === 'minute' || ct.unit === 'hour') ? 's' : '';
  if (ct.unit === 'action' || ct.unit === 'bonus' || ct.unit === 'reaction') {
    return ct.value <= 1 ? `1 ${label}` : `${ct.value} ${label}s`;
  }
  return `${ct.value} ${label}${plural}`;
}

export function formatRange(range: SpellData['range']): string {
  switch (range.type) {
    case 'self':
      return 'Self';
    case 'touch':
      return 'Touch';
    case 'sight':
      return 'Sight';
    case 'unlimited':
      return 'Unlimited';
    case 'ranged':
      return range.distance != null ? `${range.distance} ft.` : 'Ranged';
    default:
      return 'Self';
  }
}

export function formatDuration(d: SpellData['duration']): string {
  if (d.type === 'instantaneous') return 'Instantaneous';
  if (d.type === 'until-dispelled') return 'Until Dispelled';
  if (d.type === 'special') return 'Special';
  const unit = d.unit ?? 'round';
  const plural = (d.value ?? 0) !== 1 ? 's' : '';
  const body = d.value != null ? `${d.value} ${unit}${plural}` : unit;
  return d.concentration || d.type === 'concentration' ? `Concentration, up to ${body}` : body;
}

export function formatComponents(c: SpellData['components']): string {
  const parts: string[] = [];
  if (c.verbal) parts.push('V');
  if (c.somatic) parts.push('S');
  if (c.material) parts.push('M');
  return parts.join(', ') || '—';
}

export function formatAttackSave(a: SpellData['attackSave']): string {
  if (a.kind === 'attack') {
    return a.attackType === 'melee' ? 'Melee' : 'Ranged';
  }
  if (a.kind === 'save' && a.saveAbility) {
    return a.saveAbility.toUpperCase();
  }
  return '—';
}

export function formatDamageEffect(spell: SpellData): string {
  const damage = spell.modifiers.find((m) => m.type === 'damage' && m.damageType);
  if (damage?.damageType) {
    return damage.damageType.charAt(0).toUpperCase() + damage.damageType.slice(1);
  }
  const healing = spell.modifiers.find((m) => m.type === 'healing');
  if (healing) return 'Healing';
  return '—';
}
```

- [ ] **Step 2: Write `tests/components/wiki/spells/spellFormat.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  formatRange,
  formatDuration,
  formatComponents,
  formatDamageEffect,
} from '~/components/wiki/spells/spellFormat';
import type { SpellData } from '~/types/spell';

describe('spell display formatters', () => {
  it('formats ranged distance', () => {
    expect(formatRange({ type: 'ranged', distance: 120 })).toBe('120 ft.');
    expect(formatRange({ type: 'self' })).toBe('Self');
  });

  it('formats concentration duration', () => {
    expect(
      formatDuration({ type: 'concentration', value: 10, unit: 'minute', concentration: true })
    ).toBe('Concentration, up to 10 minutes');
    expect(formatDuration({ type: 'instantaneous', concentration: false })).toBe('Instantaneous');
  });

  it('joins components', () => {
    expect(formatComponents({ verbal: true, somatic: true, material: false })).toBe('V, S');
  });

  it('derives damage/effect from modifiers', () => {
    const spell = { modifiers: [{ id: 'm', type: 'damage', damageType: 'fire' }] } as SpellData;
    expect(formatDamageEffect(spell)).toBe('Fire');
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npm test -- tests/components/wiki/spells/spellFormat.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Write `app/components/wiki/spells/SpellCard.tsx`**

```tsx
import type { SpellListItem } from '~/types/spell';
import { formatSpellLevel, formatSchool } from '~/constants/spells';

interface SpellCardProps {
  spell: SpellListItem;
  onClick: (spell: SpellListItem) => void;
}

export function SpellCard({ spell, onClick }: SpellCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable="true"
      onDragStart={(e) => {
        e.dataTransfer.setData(
          'application/x-cartyx-document',
          JSON.stringify({ collection: 'spell', documentId: spell.id, title: spell.name })
        );
        e.dataTransfer.effectAllowed = 'copy';
        e.currentTarget.style.opacity = '0.4';
      }}
      onDragEnd={(e) => {
        e.currentTarget.style.opacity = '';
      }}
      onClick={() => onClick(spell)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(spell);
        }
      }}
      className="flex items-start gap-3 px-4 py-3 border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors group cursor-grab active:cursor-grabbing"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-slate-200 group-hover:text-blue-400 transition-colors truncate">
            {spell.name}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-sans font-semibold text-slate-500">
          <span>{formatSpellLevel(spell.level)}</span>
          <span aria-hidden>·</span>
          <span>{formatSchool(spell.school)}</span>
          {spell.source === 'srd' && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-400 text-[9px] tracking-wide">
              SRD
            </span>
          )}
        </div>
        {spell.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
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
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add app/components/wiki/spells/spellFormat.ts tests/components/wiki/spells/spellFormat.test.ts app/components/wiki/spells/SpellCard.tsx
git commit -m "feat(spells): add display formatters and SpellCard"
```

---

## Task 7: SpellWindow (display card) + SpellViewModal

**Files:**

- Create: `app/components/wiki/spells/SpellWindow.tsx`
- Create: `app/components/wiki/spells/SpellViewModal.tsx`

**Interfaces:**

- Consumes: `useSpell` (Task 5), formatters (Task 6), `formatSpellLevel`/`formatSchool` (Task 1).
- Produces: `SpellWindow` (`{ spell: SpellData, onEdit?: () => void }`), `SpellViewModal` (`{ isOpen, onClose, spellId, campaignId }`).

> Note: `SpellWindowWrapper`/`EditSpellModalWrapper` (GM-screen embedding) are **out of scope for Phase 1** — nothing consumes them here (GM-screen spell embedding is deferred with the tabletop work). Do not create them; that also avoids an unused file importing `SpellModal` (Task 10).

- [ ] **Step 1: Write `app/components/wiki/spells/SpellWindow.tsx`**

```tsx
import { Pencil } from 'lucide-react';
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
        {spell.canEdit && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 p-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white transition-colors"
            aria-label="Edit spell"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
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
```

- [ ] **Step 2: Write `app/components/wiki/spells/SpellViewModal.tsx`**

```tsx
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
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` → clean. (`SpellWindow` and `SpellViewModal` only depend on Task 5/6 which are merged, so this compiles cleanly with no deferral.)

- [ ] **Step 4: Commit**

```bash
git add app/components/wiki/spells/SpellWindow.tsx app/components/wiki/spells/SpellViewModal.tsx
git commit -m "feat(spells): add SpellWindow display card and view modal"
```

---

## Task 8: Sub-list editors (Modifiers / Conditions / Higher Levels)

**Files:**

- Create: `app/components/wiki/spells/SpellModifiersEditor.tsx`
- Create: `app/components/wiki/spells/SpellConditionsEditor.tsx`
- Create: `app/components/wiki/spells/SpellHigherLevelsEditor.tsx`
- Create: `app/components/wiki/spells/newId.ts`

**Interfaces:**

- Produces: `newId()` (stable unique id for list rows); `SpellModifiersEditor` (`{ value: SpellModifier[], onChange, disabled }`), `SpellConditionsEditor` (`{ value: SpellCondition[], onChange, disabled }`), `SpellHigherLevelsEditor` (`{ value: SpellHigherLevel[], onChange, disabled }`).

- [ ] **Step 1: Write `app/components/wiki/spells/newId.ts`**

```ts
/** Client-only unique id for editable list rows (not persisted as an ObjectId). */
export function newId(): string {
  return `row-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
```

- [ ] **Step 2: Write `app/components/wiki/spells/SpellModifiersEditor.tsx`**

```tsx
import { Trash2, Plus } from 'lucide-react';
import type { SpellModifier } from '~/types/spell';
import { MODIFIER_TYPES } from '~/constants/spells';
import { newId } from './newId';

interface Props {
  value: SpellModifier[];
  onChange: (next: SpellModifier[]) => void;
  disabled?: boolean;
}

export function SpellModifiersEditor({ value, onChange, disabled }: Props) {
  const patch = (id: string, partial: Partial<SpellModifier>) =>
    onChange(value.map((m) => (m.id === id ? { ...m, ...partial } : m)));

  return (
    <fieldset className="border border-white/[0.07] rounded-lg p-3 m-0">
      <legend className="px-1 text-xs font-bold uppercase tracking-widest text-slate-400">
        Modifiers ({value.length})
      </legend>
      <div className="space-y-2">
        {value.map((m) => (
          <div key={m.id} className="flex flex-wrap items-end gap-2 p-2 rounded bg-white/[0.02]">
            <label className="flex flex-col text-[10px] text-slate-500">
              Type
              <select
                value={m.type}
                disabled={disabled}
                onChange={(e) => patch(m.id, { type: e.target.value as SpellModifier['type'] })}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              >
                {MODIFIER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-[10px] text-slate-500 w-16">
              Dice count
              <input
                type="number"
                min={0}
                value={m.dice?.count ?? ''}
                disabled={disabled}
                onChange={(e) => {
                  const count = e.target.value === '' ? undefined : Number(e.target.value);
                  patch(m.id, {
                    dice: count == null ? undefined : { count, sides: m.dice?.sides ?? 6 },
                  });
                }}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              />
            </label>
            <label className="flex flex-col text-[10px] text-slate-500 w-16">
              Dice sides
              <input
                type="number"
                min={2}
                value={m.dice?.sides ?? ''}
                disabled={disabled}
                onChange={(e) => {
                  const sides = e.target.value === '' ? undefined : Number(e.target.value);
                  patch(m.id, {
                    dice: sides == null ? m.dice : { count: m.dice?.count ?? 1, sides },
                  });
                }}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              />
            </label>
            <label className="flex flex-col text-[10px] text-slate-500 flex-1 min-w-[120px]">
              Damage type
              <input
                type="text"
                value={m.damageType ?? ''}
                disabled={disabled}
                placeholder="e.g. fire"
                onChange={(e) => patch(m.id, { damageType: e.target.value || undefined })}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(value.filter((x) => x.id !== m.id))}
              className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
              aria-label="Remove modifier"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...value, { id: newId(), type: 'damage' }])}
        className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
      >
        <Plus className="h-3.5 w-3.5" /> Add a modifier
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 3: Write `app/components/wiki/spells/SpellConditionsEditor.tsx`**

```tsx
import { Trash2, Plus } from 'lucide-react';
import type { SpellCondition } from '~/types/spell';
import { CONDITION_ACTIONS } from '~/constants/spells';
import { newId } from './newId';

interface Props {
  value: SpellCondition[];
  onChange: (next: SpellCondition[]) => void;
  disabled?: boolean;
}

export function SpellConditionsEditor({ value, onChange, disabled }: Props) {
  const patch = (id: string, partial: Partial<SpellCondition>) =>
    onChange(value.map((c) => (c.id === id ? { ...c, ...partial } : c)));

  return (
    <fieldset className="border border-white/[0.07] rounded-lg p-3 m-0">
      <legend className="px-1 text-xs font-bold uppercase tracking-widest text-slate-400">
        Conditions ({value.length})
      </legend>
      <div className="space-y-2">
        {value.map((c) => (
          <div key={c.id} className="flex flex-wrap items-end gap-2 p-2 rounded bg-white/[0.02]">
            <label className="flex flex-col text-[10px] text-slate-500">
              Action
              <select
                value={c.action}
                disabled={disabled}
                onChange={(e) =>
                  patch(c.id, { action: e.target.value as SpellCondition['action'] })
                }
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              >
                {CONDITION_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-[10px] text-slate-500 flex-1 min-w-[140px]">
              Condition
              <input
                type="text"
                value={c.condition}
                disabled={disabled}
                placeholder="e.g. Prone"
                onChange={(e) => patch(c.id, { condition: e.target.value })}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(value.filter((x) => x.id !== c.id))}
              className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
              aria-label="Remove condition"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...value, { id: newId(), action: 'applies', condition: '' }])}
        className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
      >
        <Plus className="h-3.5 w-3.5" /> Add a condition
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 4: Write `app/components/wiki/spells/SpellHigherLevelsEditor.tsx`**

```tsx
import { Trash2, Plus } from 'lucide-react';
import type { SpellHigherLevel } from '~/types/spell';
import { newId } from './newId';

interface Props {
  value: SpellHigherLevel[];
  onChange: (next: SpellHigherLevel[]) => void;
  disabled?: boolean;
}

export function SpellHigherLevelsEditor({ value, onChange, disabled }: Props) {
  const patch = (id: string, partial: Partial<SpellHigherLevel>) =>
    onChange(value.map((h) => (h.id === id ? { ...h, ...partial } : h)));

  return (
    <fieldset className="border border-white/[0.07] rounded-lg p-3 m-0">
      <legend className="px-1 text-xs font-bold uppercase tracking-widest text-slate-400">
        At Higher Levels ({value.length})
      </legend>
      <div className="space-y-2">
        {value.map((h) => (
          <div key={h.id} className="flex flex-wrap items-end gap-2 p-2 rounded bg-white/[0.02]">
            <label className="flex flex-col text-[10px] text-slate-500 w-16">
              Level
              <input
                type="number"
                min={1}
                max={9}
                value={h.level}
                disabled={disabled}
                onChange={(e) => patch(h.id, { level: Number(e.target.value) })}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              />
            </label>
            <label className="flex flex-col text-[10px] text-slate-500 flex-1 min-w-[160px]">
              Description
              <input
                type="text"
                value={h.description}
                disabled={disabled}
                placeholder="Damage increases by 1d6..."
                onChange={(e) => patch(h.id, { description: e.target.value })}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(value.filter((x) => x.id !== h.id))}
              className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
              aria-label="Remove higher-level entry"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || value.length >= 25}
        onClick={() =>
          onChange([...value, { id: newId(), level: value.length + 2, description: '' }])
        }
        className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" /> Add a higher-level entry
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add app/components/wiki/spells/newId.ts app/components/wiki/spells/SpellModifiersEditor.tsx app/components/wiki/spells/SpellConditionsEditor.tsx app/components/wiki/spells/SpellHigherLevelsEditor.tsx
git commit -m "feat(spells): add modifiers/conditions/higher-levels sub-editors"
```

---

## Task 9: SpellModal form-state model + Basic/Additional sections

**Files:**

- Create: `app/components/wiki/spells/spellForm.ts` (form state type + empty default + `spellToForm` / `formToInput`)
- Create: `tests/components/wiki/spells/spellForm.test.ts` (tests live under `tests/`, `~/` imports)
- Create: `app/components/wiki/spells/SpellBasicInfoSection.tsx`
- Create: `app/components/wiki/spells/SpellAdditionalInfoSection.tsx`

**Interfaces:**

- Produces: `SpellForm` type; `EMPTY_SPELL_FORM`; `spellToForm(spell: SpellData): SpellForm`; `formToInput(form, campaignId, id?)` → object matching `createSpellSchema`/`updateSpellSchema`; `SpellBasicInfoSection` and `SpellAdditionalInfoSection` (`{ form, patch, disabled, errors }`), where `patch(partial: Partial<SpellForm>) => void`.

- [ ] **Step 1: Write `app/components/wiki/spells/spellForm.ts`**

```ts
import type {
  SpellData,
  SpellModifier,
  SpellCondition,
  SpellHigherLevel,
  SpellSchool,
  CastingTimeUnit,
  RangeType,
  DurationType,
  DurationUnit,
  AttackSaveKind,
  AttackType,
  SaveAbility,
  AoeShape,
  ScalingType,
} from '~/types/spell';

export interface SpellForm {
  name: string;
  description: string;
  version: string;
  level: number;
  school: SpellSchool;
  castingValue: number;
  castingUnit: CastingTimeUnit;
  reactionCondition: string;
  verbal: boolean;
  somatic: boolean;
  material: boolean;
  materialDescription: string;
  rangeType: RangeType;
  rangeDistance: string; // text input, parsed on submit
  durationType: DurationType;
  durationValue: string;
  durationUnit: DurationUnit;
  concentration: boolean;
  ritual: boolean;
  scalingEnabled: boolean;
  scalingType: ScalingType;
  classes: string[];
  attackKind: AttackSaveKind;
  attackType: AttackType;
  saveAbility: SaveAbility;
  saveEffect: string;
  aoeShape: AoeShape;
  aoeSize: string;
  aoeWidth: string;
  modifiers: SpellModifier[];
  conditions: SpellCondition[];
  higherLevels: SpellHigherLevel[];
  tags: string[];
}

export const EMPTY_SPELL_FORM: SpellForm = {
  name: '',
  description: '',
  version: '',
  level: 0,
  school: 'evocation',
  castingValue: 1,
  castingUnit: 'action',
  reactionCondition: '',
  verbal: false,
  somatic: false,
  material: false,
  materialDescription: '',
  rangeType: 'self',
  rangeDistance: '',
  durationType: 'instantaneous',
  durationValue: '',
  durationUnit: 'round',
  concentration: false,
  ritual: false,
  scalingEnabled: false,
  scalingType: 'spell-scale',
  classes: [],
  attackKind: 'none',
  attackType: 'ranged',
  saveAbility: 'dex',
  saveEffect: '',
  aoeShape: 'none',
  aoeSize: '',
  aoeWidth: '',
  modifiers: [],
  conditions: [],
  higherLevels: [],
  tags: [],
};

export function spellToForm(s: SpellData): SpellForm {
  return {
    name: s.name,
    description: s.description,
    version: s.version ?? '',
    level: s.level,
    school: s.school,
    castingValue: s.castingTime.value,
    castingUnit: s.castingTime.unit,
    reactionCondition: s.castingTime.reactionCondition ?? '',
    verbal: s.components.verbal,
    somatic: s.components.somatic,
    material: s.components.material,
    materialDescription: s.components.materialDescription ?? '',
    rangeType: s.range.type,
    rangeDistance: s.range.distance != null ? String(s.range.distance) : '',
    durationType: s.duration.type,
    durationValue: s.duration.value != null ? String(s.duration.value) : '',
    durationUnit: s.duration.unit ?? 'round',
    concentration: s.duration.concentration,
    ritual: s.ritual,
    scalingEnabled: s.higherLevelScaling.enabled,
    scalingType: s.higherLevelScaling.type ?? 'spell-scale',
    classes: s.classes,
    attackKind: s.attackSave.kind,
    attackType: s.attackSave.attackType ?? 'ranged',
    saveAbility: s.attackSave.saveAbility ?? 'dex',
    saveEffect: s.attackSave.saveEffect ?? '',
    aoeShape: s.areaOfEffect.shape,
    aoeSize: s.areaOfEffect.size != null ? String(s.areaOfEffect.size) : '',
    aoeWidth: s.areaOfEffect.width != null ? String(s.areaOfEffect.width) : '',
    modifiers: s.modifiers,
    conditions: s.conditions,
    higherLevels: s.higherLevels,
    tags: s.tags,
  };
}

function toIntOrUndef(v: string): number | undefined {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function formToInput(form: SpellForm, campaignId: string, id?: string) {
  const base = {
    campaignId,
    name: form.name.trim(),
    description: form.description.trim(),
    version: form.version.trim() || undefined,
    level: form.level,
    school: form.school,
    castingTime: {
      value: form.castingValue,
      unit: form.castingUnit,
      reactionCondition:
        form.castingUnit === 'reaction' ? form.reactionCondition.trim() || undefined : undefined,
    },
    components: {
      verbal: form.verbal,
      somatic: form.somatic,
      material: form.material,
      materialDescription: form.material ? form.materialDescription.trim() || undefined : undefined,
    },
    range: {
      type: form.rangeType,
      distance: form.rangeType === 'ranged' ? toIntOrUndef(form.rangeDistance) : undefined,
    },
    duration: {
      type: form.durationType,
      value: toIntOrUndef(form.durationValue),
      unit:
        form.durationType === 'timed' || form.durationType === 'concentration'
          ? form.durationUnit
          : undefined,
      concentration: form.concentration || form.durationType === 'concentration',
    },
    ritual: form.ritual,
    higherLevelScaling: {
      enabled: form.scalingEnabled,
      type: form.scalingEnabled ? form.scalingType : undefined,
    },
    classes: form.classes,
    attackSave: {
      kind: form.attackKind,
      attackType: form.attackKind === 'attack' ? form.attackType : undefined,
      saveAbility: form.attackKind === 'save' ? form.saveAbility : undefined,
      saveEffect: form.attackKind === 'save' ? form.saveEffect.trim() || undefined : undefined,
    },
    modifiers: form.modifiers,
    conditions: form.conditions,
    higherLevels: form.higherLevels,
    areaOfEffect: {
      shape: form.aoeShape,
      size: form.aoeShape !== 'none' ? toIntOrUndef(form.aoeSize) : undefined,
      width:
        form.aoeShape === 'line' || form.aoeShape === 'cylinder'
          ? toIntOrUndef(form.aoeWidth)
          : undefined,
    },
    tags: form.tags,
  };
  return id ? { id, ...base } : base;
}
```

- [ ] **Step 2: Write `tests/components/wiki/spells/spellForm.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { EMPTY_SPELL_FORM, formToInput, spellToForm } from '~/components/wiki/spells/spellForm';
import { createSpellSchema, updateSpellSchema } from '~/types/schemas/spells';
import type { SpellData } from '~/types/spell';

describe('formToInput', () => {
  it('produces a create payload that satisfies createSpellSchema', () => {
    const form = {
      ...EMPTY_SPELL_FORM,
      name: 'Fire Bolt',
      description: 'A mote of fire.',
      rangeType: 'ranged' as const,
      rangeDistance: '120',
      verbal: true,
      somatic: true,
    };
    const input = formToInput(form, 'c1');
    expect(() => createSpellSchema.parse(input)).not.toThrow();
    expect((input as { range: { distance: number } }).range.distance).toBe(120);
  });

  it('produces an update payload with id that satisfies updateSpellSchema', () => {
    const form = { ...EMPTY_SPELL_FORM, name: 'X', description: 'Y' };
    const input = formToInput(form, 'c1', 'spell1');
    expect(() => updateSpellSchema.parse(input)).not.toThrow();
  });

  it('round-trips a spell through spellToForm -> formToInput', () => {
    const spell = {
      id: 's1',
      campaignId: 'c1',
      createdBy: 'u1',
      source: 'homebrew',
      name: 'Fireball',
      description: 'Boom',
      level: 3,
      school: 'evocation',
      castingTime: { value: 1, unit: 'action' },
      components: { verbal: true, somatic: true, material: true, materialDescription: 'bat guano' },
      range: { type: 'ranged', distance: 150 },
      duration: { type: 'instantaneous', concentration: false },
      ritual: false,
      higherLevelScaling: { enabled: true, type: 'spell-scale' },
      classes: ['Wizard'],
      attackSave: { kind: 'save', saveAbility: 'dex' },
      modifiers: [{ id: 'm1', type: 'damage', dice: { count: 8, sides: 6 }, damageType: 'fire' }],
      conditions: [],
      higherLevels: [],
      areaOfEffect: { shape: 'sphere', size: 20 },
      tags: ['fire'],
      canEdit: true,
      createdAt: '',
      updatedAt: '',
    } as SpellData;
    const input = formToInput(spellToForm(spell), 'c1');
    const parsed = createSpellSchema.parse(input);
    expect(parsed.level).toBe(3);
    expect(parsed.areaOfEffect).toEqual({ shape: 'sphere', size: 20 });
    expect(parsed.attackSave.saveAbility).toBe('dex');
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npm test -- tests/components/wiki/spells/spellForm.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Write `app/components/wiki/spells/SpellBasicInfoSection.tsx`**

```tsx
import { FormInput } from '~/components/FormInput';
import { FormSelect } from '~/components/FormSelect';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import {
  SPELL_SCHOOLS,
  CASTING_TIME_UNITS,
  RANGE_TYPES,
  DURATION_TYPES,
  DURATION_UNITS,
  formatSpellLevel,
} from '~/constants/spells';
import type { SpellForm } from './spellForm';

interface Props {
  form: SpellForm;
  patch: (partial: Partial<SpellForm>) => void;
  disabled?: boolean;
  errors: { name?: string; description?: string };
}

export function SpellBasicInfoSection({ form, patch, disabled, errors }: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <FormInput
            label="Spell Name"
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
            error={errors.name}
            required
            disabled={disabled}
            placeholder="e.g. Fireball"
          />
        </div>
        <FormInput
          label="Version"
          value={form.version}
          onChange={(e) => patch({ version: e.target.value })}
          disabled={disabled}
          placeholder="optional"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <FormSelect
          label="Level"
          value={String(form.level)}
          onChange={(e) => patch({ level: Number(e.target.value) })}
          options={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
            value: String(n),
            label: formatSpellLevel(n),
          }))}
        />
        <FormSelect
          label="School"
          value={form.school}
          onChange={(e) => patch({ school: e.target.value as SpellForm['school'] })}
          options={SPELL_SCHOOLS.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
        />
        <FormSelect
          label="Casting Unit"
          value={form.castingUnit}
          onChange={(e) => patch({ castingUnit: e.target.value as SpellForm['castingUnit'] })}
          options={CASTING_TIME_UNITS.map((u) => ({ value: u, label: u }))}
        />
        <FormInput
          label="Casting Value"
          value={String(form.castingValue)}
          onChange={(e) => patch({ castingValue: Number(e.target.value) || 0 })}
          disabled={disabled}
        />
      </div>

      {form.castingUnit === 'reaction' && (
        <FormInput
          label="Reaction Condition"
          value={form.reactionCondition}
          onChange={(e) => patch({ reactionCondition: e.target.value })}
          disabled={disabled}
          placeholder="which you take when..."
        />
      )}

      <fieldset className="border-none p-0 m-0">
        <legend className="block text-xs font-semibold text-slate-400 mb-2">Components</legend>
        <div className="flex gap-2">
          {(['verbal', 'somatic', 'material'] as const).map((key) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => patch({ [key]: !form[key] } as Partial<SpellForm>)}
              className={`px-3 py-2 rounded-lg border text-sm font-bold transition-all ${
                form[key]
                  ? 'bg-blue-600/25 border-blue-500/70 text-blue-300'
                  : 'bg-white/[0.04] border-white/10 text-slate-500'
              }`}
            >
              {key[0].toUpperCase()}
            </button>
          ))}
        </div>
      </fieldset>

      {form.material && (
        <FormInput
          label="Material Components"
          value={form.materialDescription}
          onChange={(e) => patch({ materialDescription: e.target.value })}
          disabled={disabled}
          placeholder="a ball of bat guano and sulfur"
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <FormSelect
          label="Range Type"
          value={form.rangeType}
          onChange={(e) => patch({ rangeType: e.target.value as SpellForm['rangeType'] })}
          options={RANGE_TYPES.map((r) => ({ value: r, label: r }))}
        />
        {form.rangeType === 'ranged' && (
          <FormInput
            label="Range (ft.)"
            value={form.rangeDistance}
            onChange={(e) => patch({ rangeDistance: e.target.value })}
            disabled={disabled}
            placeholder="150"
          />
        )}
        <FormSelect
          label="Duration Type"
          value={form.durationType}
          onChange={(e) => patch({ durationType: e.target.value as SpellForm['durationType'] })}
          options={DURATION_TYPES.map((d) => ({ value: d, label: d }))}
        />
        {(form.durationType === 'timed' || form.durationType === 'concentration') && (
          <>
            <FormInput
              label="Duration Value"
              value={form.durationValue}
              onChange={(e) => patch({ durationValue: e.target.value })}
              disabled={disabled}
              placeholder="10"
            />
            <FormSelect
              label="Duration Unit"
              value={form.durationUnit}
              onChange={(e) => patch({ durationUnit: e.target.value as SpellForm['durationUnit'] })}
              options={DURATION_UNITS.map((u) => ({ value: u, label: u }))}
            />
          </>
        )}
      </div>

      <MarkdownEditor
        label="Description"
        value={form.description}
        onChange={(v) => patch({ description: v })}
        placeholder="Describe this spell..."
        error={errors.description}
        disabled={disabled}
        minHeight="220px"
      />
    </div>
  );
}
```

- [ ] **Step 5: Write `app/components/wiki/spells/SpellAdditionalInfoSection.tsx`**

```tsx
import { FormSelect } from '~/components/FormSelect';
import { FormInput } from '~/components/FormInput';
import { SPELL_CLASSES, SAVE_ABILITIES, AOE_SHAPES, SCALING_TYPES } from '~/constants/spells';
import type { SpellForm } from './spellForm';

interface Props {
  form: SpellForm;
  patch: (partial: Partial<SpellForm>) => void;
  disabled?: boolean;
}

export function SpellAdditionalInfoSection({ form, patch, disabled }: Props) {
  const toggleClass = (c: string) =>
    patch({
      classes: form.classes.includes(c)
        ? form.classes.filter((x) => x !== c)
        : [...form.classes, c],
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => patch({ ritual: !form.ritual })}
          className={`px-3 py-2 rounded-lg border text-xs font-bold ${
            form.ritual
              ? 'bg-blue-600/25 border-blue-500/70 text-blue-300'
              : 'bg-white/[0.04] border-white/10 text-slate-500'
          }`}
        >
          Ritual
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => patch({ scalingEnabled: !form.scalingEnabled })}
          className={`px-3 py-2 rounded-lg border text-xs font-bold ${
            form.scalingEnabled
              ? 'bg-blue-600/25 border-blue-500/70 text-blue-300'
              : 'bg-white/[0.04] border-white/10 text-slate-500'
          }`}
        >
          Scales at Higher Levels
        </button>
        {form.scalingEnabled && (
          <FormSelect
            label=""
            value={form.scalingType}
            onChange={(e) => patch({ scalingType: e.target.value as SpellForm['scalingType'] })}
            options={SCALING_TYPES.map((s) => ({ value: s, label: s }))}
          />
        )}
      </div>

      <fieldset className="border-none p-0 m-0">
        <legend className="block text-xs font-semibold text-slate-400 mb-2">
          Available For Class(es)
        </legend>
        <div className="flex flex-wrap gap-2">
          {SPELL_CLASSES.map((c) => (
            <button
              key={c}
              type="button"
              disabled={disabled}
              onClick={() => toggleClass(c)}
              className={`px-3 py-1.5 rounded-full border text-xs font-medium ${
                form.classes.includes(c)
                  ? 'bg-blue-600/20 border-blue-500/60 text-blue-300'
                  : 'bg-white/[0.04] border-white/10 text-slate-500'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <FormSelect
          label="Attack / Save"
          value={form.attackKind}
          onChange={(e) => patch({ attackKind: e.target.value as SpellForm['attackKind'] })}
          options={[
            { value: 'none', label: 'None' },
            { value: 'attack', label: 'Attack' },
            { value: 'save', label: 'Save' },
          ]}
        />
        {form.attackKind === 'attack' && (
          <FormSelect
            label="Attack Type"
            value={form.attackType}
            onChange={(e) => patch({ attackType: e.target.value as SpellForm['attackType'] })}
            options={[
              { value: 'melee', label: 'Melee' },
              { value: 'ranged', label: 'Ranged' },
            ]}
          />
        )}
        {form.attackKind === 'save' && (
          <FormSelect
            label="Save Ability"
            value={form.saveAbility}
            onChange={(e) => patch({ saveAbility: e.target.value as SpellForm['saveAbility'] })}
            options={SAVE_ABILITIES.map((a) => ({ value: a, label: a.toUpperCase() }))}
          />
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <FormSelect
          label="Area Shape"
          value={form.aoeShape}
          onChange={(e) => patch({ aoeShape: e.target.value as SpellForm['aoeShape'] })}
          options={AOE_SHAPES.map((s) => ({ value: s, label: s }))}
        />
        {form.aoeShape !== 'none' && (
          <FormInput
            label="Area Size (ft.)"
            value={form.aoeSize}
            onChange={(e) => patch({ aoeSize: e.target.value })}
            disabled={disabled}
            placeholder="20"
          />
        )}
        {(form.aoeShape === 'line' || form.aoeShape === 'cylinder') && (
          <FormInput
            label="Area Width (ft.)"
            value={form.aoeWidth}
            onChange={(e) => patch({ aoeWidth: e.target.value })}
            disabled={disabled}
            placeholder="5"
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add app/components/wiki/spells/spellForm.ts tests/components/wiki/spells/spellForm.test.ts app/components/wiki/spells/SpellBasicInfoSection.tsx app/components/wiki/spells/SpellAdditionalInfoSection.tsx
git commit -m "feat(spells): add spell form model and basic/additional form sections"
```

---

## Task 10: SpellModal (assembles the create/edit form + duplicate)

**Files:**

- Create: `app/components/wiki/spells/SpellModal.tsx`

**Interfaces:**

- Consumes: hooks from Task 5, form helpers (Task 9), sub-editors (Task 8), `TagAutocompleteInput`, `PixelButton`, `useModalForm`, `useCampaign`.
- Produces: `SpellModal` (`{ isOpen, onClose, campaignId, spellId? }`). SRD spells render read-only with a **Duplicate** action; homebrew spells are editable with save + two-step delete.

- [ ] **Step 1: Write `app/components/wiki/spells/SpellModal.tsx`**

```tsx
import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { PixelButton } from '~/components/PixelButton';
import { TagAutocompleteInput } from '~/components/shared/TagAutocompleteInput';
import { useModalForm } from '~/hooks/useModalForm';
import {
  useSpell,
  useCreateSpell,
  useUpdateSpell,
  useDeleteSpell,
  useDuplicateSpell,
} from '~/hooks/useSpells';
import { SpellForm, EMPTY_SPELL_FORM, spellToForm, formToInput } from './spellForm';
import { SpellBasicInfoSection } from './SpellBasicInfoSection';
import { SpellAdditionalInfoSection } from './SpellAdditionalInfoSection';
import { SpellModifiersEditor } from './SpellModifiersEditor';
import { SpellConditionsEditor } from './SpellConditionsEditor';
import { SpellHigherLevelsEditor } from './SpellHigherLevelsEditor';
import { SpellWindow } from './SpellWindow';

interface SpellModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  spellId?: string;
}

interface FieldErrors {
  name?: string;
  description?: string;
}

export function SpellModal({ isOpen, onClose, campaignId, spellId }: SpellModalProps) {
  const isEdit = !!spellId;
  const { spell: existing, isLoading: isFetching } = useSpell(spellId ?? '', campaignId);
  const { create, isLoading: isCreating } = useCreateSpell();
  const { update, isLoading: isUpdating } = useUpdateSpell();
  const { remove, isLoading: isDeleting } = useDeleteSpell();
  const { duplicate, isLoading: isDuplicating } = useDuplicateSpell();

  const [form, setForm] = useState<SpellForm>(EMPTY_SPELL_FORM);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const patch = useCallback((partial: Partial<SpellForm>) => {
    setForm((prev) => ({ ...prev, ...partial }));
  }, []);

  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};
    if (!form.name.trim()) errors.name = 'Name is required';
    if (!form.description.trim()) errors.description = 'Description is required';
    return errors;
  }, [form.name, form.description]);

  const { fieldErrors, runValidation } = useModalForm({
    isOpen,
    onClose,
    recordId: spellId,
    isEdit,
    record: existing,
    reset: () => {
      setForm(EMPTY_SPELL_FORM);
      setError(null);
      setShowDeleteConfirm(false);
    },
    populate: (spell) => setForm(spellToForm(spell)),
    validate,
  });

  const isSrd = existing?.source === 'srd';
  const isReadOnly = isEdit && isSrd;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    const errors = runValidation();
    if (Object.keys(errors).length > 0) return;
    setError(null);

    let success = false;
    if (isEdit && spellId) {
      const result = await update(formToInput(form, campaignId, spellId));
      success = !!result;
    } else {
      const result = await create(formToInput(form, campaignId));
      success = !!result;
    }
    if (success) onClose();
    else setError(`Failed to ${isEdit ? 'update' : 'create'} spell. Please try again.`);
  };

  const handleDuplicate = async () => {
    if (!spellId) return;
    setError(null);
    const result = await duplicate({ id: spellId, campaignId });
    if (result) onClose();
    else setError('Failed to duplicate spell. Please try again.');
  };

  const handleDelete = async () => {
    if (!spellId) return;
    setError(null);
    const result = await remove({ id: spellId, campaignId });
    if (result) onClose();
    else {
      setError('Failed to delete spell. Please try again.');
      setShowDeleteConfirm(false);
    }
  };

  if (!isOpen) return null;

  const isLoadingSpell = !!(isEdit && isFetching);
  const isSaving = isCreating || isUpdating;
  const isDisabled = isLoadingSpell || isSaving || isDeleting || isDuplicating;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="spell-modal-title"
        className="w-full h-full max-w-[90vw] max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="spell-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            {isReadOnly ? 'SRD Spell (read-only)' : isEdit ? 'Edit Spell' : 'Create Spell'}
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

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 min-h-0">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs font-semibold">
              {error}
            </div>
          )}

          {isLoadingSpell ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500 animate-pulse">Loading spell...</p>
            </div>
          ) : isReadOnly && existing ? (
            <div className="rounded-lg border border-white/[0.05] overflow-hidden">
              <SpellWindow spell={existing} />
            </div>
          ) : (
            <>
              <SpellBasicInfoSection
                form={form}
                patch={patch}
                disabled={isDisabled}
                errors={fieldErrors}
              />
              <SpellAdditionalInfoSection form={form} patch={patch} disabled={isDisabled} />
              <SpellModifiersEditor
                value={form.modifiers}
                onChange={(v) => patch({ modifiers: v })}
                disabled={isDisabled}
              />
              <SpellConditionsEditor
                value={form.conditions}
                onChange={(v) => patch({ conditions: v })}
                disabled={isDisabled}
              />
              <SpellHigherLevelsEditor
                value={form.higherLevels}
                onChange={(v) => patch({ higherLevels: v })}
                disabled={isDisabled}
              />
              <TagAutocompleteInput
                campaignId={campaignId}
                selectedTags={form.tags}
                onTagsChange={(tags) => patch({ tags })}
                disabled={isDisabled}
              />
            </>
          )}
        </div>

        <footer className="flex items-center justify-between px-4 sm:px-6 py-4 border-t border-white/[0.07] shrink-0 gap-3">
          {isEdit && !isSrd && (
            <div className="flex items-center gap-2">
              {showDeleteConfirm ? (
                <>
                  <span className="text-xs text-rose-400 font-semibold">Delete this spell?</span>
                  <PixelButton
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isDisabled}
                  >
                    {isDeleting ? 'Deleting...' : 'Confirm'}
                  </PixelButton>
                  <PixelButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDisabled}
                  >
                    Cancel
                  </PixelButton>
                </>
              ) : (
                <PixelButton
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isDisabled}
                >
                  Delete
                </PixelButton>
              )}
            </div>
          )}
          <div className="flex items-center gap-3 ml-auto">
            <PixelButton type="button" variant="ghost" onClick={onClose} disabled={isDisabled}>
              Cancel
            </PixelButton>
            {isReadOnly ? (
              <PixelButton type="button" onClick={handleDuplicate} disabled={isDisabled}>
                {isDuplicating ? 'Duplicating...' : 'Duplicate to Homebrew'}
              </PixelButton>
            ) : (
              <PixelButton type="submit" disabled={isDisabled}>
                {isSaving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Spell'}
              </PixelButton>
            )}
          </div>
        </footer>
      </form>
    </div>,
    document.body
  );
}
```

- [ ] **Step 2: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add app/components/wiki/spells/SpellModal.tsx
git commit -m "feat(spells): add SpellModal with full parity form and duplicate action"
```

---

## Task 11: SpellsPanel + filter bar + wiki registration

**Files:**

- Create: `app/components/wiki/spells/SpellsFilterBar.tsx`
- Create: `app/components/wiki/spells/SpellsPanel.tsx`
- Modify: `app/components/wiki/WikiPanel.tsx`

**Interfaces:**

- Consumes: `WikiCategoryHeader`, `WikiFilterBar`, `SpellCard`, `SpellModal`, `SpellViewModal`, `useSpells`, `useCampaign`, constants.
- Produces: `SpellsPanel` (`{ onBack: () => void }`), registered as the `spells` wiki category.

- [ ] **Step 1: Write `app/components/wiki/spells/SpellsFilterBar.tsx`**

Wraps the shared `WikiFilterBar` (search + tags + create button) and adds level/school selects below it.

```tsx
import { WikiFilterBar } from '~/components/wiki/shared/WikiFilterBar';
import { SPELL_SCHOOLS, formatSpellLevel, formatSchool } from '~/constants/spells';
import type { SpellSchool } from '~/types/spell';

interface SpellsFilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  onCreateClick?: () => void;
  campaignId: string;
  filterTags: string[];
  onFilterTagsChange: (tags: string[]) => void;
  level: number | undefined;
  onLevelChange: (level: number | undefined) => void;
  school: SpellSchool | undefined;
  onSchoolChange: (school: SpellSchool | undefined) => void;
}

export function SpellsFilterBar(props: SpellsFilterBarProps) {
  return (
    <div>
      <WikiFilterBar
        search={props.search}
        onSearchChange={props.onSearchChange}
        onCreateClick={props.onCreateClick}
        campaignId={props.campaignId}
        filterTags={props.filterTags}
        onFilterTagsChange={props.onFilterTagsChange}
        searchPlaceholder="Search spells..."
        showSessionFilter={false}
        showVisibilityFilter={false}
        visibility="all"
        onVisibilityChange={() => {}}
      />
      <div className="flex gap-2 px-3 pb-3 bg-[#0D1117] border-b border-white/[0.07]">
        <div className="flex-1">
          <label htmlFor="spell-level-filter" className="sr-only">
            Filter by level
          </label>
          <select
            id="spell-level-filter"
            value={props.level ?? ''}
            onChange={(e) =>
              props.onLevelChange(e.target.value === '' ? undefined : Number(e.target.value))
            }
            className="w-full bg-[#080A12] border border-white/[0.07] rounded px-2 py-1.5 font-sans font-semibold text-[11px] text-slate-300 outline-none focus:border-blue-500/50"
          >
            <option value="">All Levels</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>
                {formatSpellLevel(n)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="spell-school-filter" className="sr-only">
            Filter by school
          </label>
          <select
            id="spell-school-filter"
            value={props.school ?? ''}
            onChange={(e) =>
              props.onSchoolChange((e.target.value || undefined) as SpellSchool | undefined)
            }
            className="w-full bg-[#080A12] border border-white/[0.07] rounded px-2 py-1.5 font-sans font-semibold text-[11px] text-slate-300 outline-none focus:border-blue-500/50"
          >
            <option value="">All Schools</option>
            {SPELL_SCHOOLS.map((s) => (
              <option key={s} value={s}>
                {formatSchool(s)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `app/components/wiki/spells/SpellsPanel.tsx`**

```tsx
import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { SpellsFilterBar } from './SpellsFilterBar';
import { SpellCard } from './SpellCard';
import { SpellModal } from './SpellModal';
import { SpellViewModal } from './SpellViewModal';
import { useSpells } from '~/hooks/useSpells';
import { useCampaign } from '~/hooks/useCampaigns';
import type { SpellListItem, SpellSchool } from '~/types/spell';

interface SpellsPanelProps {
  onBack: () => void;
}

export function SpellsPanel({ onBack }: SpellsPanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const [search, setSearch] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [level, setLevel] = useState<number | undefined>(undefined);
  const [school, setSchool] = useState<SpellSchool | undefined>(undefined);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSpellId, setSelectedSpellId] = useState<string | undefined>();
  const [viewSpellId, setViewSpellId] = useState<string | undefined>();

  const { spells, isLoading, error } = useSpells(campaignId, {
    search: search || undefined,
    tags: filterTags.length > 0 ? filterTags : undefined,
    level,
    school,
  });

  const handleCreateClick = () => {
    setSelectedSpellId(undefined);
    setIsModalOpen(true);
  };
  const handleSpellClick = (spell: SpellListItem) => {
    if (spell.canEdit) {
      setSelectedSpellId(spell.id);
      setIsModalOpen(true);
    } else {
      setViewSpellId(spell.id);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#080A12]">
      <WikiCategoryHeader title="Spells" onBack={onBack} />
      <SpellsFilterBar
        search={search}
        onSearchChange={setSearch}
        onCreateClick={isGM ? handleCreateClick : undefined}
        campaignId={campaignId}
        filterTags={filterTags}
        onFilterTagsChange={setFilterTags}
        level={level}
        onLevelChange={setLevel}
        school={school}
        onSchoolChange={setSchool}
      />

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
            Loading spells...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
        </div>
      ) : spells.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
            <Sparkles className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans font-semibold text-xs text-slate-500">
            No spells found matching your filters.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col">
            {spells.map((spell) => (
              <SpellCard key={spell.id} spell={spell} onClick={handleSpellClick} />
            ))}
          </div>
        </div>
      )}

      {isGM && (
        <SpellModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedSpellId(undefined);
          }}
          campaignId={campaignId}
          spellId={selectedSpellId}
        />
      )}
      {viewSpellId && (
        <SpellViewModal
          isOpen={!!viewSpellId}
          onClose={() => setViewSpellId(undefined)}
          spellId={viewSpellId}
          campaignId={campaignId}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Register the category in `app/components/wiki/WikiPanel.tsx`**

Add `Sparkles` to the lucide import (line 3-14), add `SpellsPanel` import after the `RulesPanel` import (line 17), add `'spells'` to `WikiCategoryId` (line 27-37), add to `WIKI_CATEGORIES` after the `rules` entry (line 51), and add a render branch after the `rules` branch (line 99).

```tsx
// import (add to the lucide-react import list)
  Sparkles,
// import (after RulesPanel import)
import { SpellsPanel } from './spells/SpellsPanel';
// WikiCategoryId union (add)
  | 'spells'
// WIKI_CATEGORIES (add after the rules entry)
  { id: 'spells', label: 'Spells', icon: Sparkles },
// render branch (add after the `selectedCategory === 'rules' ? <RulesPanel .../> :` line)
      ) : selectedCategory === 'spells' ? (
        <SpellsPanel onBack={() => setSelectedCategory(null)} />
```

- [ ] **Step 4: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add app/components/wiki/spells/SpellsFilterBar.tsx app/components/wiki/spells/SpellsPanel.tsx app/components/wiki/WikiPanel.tsx
git commit -m "feat(spells): add SpellsPanel with level/school filters and register wiki category"
```

- [ ] **Step 5: Manual smoke check**

Run the app (`/run` skill or `npm run dev`), open a campaign with SRD spells (seeded in Part C) or create a homebrew spell as GM: verify the Spells category appears in the Wiki inspector tab, the create form saves, an SRD spell opens read-only with a Duplicate button, and a player account sees spells read-only.

---

## Part B Self-Review Gate

- [ ] `npm test` green (new: `spellFormat.test.ts`, `spellForm.test.ts`).
- [ ] `npm run typecheck && npm run lint` clean.
- [ ] Type names match Part A exactly (`SpellData`, `SpellListItem`, `SpellForm`, hook names `useSpells`/`useSpell`/`useCreateSpell`/`useUpdateSpell`/`useDeleteSpell`/`useDuplicateSpell`).

**End of Part B.** Part C covers SRD data generation, the in-app importer, the campaign-creation checkbox, the SRD Licensing screen, the Python seed update, and e2e.
