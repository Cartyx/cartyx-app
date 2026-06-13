/**
 * `crowded` fixture — a single campaign loaded enough to exercise scale:
 *
 *   - 25 locations in a 4-level parent/child hierarchy
 *   - 30 characters across 4 factions, with relationships
 *   - 6 races (Wiki entries)
 *   - 8 house rules (4 public, 1 GM-only, etc.)
 *   - 5 tabletop screens, each with 2-3 pre-opened floating windows
 *   - 2 GM screens with pre-opened NPC + rule windows AND quick-reference stacks
 *   - 5 sessions (one active, two completed, two scheduled)
 *   - Visible SVG fixture images on every location
 *
 * Used both as the heaviest scenario for manual tabletop iteration and as
 * the stress-test target for performance work.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import type { Fixture, FixtureContext } from '../cli';

const FIXTURE_NAME = 'crowded';
const CAMPAIGN_NAME = '[Fixture: crowded] Continental Crisis';

// Source SRD content extracted by scripts/srd/extract-rules.ts.
// If these directories don't exist, the fixture falls back to a tiny inline
// set so the seeder still works on a fresh checkout that hasn't run extract.
const SRD_RACES_DIR = join(process.cwd(), 'docs/srd/races');
const SRD_RULES_DIR = join(process.cwd(), 'docs/srd/rules');

/** Strip the leading `# Title` and the SRD attribution footer. */
function stripMdShell(md: string): string {
  return md
    .replace(/^#[^\n]*\n+/, '')
    .replace(/\n---\n\n_Adapted from[\s\S]+$/m, '')
    .trim();
}

/** Parse `# Title` from the first heading line. */
function extractMdTitle(md: string, fallbackSlug: string): string {
  const m = /^#\s+(.+?)\s*$/m.exec(md);
  return m?.[1] ?? fallbackSlug;
}

function dirExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Default LocationTypes from app/server/db/models/LocationType.ts
const DEFAULT_LOCATION_TYPES = [
  'continent',
  'country',
  'region',
  'state',
  'province',
  'city',
  'town',
  'village',
  'cave',
  'dungeon',
  'planet',
] as const;

function fixtureSvg(label: string, fill: string): string {
  return (
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
        `<rect width="64" height="64" fill="${fill}"/>` +
        `<text x="32" y="38" text-anchor="middle" fill="white" font-family="sans-serif" font-size="10" font-weight="bold">${label}</text>` +
        `</svg>`
    )
  );
}

interface LocationSpec {
  name: string;
  type: (typeof DEFAULT_LOCATION_TYPES)[number];
  parent?: string; // name of parent
  color: string;
  description: string;
}

