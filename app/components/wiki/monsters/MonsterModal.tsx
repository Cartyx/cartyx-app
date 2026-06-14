import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Upload, Loader2 } from 'lucide-react';
import { FormInput } from '~/components/FormInput';
import { PixelButton } from '~/components/PixelButton';
import { TagAutocompleteInput } from '~/components/shared/TagAutocompleteInput';
import { useMonster, useMonsterMutations } from '~/hooks/useMonsters';
import { useCampaign } from '~/hooks/useCampaigns';
import { uploadToR2 } from '~/utils/uploadToR2';
import type { MonsterData, MonsterFeature, MonsterLink } from '~/types/monster';
import type { MonsterSize, FeatureSection } from '~/types/schemas/monsters';
import { MONSTER_SIZES, FEATURE_SECTIONS } from '~/types/schemas/monsters';

interface MonsterModalProps {
  isOpen: boolean;
  monsterId?: string;
  campaignId: string;
  onClose: () => void;
}

type Tab = 'stats' | 'features' | 'notes' | 'links';

const EMPTY: Partial<MonsterData> = {
  name: '',
  size: 'medium',
  type: '',
  subtype: '',
  alignment: '',
  armorClass: 10,
  armorClassNote: '',
  hitPoints: { average: 1, formula: '' },
  initiativeMod: 0,
  initiativePassive: 10,
  speeds: [{ kind: 'walk', feet: 30, notes: '' }],
  abilities: {
    str: { score: 10, mod: 0, save: 0 },
    dex: { score: 10, mod: 0, save: 0 },
    con: { score: 10, mod: 0, save: 0 },
    int: { score: 10, mod: 0, save: 0 },
    wis: { score: 10, mod: 0, save: 0 },
    cha: { score: 10, mod: 0, save: 0 },
  },
  resistances: [],
  immunities: [],
  vulnerabilities: [],
  conditionImmunities: [],
  passivePerception: 10,
  languages: [],
  cr: { value: 0, xp: 0, proficiencyBonus: 2 },
  features: [],
  picture: '',
  links: [],
  gmNotes: '',
  tags: [],
  sessionId: null,
  color: '#9ca3af',
};

