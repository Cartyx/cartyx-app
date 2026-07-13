/* eslint-disable no-console */
/**
 * Generate committed SRD 5.2.1 data modules (spells/races/rules JSON) from the
 * vendored CC-BY-4.0 sources under docs/srd/. Run: `npm run srd:generate`.
 * The parser is unit-tested in tests/srd/generate-srd-data.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'app', 'server', 'data', 'srd');

const SCHOOLS = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
];

export interface GeneratedSpell {
  name: string;
  description: string;
  level: number;
  school: string;
  castingTime: { value: number; unit: string; reactionCondition?: string };
  components: {
    verbal: boolean;
    somatic: boolean;
    material: boolean;
    materialDescription?: string;
  };
  range: { type: string; distance?: number };
  duration: { type: string; value?: number; unit?: string; concentration: boolean };
  ritual: boolean;
  higherLevelScaling: { enabled: boolean; type?: string };
  classes: string[];
  attackSave: { kind: string; attackType?: string; saveAbility?: string };
  modifiers: Array<{
    id: string;
    type: string;
    dice?: { count: number; sides: number };
    damageType?: string;
  }>;
  conditions: Array<{ id: string; action: string; condition: string }>;
  higherLevels: Array<{ id: string; level: number; description: string }>;
  areaOfEffect: { shape: string; size?: number; width?: number };
  tags: string[];
}

const SAVE_MAP: Record<string, string> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
};

function parseCastingTime(raw: string): GeneratedSpell['castingTime'] {
  const m = raw.match(/^(\d+)?\s*(Bonus Action|Reaction|Action|Minute|Hour)/i);
  if (!m) return { value: 1, unit: 'action' };
  const value = m[1] ? parseInt(m[1], 10) : 1;
  const word = m[2].toLowerCase();
  const unit = word.includes('bonus')
    ? 'bonus'
    : word.includes('reaction')
      ? 'reaction'
      : word.startsWith('minute')
        ? 'minute'
        : word.startsWith('hour')
          ? 'hour'
          : 'action';
  // Reaction condition is the clause after "Reaction, ".
  const reaction =
    unit === 'reaction' && /,/.test(raw)
      ? raw.replace(/^[^,]*,\s*/, '').trim() || undefined
      : undefined;
  return { value, unit, reactionCondition: reaction };
}

function parseRange(raw: string): GeneratedSpell['range'] {
  const lower = raw.toLowerCase();
  if (lower.startsWith('self')) return { type: 'self' };
  if (lower.startsWith('touch')) return { type: 'touch' };
  if (lower.startsWith('sight')) return { type: 'sight' };
  if (lower.startsWith('unlimited') || lower.startsWith('special')) return { type: 'unlimited' };
  const m = raw.match(/(\d+)\s*(?:feet|foot|ft|mile)/i);
  return m ? { type: 'ranged', distance: parseInt(m[1], 10) } : { type: 'ranged' };
}

function parseComponents(raw: string): GeneratedSpell['components'] {
  const head = raw.split('(')[0];
  const verbal = /\bV\b/.test(head);
  const somatic = /\bS\b/.test(head);
  const material = /\bM\b/.test(head);
  const mat = raw.match(/\(([^)]*)\)/);
  return {
    verbal,
    somatic,
    material,
    materialDescription: material && mat ? mat[1].trim() : undefined,
  };
}

function parseDuration(raw: string): GeneratedSpell['duration'] {
  const lower = raw.toLowerCase();
  const concentration = lower.includes('concentration');
  if (lower.includes('instantaneous')) return { type: 'instantaneous', concentration: false };
  if (lower.includes('until dispelled')) return { type: 'until-dispelled', concentration };
  const m = raw.match(/(\d+)\s*(round|minute|hour|day)/i);
  if (m) {
    return {
      type: concentration ? 'concentration' : 'timed',
      value: parseInt(m[1], 10),
      unit: m[2].toLowerCase() as GeneratedSpell['duration']['unit'],
      concentration,
    };
  }
  return { type: concentration ? 'concentration' : 'special', concentration };
}