// 25 locations across 4 hierarchy levels: continent → country → city → district
const LOCATIONS: LocationSpec[] = [
  // L0 — continent
  {
    name: 'Theronia',
    type: 'continent',
    color: '#1a3a2a',
    description: 'A vast continent spanning glaciers in the north to volcanic isles in the south.',
  },

  // L1 — countries (4)
  {
    name: 'Vellarian Kingdom',
    type: 'country',
    parent: 'Theronia',
    color: '#2d5a3f',
    description: 'A constitutional monarchy that controls the northern coast.',
  },
  {
    name: 'Republic of Astryn',
    type: 'country',
    parent: 'Theronia',
    color: '#3a4a6a',
    description: 'A merchant republic dominating the central plains.',
  },
  {
    name: 'Free Cantons of Karth',
    type: 'country',
    parent: 'Theronia',
    color: '#6a3a3a',
    description: 'Loose federation of mountain canton-states.',
  },
  {
    name: 'Sun Empire of Solassia',
    type: 'country',
    parent: 'Theronia',
    color: '#7a5a2a',
    description: 'Theocratic empire ruling the southern deserts.',
  },

  // L2 — regions/provinces (6)
  {
    name: 'Vellarian Heartland',
    type: 'region',
    parent: 'Vellarian Kingdom',
    color: '#2d5a3f',
    description: 'Fertile plains around the capital.',
  },
  {
    name: 'Northshore Marches',
    type: 'region',
    parent: 'Vellarian Kingdom',
    color: '#1a4a4a',
    description: 'Cold coastal margin where the kingdom meets the Frozen Sea.',
  },
  {
    name: 'Astryn Lowlands',
    type: 'province',
    parent: 'Republic of Astryn',
    color: '#3a4a6a',
    description: 'Grain-rich farmlands feeding the republic.',
  },
  {
    name: 'Karthian Highlands',
    type: 'region',
    parent: 'Free Cantons of Karth',
    color: '#6a3a3a',
    description: 'High mountain passes and silver mines.',
  },
  {
    name: 'Solassian Dunes',
    type: 'region',
    parent: 'Sun Empire of Solassia',
    color: '#7a5a2a',
    description: 'Endless desert dotted with oases and ruins.',
  },
  {
    name: 'Coastal Solassia',
    type: 'province',
    parent: 'Sun Empire of Solassia',
    color: '#7a4a2a',
    description: 'Spice ports of the southern shore.',
  },

  // L3 — cities (10)
  {
    name: 'Velgard',
    type: 'city',
    parent: 'Vellarian Heartland',
    color: '#2a5a3f',
    description: 'Capital of the Vellarian Kingdom. Population 80,000.',
  },
  {
    name: 'Northkeep',
    type: 'town',
    parent: 'Northshore Marches',
    color: '#2a4a5a',
    description: 'Fortress town guarding the northern shipping lanes.',
  },
  {
    name: 'Greycliff',
    type: 'town',
    parent: 'Northshore Marches',
    color: '#3a4a4a',
    description: 'Fishing village clinging to chalk cliffs.',
  },
  {
    name: 'Astryn-on-Spire',
    type: 'city',
    parent: 'Astryn Lowlands',
    color: '#4a5a7a',
    description: 'Capital of the Republic, named for its distinctive lighthouse-spire.',
  },
  {
    name: 'Greenfield',
    type: 'town',
    parent: 'Astryn Lowlands',
    color: '#5a7a4a',
    description: 'Quiet market town. Annual harvest festival.',
  },
  {
    name: 'Karthhold',
    type: 'city',
    parent: 'Karthian Highlands',
    color: '#7a4a4a',
    description: 'Cantonal seat carved into the mountain itself.',
  },
  {
    name: 'Silverfork',
    type: 'village',
    parent: 'Karthian Highlands',
    color: '#6a4a3a',
    description: 'Mining village at the confluence of two icy rivers.',
  },
  {
    name: 'Solassia Prime',
    type: 'city',
    parent: 'Solassian Dunes',
    color: '#8a6a3a',
    description: 'Imperial capital. Golden domes and the Hierophant’s palace.',
  },
  {
    name: 'Saltreach',
    type: 'city',
    parent: 'Coastal Solassia',
    color: '#7a6a3a',
    description: 'Largest spice port outside the capital.',
  },
  {
    name: 'Oasis of Mer',
    type: 'village',
    parent: 'Solassian Dunes',
    color: '#6a5a3a',
    description: 'A trading post and waystation in the deep desert.',
  },

  // L4 — districts (4)
  {
    name: 'Velgard Old Quarter',
    type: 'town',
    parent: 'Velgard',
    color: '#1a5a3f',
    description: 'Cobblestone streets and timber-framed merchant houses.',
  },
  {
    name: 'Astryn Docks',
    type: 'town',
    parent: 'Astryn-on-Spire',
    color: '#3a4a8a',
    description: 'Where every trade in the republic eventually moves through.',
  },
  {
    name: 'Karthhold Forge District',
    type: 'town',
    parent: 'Karthhold',
    color: '#8a3a3a',
    description: 'Air thick with smoke; renowned for armaments.',
  },
  {
    name: 'Solassia Sun-Temple',
    type: 'town',
    parent: 'Solassia Prime',
    color: '#9a8a3a',
    description: 'Sacred precinct around the Hierophant’s seat.',
  },
];

interface CharacterSpec {
  firstName: string;
  lastName: string;
  race: string;
  characterClass: string;
  faction: string;
  tags: string[];
  notes: string;
}