export function MonsterModal({ isOpen, monsterId, campaignId, onClose }: MonsterModalProps) {
  const isEdit = !!monsterId;
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;
  const { data: existing } = useMonster(campaignId, monsterId ?? null, isGM);
  const { create, update, remove } = useMonsterMutations(campaignId);

  const [tab, setTab] = useState<Tab>('stats');
  const [draft, setDraft] = useState<Partial<MonsterData>>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing data when the modal opens for an edit.
  useEffect(() => {
    if (!isOpen) return;
    if (existing) setDraft(existing);
    else setDraft(EMPTY);
    setTab('stats');
  }, [isOpen, existing]);

  // Esc to dismiss.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const sessions = campaign?.sessions ?? [];

  const patch = (p: Partial<MonsterData>) => setDraft((cur) => ({ ...cur, ...p }));

  const handleSave = async () => {
    if (!draft.name?.trim()) return;
    setSaving(true);
    try {
      // Build the typed payload from the draft. Defaults fill anything the
      // GM hasn't touched.
      const payload = { ...EMPTY, ...draft } as MonsterData;
      const dto = {
        name: payload.name,
        size: payload.size,
        type: payload.type,
        subtype: payload.subtype,
        alignment: payload.alignment,
        armorClass: payload.armorClass,
        armorClassNote: payload.armorClassNote,
        hitPoints: payload.hitPoints,
        initiativeMod: payload.initiativeMod,
        initiativePassive: payload.initiativePassive,
        speeds: payload.speeds,
        abilities: payload.abilities,
        skills: payload.skills ?? [],
        resistances: payload.resistances,
        immunities: payload.immunities,
        vulnerabilities: payload.vulnerabilities,
        conditionImmunities: payload.conditionImmunities,
        senses: payload.senses ?? [],
        passivePerception: payload.passivePerception,
        languages: payload.languages,
        cr: payload.cr,
        features: payload.features,
        picture: payload.picture,
        pictureCrop: payload.pictureCrop ?? null,
        links: payload.links,
        gmNotes: payload.gmNotes,
        tags: payload.tags ?? [],
        sessionId: payload.sessionId ?? null,
        color: payload.color,
      };
      if (isEdit && monsterId) {
        await update.mutateAsync({ id: monsterId, ...dto });
      } else {
        await create.mutateAsync(dto);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || !monsterId) return;
    if (!confirm(`Delete "${draft.name}"? This cannot be undone.`)) return;
    await remove.mutateAsync(monsterId);
    onClose();
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { publicUrl } = await uploadToR2(file, 'uploads/monsters');
      patch({ picture: publicUrl });
    } finally {
      setUploading(false);
    }
  };

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
        aria-labelledby="monster-modal-title"
        className="flex h-full max-h-[90vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0D1117] shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-4 py-4 sm:px-6">
          <h2
            id="monster-modal-title"
            className="font-sans text-sm font-bold uppercase tracking-widest text-blue-400"
          >
            {isEdit ? 'Edit Monster' : 'New Monster'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-500 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Tabs */}
        <div className="flex shrink-0 border-b border-white/[0.07] bg-[#080A12]" role="tablist">
          {(
            [
              ['stats', 'Stats'],
              ['features', 'Features'],
              ['notes', 'Notes'],
              ['links', 'Links'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={[
                'px-4 py-2.5 font-sans text-xs font-semibold uppercase tracking-wide transition-colors',
                tab === id
                  ? 'border-b-2 border-blue-400 text-blue-300'
                  : 'text-slate-500 hover:text-slate-300',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {tab === 'stats' && (
            <StatsTab
              draft={draft}
              patch={patch}
              sessions={sessions}
              fileInputRef={fileInputRef}
              onFile={handleFile}
              uploading={uploading}
            />
          )}
          {tab === 'features' && <FeaturesTab draft={draft} patch={patch} />}
          {tab === 'notes' && (
            <div className="space-y-2">
              <label
                htmlFor="monster-gm-notes"
                className="block font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-400"
              >
                GM Notes (private)
              </label>
              <textarea
                id="monster-gm-notes"
                value={draft.gmNotes ?? ''}
                onChange={(e) => patch({ gmNotes: e.target.value })}
                rows={20}
                className="w-full rounded border border-white/[0.07] bg-[#080A12] p-3 font-sans text-xs text-slate-200 outline-none focus:border-blue-500/50"
                placeholder="Lore, hooks, tactics, anything only you should see..."
              />
            </div>
          )}
          {tab === 'links' && <LinksTab draft={draft} patch={patch} />}
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-white/[0.07] px-4 py-3 sm:px-6">
          {isEdit ? (
            <PixelButton variant="danger" size="sm" onClick={handleDelete}>
              Delete
            </PixelButton>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <PixelButton variant="secondary" onClick={onClose}>
              Cancel
            </PixelButton>
            <PixelButton
              variant="primary"
              disabled={saving || !draft.name?.trim()}
              onClick={handleSave}
            >
              {saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            </PixelButton>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Stats tab — taxonomy, AC/HP/initiative/speed, abilities, CR, picture, color,
// tags, session pin, comma-separated resistance/immunity lists.
// ---------------------------------------------------------------------------

interface StatsTabProps {
  draft: Partial<MonsterData>;
  patch: (p: Partial<MonsterData>) => void;
  sessions: NonNullable<ReturnType<typeof useCampaign>['campaign']>['sessions'];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFile: (f: File | undefined) => void;
  uploading: boolean;
}

function StatsTab({ draft, patch, sessions, fileInputRef, onFile, uploading }: StatsTabProps) {
  const ab = draft.abilities ?? EMPTY.abilities!;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* LEFT column */}
      <div className="space-y-3">
        <FormInput
          label="Name"
          value={draft.name ?? ''}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Goblin"
          required
        />
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Size"
            value={draft.size ?? 'medium'}
            onChange={(v) => patch({ size: v as MonsterSize })}
            options={MONSTER_SIZES.map((s) => [s, s[0]!.toUpperCase() + s.slice(1)])}
          />
          <FormInput
            label="Type"
            value={draft.type ?? ''}
            onChange={(e) => patch({ type: e.target.value })}
            placeholder="Humanoid"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FormInput
            label="Subtype"
            value={draft.subtype ?? ''}
            onChange={(e) => patch({ subtype: e.target.value })}
            placeholder="Goblinoid"
          />
          <FormInput
            label="Alignment"
            value={draft.alignment ?? ''}
            onChange={(e) => patch({ alignment: e.target.value })}
            placeholder="Neutral Evil"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="AC"
            value={draft.armorClass ?? 10}
            onChange={(v) => patch({ armorClass: v })}
          />
          <NumberField
            label="HP avg"
            value={draft.hitPoints?.average ?? 1}
            onChange={(v) =>
              patch({ hitPoints: { ...(draft.hitPoints ?? { formula: '' }), average: v } })
            }
          />
          <FormInput
            label="HP formula"
            value={draft.hitPoints?.formula ?? ''}
            onChange={(e) =>
              patch({
                hitPoints: { ...(draft.hitPoints ?? { average: 1 }), formula: e.target.value },
              })
            }
            placeholder="2d6"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="Init mod"
            value={draft.initiativeMod ?? 0}
            onChange={(v) => patch({ initiativeMod: v })}
          />
          <NumberField
            label="Init passive"
            value={draft.initiativePassive ?? 10}
            onChange={(v) => patch({ initiativePassive: v })}
          />
          <NumberField
            label="Passive Perception"
            value={draft.passivePerception ?? 10}
            onChange={(v) => patch({ passivePerception: v })}
          />
        </div>

        {/* Abilities */}
        <fieldset>
          <legend className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Ability Scores
          </legend>
          <div className="grid grid-cols-6 gap-1">
            {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((k) => (
              <div
                key={k}
                className="flex flex-col items-center gap-0.5 rounded border border-white/[0.05] p-1.5"
              >
                <span className="font-sans text-[10px] font-bold uppercase text-slate-500">
                  {k}
                </span>
                <input
                  type="number"
                  value={ab[k].score}
                  onChange={(e) =>
                    patch({
                      abilities: {
                        ...ab,
                        [k]: { ...ab[k], score: Number(e.target.value) },
                      },
                    })
                  }
                  className="w-full bg-transparent text-center font-sans text-sm font-semibold text-slate-200 outline-none"
                />
                <div className="flex w-full items-center justify-between gap-1 text-[10px]">
                  <input
                    type="number"
                    value={ab[k].mod}
                    onChange={(e) =>
                      patch({
                        abilities: {
                          ...ab,
                          [k]: { ...ab[k], mod: Number(e.target.value) },
                        },
                      })
                    }
                    className="w-full bg-transparent text-center font-mono text-slate-400 outline-none"
                    aria-label={`${k} modifier`}
                  />
                  <span className="text-slate-700">·</span>
                  <input
                    type="number"
                    value={ab[k].save}
                    onChange={(e) =>
                      patch({
                        abilities: {
                          ...ab,
                          [k]: { ...ab[k], save: Number(e.target.value) },
                        },
                      })
                    }
                    className="w-full bg-transparent text-center font-mono text-emerald-400 outline-none"
                    aria-label={`${k} save`}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="font-sans mt-1 text-[10px] text-slate-600">Score · mod · save</p>
        </fieldset>
      </div>

      {/* RIGHT column */}
      <div className="space-y-3">
        {/* Picture */}
        <div>
          <span className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Picture
          </span>
          <div className="flex items-center gap-3">
            <div
              className="flex h-20 w-20 items-center justify-center overflow-hidden rounded border border-white/[0.07] bg-black/40"
              style={!draft.picture ? { backgroundColor: draft.color } : undefined}
            >
              {draft.picture ? (
                <img src={draft.picture} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-sans text-2xl font-bold text-white/70">
                  {(draft.name ?? '?').trim().charAt(0).toUpperCase() || '?'}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <PixelButton
                variant="secondary"
                size="sm"
                icon={
                  uploading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )
                }
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </PixelButton>
              {draft.picture && (
                <PixelButton variant="ghost" size="sm" onClick={() => patch({ picture: '' })}>
                  Clear
                </PixelButton>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        {/* Color + CR */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label
              htmlFor="monster-ring-color"
              className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-400"
            >
              Ring color
            </label>
            <input
              id="monster-ring-color"
              type="color"
              value={draft.color ?? '#9ca3af'}
              onChange={(e) => patch({ color: e.target.value })}
              className="h-9 w-full rounded border border-white/[0.07] bg-transparent"
            />
          </div>
          <NumberField
            label="CR"
            step={0.125}
            value={draft.cr?.value ?? 0}
            onChange={(v) =>
              patch({ cr: { ...(draft.cr ?? { xp: 0, proficiencyBonus: 2 }), value: v } })
            }
          />
          <NumberField
            label="XP"
            value={draft.cr?.xp ?? 0}
            onChange={(v) =>
              patch({ cr: { ...(draft.cr ?? { value: 0, proficiencyBonus: 2 }), xp: v } })
            }
          />
        </div>

        {/* Session pin */}
        <div>
          <label
            htmlFor="monster-session"
            className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-400"
          >
            Pin to session (optional)
          </label>
          <select
            id="monster-session"
            value={draft.sessionId ?? ''}
            onChange={(e) => patch({ sessionId: e.target.value || null })}
            className="w-full rounded border border-white/[0.07] bg-[#080A12] px-2 py-2 font-sans text-xs text-slate-200 outline-none focus:border-blue-500/50"
          >
            <option value="">— None —</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                #{s.number} {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Tags */}
        <div>
          <label
            htmlFor="monster-tags"
            className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-400"
          >
            Tags
          </label>
          <TagAutocompleteInput
            id="monster-tags"
            campaignId={draft.campaignId ?? ''}
            selectedTags={draft.tags ?? []}
            onTagsChange={(t) => patch({ tags: t })}
          />
        </div>

        {/* Lists */}
        <CSVField
          label="Resistances"
          value={draft.resistances ?? []}
          onChange={(v) => patch({ resistances: v })}
          placeholder="cold, fire, slashing"
        />
        <CSVField
          label="Immunities (damage)"
          value={draft.immunities ?? []}
          onChange={(v) => patch({ immunities: v })}
          placeholder="poison, thunder"
        />
        <CSVField
          label="Vulnerabilities"
          value={draft.vulnerabilities ?? []}
          onChange={(v) => patch({ vulnerabilities: v })}
          placeholder="radiant"
        />
        <CSVField
          label="Condition Immunities"
          value={draft.conditionImmunities ?? []}
          onChange={(v) => patch({ conditionImmunities: v })}
          placeholder="charmed, frightened"
        />
        <CSVField
          label="Languages"
          value={draft.languages ?? []}
          onChange={(v) => patch({ languages: v })}
          placeholder="Common, Goblin"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Features tab
// ---------------------------------------------------------------------------

function FeaturesTab({
  draft,
  patch,
}: {
  draft: Partial<MonsterData>;
  patch: (p: Partial<MonsterData>) => void;
}) {
  const features = useMemo(() => draft.features ?? [], [draft.features]);
  const addFeature = () =>
    patch({
      features: [...features, { section: 'traits', name: '', description: '' }],
    });
  const updateFeature = (i: number, f: MonsterFeature) =>
    patch({ features: features.map((x, idx) => (idx === i ? f : x)) });
  const removeFeature = (i: number) => patch({ features: features.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-3">
      {features.length === 0 && (
        <p className="font-sans text-xs text-slate-500">
          No features yet. Add traits, actions, reactions, etc.
        </p>
      )}
      {features.map((f, i) => (
        <div key={i} className="rounded border border-white/[0.07] bg-[#080A12] p-3">
          <div className="mb-2 grid grid-cols-[160px_1fr_auto] gap-2">
            <SelectField
              label="Section"
              value={f.section}
              onChange={(v) => updateFeature(i, { ...f, section: v as FeatureSection })}
              options={FEATURE_SECTIONS.map((s) => [
                s,
                s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
              ])}
            />
            <FormInput
              label="Name"
              value={f.name}
              onChange={(e) => updateFeature(i, { ...f, name: e.target.value })}
              placeholder="Multiattack"
            />
            <button
              type="button"
              aria-label="Remove feature"
              onClick={() => removeFeature(i)}
              className="mt-5 flex h-9 w-9 items-center justify-center rounded text-rose-400 hover:bg-rose-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <textarea
            value={f.description}
            onChange={(e) => updateFeature(i, { ...f, description: e.target.value })}
            rows={3}
            placeholder="The goblin makes two attacks…"
            className="w-full rounded border border-white/[0.07] bg-[#0D1117] p-2 font-sans text-xs text-slate-200 outline-none focus:border-blue-500/50"
          />
        </div>
      ))}
      <PixelButton
        variant="secondary"
        size="sm"
        icon={<Plus className="h-3.5 w-3.5" />}
        onClick={addFeature}
      >
        Add feature
      </PixelButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Links tab
// ---------------------------------------------------------------------------

function LinksTab({
  draft,
  patch,
}: {
  draft: Partial<MonsterData>;
  patch: (p: Partial<MonsterData>) => void;
}) {
  const links = useMemo(() => draft.links ?? [], [draft.links]);
  const add = () => patch({ links: [...links, { name: '', url: '' }] });
  const update = (i: number, l: MonsterLink) =>
    patch({ links: links.map((x, idx) => (idx === i ? l : x)) });
  const remove = (i: number) => patch({ links: links.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-3">
      {links.length === 0 && (
        <p className="font-sans text-xs text-slate-500">
          No links yet. Add references to D&amp;D Beyond, your wiki, etc.
        </p>
      )}
      {links.map((l, i) => (
        <div key={i} className="grid grid-cols-[180px_1fr_auto] gap-2">
          <FormInput
            value={l.name}
            onChange={(e) => update(i, { ...l, name: e.target.value })}
            placeholder="D&D Beyond"
          />
          <FormInput
            type="url"
            value={l.url}
            onChange={(e) => update(i, { ...l, url: e.target.value })}
            placeholder="https://..."
          />
          <button
            type="button"
            aria-label="Remove link"
            onClick={() => remove(i)}
            className="flex h-9 w-9 items-center justify-center rounded text-rose-400 hover:bg-rose-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <PixelButton
        variant="secondary"
        size="sm"
        icon={<Plus className="h-3.5 w-3.5" />}
        onClick={add}
      >
        Add link
      </PixelButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small field helpers
// ---------------------------------------------------------------------------

function NumberField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div>
      <label className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </label>
      <input
        type="number"
        value={value}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-white/[0.07] bg-[#080A12] px-2 py-1.5 font-sans text-xs text-slate-200 outline-none focus:border-blue-500/50"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div>
      <label className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-white/[0.07] bg-[#080A12] px-2 py-1.5 font-sans text-xs text-slate-200 outline-none focus:border-blue-500/50"
      >
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CSVField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [raw, setRaw] = useState(value.join(', '));
  useEffect(() => {
    setRaw(value.join(', '));
  }, [value]);
  return (
    <div>
      <label className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </label>
      <input
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          );
        }}
        placeholder={placeholder}
        className="w-full rounded border border-white/[0.07] bg-[#080A12] px-2 py-1.5 font-sans text-xs text-slate-200 outline-none focus:border-blue-500/50"
      />
    </div>
  );
}