function parseDamage(desc: string): GeneratedSpell['modifiers'] {
  const modifiers: GeneratedSpell['modifiers'] = [];
  const re = /(\d+)d(\d+)\s+(\w+)\s+damage/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(desc)) !== null) {
    const key = `${m[1]}d${m[2]}-${m[3].toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    modifiers.push({
      id: `m${i++}`,
      type: 'damage',
      dice: { count: parseInt(m[1], 10), sides: parseInt(m[2], 10) },
      damageType: m[3].toLowerCase(),
    });
  }
  return modifiers;
}

function parseAttackSave(desc: string): GeneratedSpell['attackSave'] {
  const save = desc.match(
    /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i
  );
  if (save) return { kind: 'save', saveAbility: SAVE_MAP[save[1].toLowerCase()] };
  const attack = desc.match(/(melee|ranged)\s+spell attack/i);
  if (attack) return { kind: 'attack', attackType: attack[1].toLowerCase() };
  return { kind: 'none' };
}

function parseAoe(desc: string): GeneratedSpell['areaOfEffect'] {
  let m = desc.match(/(\d+)-foot-long,?\s*(\d+)-foot-wide\s+Line/i);
  if (m) return { shape: 'line', size: parseInt(m[1], 10), width: parseInt(m[2], 10) };
  m = desc.match(/(\d+)-foot(?:-radius)?\s+(Sphere|Cone|Cube|Cylinder|Line)/i);
  if (m) return { shape: m[2].toLowerCase(), size: parseInt(m[1], 10) };
  return { shape: 'none' };
}

export function parseSpellMarkdown(md: string): GeneratedSpell[] {
  // Individual spell entries are `#### Name` blocks under "## Spell Descriptions".
  const descIdx = md.indexOf('## Spell Descriptions');
  const body = descIdx >= 0 ? md.slice(descIdx) : md;
  const blocks = body.split(/^####\s+/m).slice(1);
  const spells: GeneratedSpell[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const name = lines[0].trim();
    if (!name) continue;

    // Level/school/classes line: the first line entirely wrapped in underscores,
    // e.g. "_Level 3 Evocation (Sorcerer, Wizard)_" or "_Evocation Cantrip (Wizard)_".
    const rawLevelLine = lines.find((l) => /^_.+_$/.test(l.trim()));
    if (!rawLevelLine) continue;
    const levelLine = rawLevelLine.trim().replace(/^_|_$/g, '').trim();

    const classMatch = levelLine.match(/\(([^)]*)\)\s*$/);
    const classes = classMatch
      ? classMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter((c) => c && c.toLowerCase() !== 'ritual')
      : [];
    const levelHead = levelLine
      .replace(/\([^)]*\)\s*$/, '')
      .trim()
      .toLowerCase();
    let level = 0;
    const lm = levelHead.match(/level\s+(\d)/);
    if (lm) level = parseInt(lm[1], 10);
    let school = 'evocation';
    for (const s of SCHOOLS) if (levelHead.includes(s)) school = s;

    const label = (labelName: string) => {
      const re = new RegExp(`\\*\\*${labelName}:\\*\\*\\s*(.+)`, 'i');
      const m = block.match(re);
      return m ? m[1].trim() : '';
    };

    const castingRaw = label('Casting Time');
    const ritual = /\britual\b/i.test(castingRaw);

    // Higher-level scaling paragraph: "_Using a Higher-Level Spell Slot._ ..." or
    // "_Cantrip Upgrade._ ...". Captured separately and stripped from description.
    const higherLevels: GeneratedSpell['higherLevels'] = [];
    const hlMatch = block.match(/_(?:Using a Higher-Level Spell Slot|Cantrip Upgrade)\._\s*(.+)/i);
    if (hlMatch) {
      higherLevels.push({ id: 'h0', level: level + 1, description: hlMatch[1].trim() });
    }

    const description = lines
      .filter((l) => {
        const t = l.trim();
        if (t === name) return false;
        if (/^_.+_$/.test(t)) return false; // the level/school line
        if (/^\*\*[A-Za-z' -]+:\*\*/.test(t)) return false; // **Casting Time:** etc.
        if (/^_(?:Using a Higher-Level Spell Slot|Cantrip Upgrade)\._/i.test(t)) return false;
        return true;
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    spells.push({
      name,
      description: description || name,
      level,
      school,
      castingTime: parseCastingTime(castingRaw),
      components: parseComponents(label('Components')),
      range: parseRange(label('Range')),
      duration: parseDuration(label('Duration')),
      ritual,
      higherLevelScaling: { enabled: higherLevels.length > 0, type: 'spell-scale' },
      classes,
      attackSave: parseAttackSave(description),
      modifiers: parseDamage(description),
      conditions: [],
      higherLevels,
      areaOfEffect: parseAoe(description),
      tags: ['srd', school, level === 0 ? 'cantrip' : `level-${level}`],
    });
  }
  return spells;
}

interface GeneratedDoc {
  title: string;
  content: string;
  tags: string[];
}

function generateDocsFromDir(dir: string, extraTags: (file: string) => string[]): GeneratedDoc[] {
  if (!fs.existsSync(dir)) return [];
  const out: GeneratedDoc[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) {
        const content = fs.readFileSync(full, 'utf-8');
        const title = entry.name
          .replace(/\.md$/, '')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        out.push({ title, content, tags: extraTags(full) });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const spellsMd = fs.readFileSync(
    path.join(REPO_ROOT, 'docs', 'srd', 'spells', 'spells-5.2.1.md'),
    'utf-8'
  );
  const spells = parseSpellMarkdown(spellsMd);
  fs.writeFileSync(path.join(OUT_DIR, 'spells.json'), JSON.stringify(spells, null, 2) + '\n');

  const races = generateDocsFromDir(path.join(REPO_ROOT, 'docs', 'srd', 'races'), () => ['srd']);
  fs.writeFileSync(path.join(OUT_DIR, 'races.json'), JSON.stringify(races, null, 2) + '\n');

  const rules = generateDocsFromDir(path.join(REPO_ROOT, 'docs', 'srd', 'rules'), (f) => [
    'srd',
    path.basename(path.dirname(f)),
  ]);
  fs.writeFileSync(path.join(OUT_DIR, 'rules.json'), JSON.stringify(rules, null, 2) + '\n');

  console.log(`Generated ${spells.length} spells, ${races.length} races, ${rules.length} rules.`);
}

// Only run main when executed directly, not when imported by tests.
if (process.argv[1] && process.argv[1].includes('generate-srd-data')) {
  main();
}