// 30 NPCs across 4 factions, with a couple of cross-faction tensions baked in.
const CHARACTERS: CharacterSpec[] = [
  // Vellarian Crown (8)
  {
    firstName: 'Aldric',
    lastName: 'Vellaran',
    race: 'Human',
    characterClass: 'King',
    faction: 'Vellarian Crown',
    tags: ['npc', 'noble', 'key-character'],
    notes: 'Aging king of the Vellarian Kingdom. Grandson of the Founder.',
  },
  {
    firstName: 'Mira',
    lastName: 'Vellaran',
    race: 'Human',
    characterClass: 'Princess',
    faction: 'Vellarian Crown',
    tags: ['npc', 'noble', 'heir'],
    notes: 'Heir apparent; quietly opposes her father’s war plans.',
  },
  {
    firstName: 'Caedmon',
    lastName: 'Stormcrest',
    race: 'Half-elf',
    characterClass: 'Spymaster',
    faction: 'Vellarian Crown',
    tags: ['npc', 'intrigue'],
    notes: 'Runs the King’s Whispers, the kingdom’s intelligence service.',
  },
  {
    firstName: 'Beatrix',
    lastName: 'Holloway',
    race: 'Human',
    characterClass: 'High Priest',
    faction: 'Vellarian Crown',
    tags: ['npc', 'cleric'],
    notes: 'Spiritual head of the Northstar Church.',
  },
  {
    firstName: 'Gareth',
    lastName: 'Oakshield',
    race: 'Dwarf',
    characterClass: 'Marshal',
    faction: 'Vellarian Crown',
    tags: ['npc', 'military'],
    notes: 'Commands the Vellarian Royal Army. Old-school disciplinarian.',
  },
  {
    firstName: 'Lysa',
    lastName: 'Trenholm',
    race: 'Human',
    characterClass: 'Bard',
    faction: 'Vellarian Crown',
    tags: ['npc', 'spy'],
    notes: 'Court bard; secretly a Whisper handler.',
  },
  {
    firstName: 'Roderick',
    lastName: 'Pall',
    race: 'Human',
    characterClass: 'Court Mage',
    faction: 'Vellarian Crown',
    tags: ['npc', 'arcane'],
    notes: 'Old, brilliant, slightly unhinged. Knows things he shouldn’t.',
  },
  {
    firstName: 'Selene',
    lastName: 'Brand',
    race: 'Tiefling',
    characterClass: 'Ambassador',
    faction: 'Vellarian Crown',
    tags: ['npc', 'diplomat'],
    notes: 'The kingdom’s representative in Astryn; loyalty rumored mixed.',
  },

  // Astryn Senate (7)
  {
    firstName: 'Octavia',
    lastName: 'Karro',
    race: 'Human',
    characterClass: 'Senator',
    faction: 'Astryn Senate',
    tags: ['npc', 'politician', 'key-character'],
    notes: 'Senior senator; head of the war-skeptic bloc.',
  },
  {
    firstName: 'Brennan',
    lastName: 'Wych',
    race: 'Human',
    characterClass: 'Senator',
    faction: 'Astryn Senate',
    tags: ['npc', 'politician'],
    notes: 'Hawkish; allied with Solassian interests.',
  },
  {
    firstName: 'Niamh',
    lastName: 'Foss',
    race: 'Half-elf',
    characterClass: 'Spymistress',
    faction: 'Astryn Senate',
    tags: ['npc', 'intrigue'],
    notes: 'Runs the Senate’s shadow office. Rival to Caedmon Stormcrest.',
  },
  {
    firstName: 'Theodora',
    lastName: 'Riise',
    race: 'Human',
    characterClass: 'Trade Magnate',
    faction: 'Astryn Senate',
    tags: ['npc', 'merchant'],
    notes: 'Owns 12% of all shipping out of the Astryn Docks.',
  },
  {
    firstName: 'Phineas',
    lastName: 'Marsh',
    race: 'Gnome',
    characterClass: 'Banker',
    faction: 'Astryn Senate',
    tags: ['npc', 'merchant', 'gnome'],
    notes: 'Heads the Republic’s First Mercantile Bank.',
  },
  {
    firstName: 'Rachel',
    lastName: 'Constance',
    race: 'Human',
    characterClass: 'Inquisitor',
    faction: 'Astryn Senate',
    tags: ['npc', 'lawkeeper'],
    notes: 'Investigates Senate corruption. Disliked accordingly.',
  },
  {
    firstName: 'Joachim',
    lastName: 'Vell',
    race: 'Halfling',
    characterClass: 'Courier',
    faction: 'Astryn Senate',
    tags: ['npc', 'support'],
    notes: 'Senate runner; knows every back alley in Astryn-on-Spire.',
  },

  // Karthian Cantons (6)
  {
    firstName: 'Hrod',
    lastName: 'Steelbeard',
    race: 'Dwarf',
    characterClass: 'Canton Leader',
    faction: 'Karthian Cantons',
    tags: ['npc', 'noble', 'dwarf'],
    notes: 'Speaks for Canton-Hroldur, the largest cantonal seat.',
  },
  {
    firstName: 'Sigrun',
    lastName: 'Frost',
    race: 'Human',
    characterClass: 'Smith',
    faction: 'Karthian Cantons',
    tags: ['npc', 'artisan'],
    notes: 'Master armorsmith. Forged the king’s own breastplate.',
  },
  {
    firstName: 'Borr',
    lastName: 'Ironclasp',
    race: 'Dwarf',
    characterClass: 'Mine Foreman',
    faction: 'Karthian Cantons',
    tags: ['npc', 'labor'],
    notes: 'Runs the Silverfork mines. Vocal about safety.',
  },
  {
    firstName: 'Astrid',
    lastName: 'Linde',
    race: 'Half-elf',
    characterClass: 'Ranger',
    faction: 'Karthian Cantons',
    tags: ['npc', 'wilderness'],
    notes: 'Patrols the high passes. Heard whispers of orc bands in the snows.',
  },
  {
    firstName: 'Ulric',
    lastName: 'Stonecut',
    race: 'Dwarf',
    characterClass: 'Engineer',
    faction: 'Karthian Cantons',
    tags: ['npc', 'artisan'],
    notes: 'Designed the bridges of Karthhold. Slightly obsessive.',
  },
  {
    firstName: 'Vesna',
    lastName: 'Marik',
    race: 'Human',
    characterClass: 'Healer',
    faction: 'Karthian Cantons',
    tags: ['npc', 'cleric'],
    notes: 'Roams the Highlands tending sick villages.',
  },

  // Sun Empire (6)
  {
    firstName: 'Hierophant',
    lastName: 'Calix-Mor',
    race: 'Human',
    characterClass: 'Hierophant',
    faction: 'Sun Empire',
    tags: ['npc', 'religious', 'key-character'],
    notes: 'The god-king of Solassia. Claimed to be 200 years old; verifiably 80.',
  },
  {
    firstName: 'Ramira',
    lastName: 'al-Zahir',
    race: 'Human',
    characterClass: 'General',
    faction: 'Sun Empire',
    tags: ['npc', 'military'],
    notes: 'Commands the Sun Legions. Has won every campaign she has fought.',
  },
  {
    firstName: 'Tarek',
    lastName: 'al-Numar',
    race: 'Human',
    characterClass: 'Vizier',
    faction: 'Sun Empire',
    tags: ['npc', 'intrigue'],
    notes: 'The Hierophant’s chief vizier. Ambition not yet matched by guile.',
  },
  {
    firstName: 'Layla',
    lastName: 'Khan',
    race: 'Half-elf',
    characterClass: 'Caravan Master',
    faction: 'Sun Empire',
    tags: ['npc', 'merchant'],
    notes: 'Leads the Crimson Caravans across the dunes.',
  },
  {
    firstName: 'Vasanti',
    lastName: 'Sol',
    race: 'Human',
    characterClass: 'Astronomer',
    faction: 'Sun Empire',
    tags: ['npc', 'arcane'],
    notes: 'Reads omens in the Hierophant’s name.',
  },
  {
    firstName: 'Faisal',
    lastName: 'Mir',
    race: 'Tiefling',
    characterClass: 'Spy',
    faction: 'Sun Empire',
    tags: ['npc', 'intrigue'],
    notes: 'Operates in Astryn as a spice merchant. Reports nightly.',
  },

  // Wildcards (3)
  {
    firstName: 'The',
    lastName: 'Whisper',
    race: 'Unknown',
    characterClass: 'Mystery',
    faction: 'Unaffiliated',
    tags: ['npc', 'mystery'],
    notes: 'No one knows who they are. Letters bearing their seal turn up unbidden.',
  },
  {
    firstName: 'Veyra',
    lastName: 'Stonewing',
    race: 'Dragonborn',
    characterClass: 'Mercenary',
    faction: 'Unaffiliated',
    tags: ['npc', 'mercenary'],
    notes: 'Captain of the Stoneharrow free company. Loyalty to coin.',
  },
  {
    firstName: 'Padre',
    lastName: 'Garamond',
    race: 'Human',
    characterClass: 'Wandering Priest',
    faction: 'Unaffiliated',
    tags: ['npc', 'cleric'],
    notes: 'Walks the continent preaching reconciliation; widely ignored.',
  },
];

// Relationships — wire up a small graph after characters are inserted.
// Format: [characterIndex, descriptor, otherCharacterIndex]
const RELATIONSHIPS: Array<[number, string, number]> = [
  [0, 'father of', 1], // Aldric → Mira
  [1, 'opposes', 4], // Mira → Gareth (war policy)
  [2, 'rival of', 10], // Caedmon → Niamh
  [8, 'ally of', 1], // Octavia → Mira
  [9, 'corresponds with', 24], // Brennan → Tarek
  [15, 'speaks for', 17], // Hrod → Borr
  [22, 'commands', 28], // Ramira → Veyra (sometimes hired)
  [25, 'reports to', 9], // Faisal → Brennan
];

// Races — loaded from docs/srd/races/*.md (SRD 5.2.1, CC-BY 4.0).
interface RaceSpec {
  title: string;
  content: string;
  tags: string[];
}

function loadRaces(): RaceSpec[] {
  if (!dirExists(SRD_RACES_DIR)) {
    console.warn(
      `[fixture:crowded] ${SRD_RACES_DIR} missing — falling back to minimal inline races. Run \`npm run srd:extract\` to populate.`
    );
    return [
      { title: 'Human', content: 'Adaptable, ambitious humans.', tags: ['race', 'fallback'] },
      { title: 'Elf', content: 'Long-lived, magic-attuned elves.', tags: ['race', 'fallback'] },
    ];
  }
  const files = readdirSync(SRD_RACES_DIR).filter((f) => f.endsWith('.md'));
  return files.map((f) => {
    const raw = readFileSync(join(SRD_RACES_DIR, f), 'utf-8');
    const slug = f.replace(/\.md$/, '');
    const title = extractMdTitle(raw, slug);
    return { title, content: stripMdShell(raw), tags: ['race', 'srd', 'fixture'] };
  });
}
const RACES: RaceSpec[] = loadRaces();

// Rules — loaded from docs/srd/rules/<section>/*.md (SRD 5.2.1, CC-BY 4.0).
interface RuleSpec {
  title: string;
  content: string;
  tags: string[];
  isPublic: boolean;
}

function loadRules(): RuleSpec[] {
  if (!dirExists(SRD_RULES_DIR)) {
    console.warn(
      `[fixture:crowded] ${SRD_RULES_DIR} missing — falling back to minimal inline rules. Run \`npm run srd:extract\` to populate.`
    );
    return [
      {
        title: 'Initiative',
        content: 'Roll a Dexterity check to determine the order of turns in combat.',
        tags: ['combat', 'fallback'],
        isPublic: true,
      },
    ];
  }
  const sections = readdirSync(SRD_RULES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const rules: RuleSpec[] = [];
  for (const section of sections) {
    const sectionDir = join(SRD_RULES_DIR, section);
    const files = readdirSync(sectionDir).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      const raw = readFileSync(join(sectionDir, f), 'utf-8');
      const slug = f.replace(/\.md$/, '');
      const title = extractMdTitle(raw, slug);
      rules.push({
        title,
        content: stripMdShell(raw),
        tags: [section, 'srd', 'fixture'],
        isPublic: true,
      });
    }
  }
  return rules;
}
const RULES: RuleSpec[] = loadRules();

// GM Screens (the tabbed GM dashboard, separate from tabletop screens).
// Each pulls in NPCs, rules, and locations as pre-opened windows + reference stacks.
// Characters reference by index (we control the order). Rules and races
// reference by title (loaded dynamically from SRD markdown) so the layout
// stays stable as the SRD content grows.
type GMScreenItem =
  | { kind: 'character'; index: number }
  | { kind: 'rule'; title: string }
  | { kind: 'race'; title: string }
  | { kind: 'location'; index: number };

interface GMScreenLayout {
  name: string;
  tabOrder: number;
  windows: Array<GMScreenItem & { x: number; y: number }>;
  stacks: Array<{ name: string; x: number; y: number; items: GMScreenItem[] }>;
}

const GMSCREEN_LAYOUTS: GMScreenLayout[] = [
  {
    name: 'Council & Plot',
    tabOrder: 0,
    windows: [
      { kind: 'character', index: 0, x: 60, y: 60 }, // Aldric (King)
      { kind: 'character', index: 8, x: 560, y: 60 }, // Octavia (Senator)
      { kind: 'character', index: 21, x: 60, y: 480 }, // Hierophant
      { kind: 'rule', title: 'Initiative', x: 560, y: 480 },
    ],
    stacks: [
      {
        name: 'Vellarian Crown',
        x: 1080,
        y: 60,
        items: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ kind: 'character' as const, index: i })),
      },
      {
        name: 'Astryn Senate',
        x: 1080,
        y: 360,
        items: [8, 9, 10, 11, 12, 13, 14].map((i) => ({ kind: 'character' as const, index: i })),
      },
      {
        name: 'Combat Rules',
        x: 1080,
        y: 660,
        items: [
          { kind: 'rule', title: 'Initiative' },
          { kind: 'rule', title: 'Making an Attack' },
          { kind: 'rule', title: 'Opportunity Attacks' },
          { kind: 'rule', title: 'Death Saving Throws' },
        ],
      },
    ],
  },
  {
    name: 'Combat Reference',
    tabOrder: 1,
    windows: [
      { kind: 'rule', title: 'Initiative', x: 60, y: 60 },
      { kind: 'rule', title: 'Death Saving Throws', x: 560, y: 60 },
      { kind: 'rule', title: 'Critical Hits', x: 60, y: 380 },
      { kind: 'character', index: 22, x: 560, y: 380 }, // Ramira (Sun General)
      { kind: 'character', index: 4, x: 60, y: 700 }, // Gareth (Vellarian Marshal)
    ],
    stacks: [
      {
        name: 'All Races',
        x: 1080,
        y: 60,
        items: [
          'Dragonborn',
          'Dwarf',
          'Elf',
          'Gnome',
          'Goliath',
          'Halfling',
          'Human',
          'Orc',
          'Tiefling',
        ].map((title) => ({ kind: 'race' as const, title })),
      },
      {
        name: 'Conditions',
        x: 1080,
        y: 460,
        items: [
          'Blinded (Condition)',
          'Charmed (Condition)',
          'Poisoned (Condition)',
          'Prone (Condition)',
        ].map((title) => ({ kind: 'rule' as const, title })),
      },
    ],
  },
];

// 5 tabletop screens, each with 2-3 pre-opened windows.
const SCREEN_LAYOUTS: Array<{ name: string; tabOrder: number; openWindows: number }> = [
  { name: 'Council Chamber', tabOrder: 0, openWindows: 3 },
  { name: 'Wilderness Map', tabOrder: 1, openWindows: 2 },
  { name: 'City of Astryn', tabOrder: 2, openWindows: 3 },
  { name: 'Karth Mines', tabOrder: 3, openWindows: 2 },
  { name: 'Solassia Court', tabOrder: 4, openWindows: 3 },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed(ctx: FixtureContext): Promise<{ campaignIds: ObjectId[] }> {
  const { conn, gm, marker } = ctx;
  const db = conn.db!;
  const now = new Date();

  // ----- Campaign -----
  const inviteCode = Math.random().toString(16).slice(2, 10);
  const campaignDoc = {
    gameMasterId: gm._id,
    name: CAMPAIGN_NAME,
    description:
      'Multi-continental tension between four powers on the brink of war. Loaded as a stress-test fixture for tabletop development.',
    imagePath: null,
    schedule: {
      frequency: 'weekly',
      dayOfWeek: 'Saturday',
      time: '19:00',
      timezone: 'America/Chicago',
    },
    links: [],
    maxPlayers: 6,
    inviteCode,
    status: 'active',
    members: [{ userId: gm._id, role: 'gm' as const, joinedAt: now }],
    metadata: marker(FIXTURE_NAME),
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId: campaignId } = await db.collection('campaigns').insertOne(campaignDoc);

  // ----- LocationTypes -----
  await db.collection('locationtype').insertMany(
    DEFAULT_LOCATION_TYPES.map((name, i) => ({
      campaignId,
      name,
      isDefault: true,
      sortOrder: i,
    }))
  );

  // ----- Locations (two passes: insert without parents, then resolve parents) -----
  const locsByName = new Map<string, ObjectId>();
  // Pre-allocate ids so we can use them when computing parent references in order
  for (const spec of LOCATIONS) locsByName.set(spec.name, new ObjectId());

  const locDocs = LOCATIONS.map((spec) => {
    const id = locsByName.get(spec.name)!;
    const parentId = spec.parent ? locsByName.get(spec.parent) : null;
    return {
      _id: id,
      campaignId,
      createdBy: gm._id,
      name: spec.name,
      locationType: spec.type,
      description: spec.description,
      gmNotes: '',
      isPublic: true,
      parentLocations: parentId ? [parentId] : [],
      childLocations: [],
      mapImage: null,
      mapBounds: null,
      images: [
        {
          imageKey: `fixture/crowded/${id.toHexString()}.svg`,
          url: fixtureSvg(spec.name.split(' ')[0]!.slice(0, 4), spec.color),
          title: spec.name,
          uploadedAt: now,
        },
      ],
      tags: ['fixture', spec.type],
      createdAt: now,
      updatedAt: now,
    };
  });
  await db.collection('location').insertMany(locDocs);

  // Resolve childLocations arrays (parent → children) in a single pass
  const childrenByParent = new Map<string, ObjectId[]>();
  for (const spec of LOCATIONS) {
    if (!spec.parent) continue;
    const parentId = locsByName.get(spec.parent)!;
    const childId = locsByName.get(spec.name)!;
    if (!childrenByParent.has(parentId.toHexString())) {
      childrenByParent.set(parentId.toHexString(), []);
    }
    childrenByParent.get(parentId.toHexString())!.push(childId);
  }
  const childOps = [...childrenByParent.entries()].map(([parentHex, children]) => ({
    updateOne: {
      filter: { _id: new ObjectId(parentHex) },
      update: { $set: { childLocations: children } },
    },
  }));
  if (childOps.length) await db.collection('location').bulkWrite(childOps);

  // ----- Characters -----
  const charIds: ObjectId[] = CHARACTERS.map(() => new ObjectId());
  const charDocs = CHARACTERS.map((spec, i) => ({
    _id: charIds[i],
    firstName: spec.firstName,
    lastName: spec.lastName,
    race: spec.race,
    characterClass: spec.characterClass,
    age: null,
    location: '',
    link: '',
    picture: '',
    pictureCrop: null,
    notes: `${spec.notes}\n\n_Faction: ${spec.faction}_`,
    gmNotes: '',
    tags: [...spec.tags, `faction:${spec.faction.toLowerCase().replace(/\s+/g, '-')}`, 'fixture'],
    isPublic: spec.tags.includes('key-character'),
    sessionId: null,
    sessions: [],
    campaignId,
    createdBy: gm._id,
    status: { value: 'alive' as const, changedAt: null, changedBy: null },
    relationships: [], // filled below
    createdAt: now,
    updatedAt: now,
  }));
  await db.collection('characters').insertMany(charDocs);

  // Wire relationships. Cast — MongoDB's typed bulk-op shape is overly strict
  // about embedded objects in $push that we know match the schema.
  const relOps = RELATIONSHIPS.map(([fromIdx, descriptor, toIdx]) => ({
    updateOne: {
      filter: { _id: charIds[fromIdx] },
      update: {
        $push: {
          relationships: { characterId: charIds[toIdx], descriptor, isPublic: false },
        },
      },
    },
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (relOps.length) await db.collection('characters').bulkWrite(relOps as any);

  // ----- Sessions -----
  const sessionSpecs = [
    { number: 1, name: 'A Gathering Storm', status: 'completed' as const, daysAgo: 28 },
    { number: 2, name: 'Word From the Marches', status: 'completed' as const, daysAgo: 14 },
    { number: 3, name: 'The Senate in Session', status: 'active' as const, daysAgo: 0 },
    { number: 4, name: 'Embassy at Solassia', status: 'not_started' as const, daysAgo: -7 },
    { number: 5, name: 'Beneath the Mountain', status: 'not_started' as const, daysAgo: -14 },
  ];
  const sessionDocs = sessionSpecs.map((s) => ({
    _id: new ObjectId(),
    campaignId,
    name: s.name,
    gm: gm._id,
    number: s.number,
    startDate: new Date(now.getTime() - s.daysAgo * 24 * 60 * 60 * 1000),
    status: s.status,
    summary: '',
    createdAt: now,
    updatedAt: now,
  }));
  await db.collection('sessions').insertMany(sessionDocs);

  // ----- Tabletop screens with pre-opened windows -----
  // Pick a couple location + character ids for each screen's open windows
  const screenDocs = SCREEN_LAYOUTS.map((layout, i) => {
    const windows: Array<Record<string, unknown>> = [];
    for (let w = 0; w < layout.openWindows; w++) {
      // alternate between location and character windows
      const isLoc = w % 2 === 0;
      const docId = isLoc
        ? locsByName.get(LOCATIONS[(i * 3 + w) % LOCATIONS.length]!.name)!
        : charIds[(i * 3 + w) % charIds.length]!;
      windows.push({
        _id: new ObjectId(),
        collection: isLoc ? 'location' : 'character',
        documentId: docId,
        state: 'open',
        x: 100 + w * 80,
        y: 80 + w * 60,
        width: 480,
        height: 540,
        zIndex: w + 1,
      });
    }
    return {
      _id: new ObjectId(),
      campaignId,
      name: layout.name,
      tabOrder: layout.tabOrder,
      createdBy: gm._id,
      mode: 'grid' as const,
      gridStyle: 'dark' as const,
      gridSize: 50,
      gridVisible: true,
      gridScale: 5,
      locationId: null,
      battleMapImage: null,
      windows,
      createdAt: now,
      updatedAt: now,
    };
  });
  await db.collection('tabletopscreen').insertMany(screenDocs);

  // ----- Races -----
  const raceIds: ObjectId[] = RACES.map(() => new ObjectId());
  await db.collection('races').insertMany(
    RACES.map((r, i) => ({
      _id: raceIds[i],
      campaignId,
      createdBy: gm._id,
      title: r.title,
      content: r.content,
      tags: [...r.tags, 'fixture'],
      createdAt: now,
      updatedAt: now,
    }))
  );

  // ----- Rules -----
  const ruleIds: ObjectId[] = RULES.map(() => new ObjectId());
  await db.collection('rules').insertMany(
    RULES.map((r, i) => ({
      _id: ruleIds[i],
      campaignId,
      createdBy: gm._id,
      title: r.title,
      content: r.content,
      tags: [...r.tags, 'fixture'],
      isPublic: r.isPublic,
      createdAt: now,
      updatedAt: now,
    }))
  );

  // ----- GM Screens with pre-opened NPC / rule / location windows + stacks -----
  // Build title→id lookups for rules and races so layout references stay
  // stable as SRD content grows. Falls back to the first id when a title
  // isn't found, so a typo in a layout file doesn't crash the seed.
  const ruleIdByTitle = new Map<string, ObjectId>(
    RULES.map((r, i) => [r.title, ruleIds[i]!] as const)
  );
  const raceIdByTitle = new Map<string, ObjectId>(
    RACES.map((r, i) => [r.title, raceIds[i]!] as const)
  );
  const locationIds: ObjectId[] = LOCATIONS.map((spec) => locsByName.get(spec.name)!);

  function resolveItem(item: GMScreenItem): { collection: string; documentId: ObjectId } {
    if (item.kind === 'character') {
      return { collection: 'character', documentId: charIds[item.index]! };
    }
    if (item.kind === 'location') {
      return { collection: 'location', documentId: locationIds[item.index]! };
    }
    if (item.kind === 'rule') {
      const id = ruleIdByTitle.get(item.title);
      if (!id) {
        console.warn(
          `[crowded] GM screen references rule "${item.title}" — not found in SRD content, using first rule as fallback`
        );
      }
      return { collection: 'rule', documentId: id ?? ruleIds[0]! };
    }
    // race
    const id = raceIdByTitle.get(item.title);
    if (!id) {
      console.warn(
        `[crowded] GM screen references race "${item.title}" — not found in SRD content, using first race as fallback`
      );
    }
    return { collection: 'race', documentId: id ?? raceIds[0]! };
  }

  const gmScreenDocs = GMSCREEN_LAYOUTS.map((layout) => ({
    _id: new ObjectId(),
    campaignId,
    name: layout.name,
    tabOrder: layout.tabOrder,
    createdBy: gm._id,
    windows: layout.windows.map((w, i) => {
      const { collection, documentId } = resolveItem(w);
      return {
        _id: new ObjectId(),
        collection,
        documentId,
        state: 'open' as const,
        x: w.x,
        y: w.y,
        width: 460,
        height: 380,
        zIndex: i + 1,
      };
    }),
    stacks: layout.stacks.map((s) => ({
      _id: new ObjectId(),
      name: s.name,
      x: s.x,
      y: s.y,
      items: s.items.map((item) => {
        const { collection, documentId } = resolveItem(item);
        return {
          _id: new ObjectId(),
          collection,
          documentId,
          label: '',
        };
      }),
    })),
    createdAt: now,
    updatedAt: now,
  }));
  await db.collection('gmscreen').insertMany(gmScreenDocs);

  // ----- Update User.campaigns array -----
  await db.collection('users').updateOne(
    { _id: gm._id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {
      $push: {
        campaigns: { campaignId, joinedAt: now, status: 'active' },
      },
    } as any
  );

  console.log(`[fixture:crowded]`);
  console.log(`  campaign:    ${CAMPAIGN_NAME}`);
  console.log(`  locations:   ${LOCATIONS.length} (with images)`);
  console.log(`  characters:  ${CHARACTERS.length} (${RELATIONSHIPS.length} relationships)`);
  console.log(`  races:       ${RACES.length}`);
  console.log(`  rules:       ${RULES.length}`);
  console.log(`  sessions:    ${sessionSpecs.length}`);
  console.log(
    `  tabletops:   ${SCREEN_LAYOUTS.length} (${SCREEN_LAYOUTS.reduce((s, l) => s + l.openWindows, 0)} pre-opened windows)`
  );
  console.log(
    `  GM screens:  ${GMSCREEN_LAYOUTS.length} (${GMSCREEN_LAYOUTS.reduce((s, l) => s + l.windows.length, 0)} windows, ${GMSCREEN_LAYOUTS.reduce((s, l) => s + l.stacks.length, 0)} stacks)`
  );

  return { campaignIds: [campaignId] };
}

export const crowdedFixture: Fixture = {
  name: FIXTURE_NAME,
  description:
    '1 campaign, 25 locations, 30 NPCs, 5 tabletop screens with pre-opened windows. Stress-test scale.',
  seed,
};
