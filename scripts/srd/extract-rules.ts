#!/usr/bin/env node
/**
 * Extracts the rules sections we care about from the SRD 5.2.1 PDF into
 * curated Markdown files under `docs/srd/rules/`.
 *
 * Sections (with page ranges read from the SRD TOC):
 *   combat        pages 13–15   (Order of Combat, Movement, Attacks, etc.)
 *   damage        pages 16–18   (Damage & Healing)
 *   exploration   pages 11–13   (Vision, Light, Hiding, Hazards, Travel)
 *   spellcasting  pages 104–107 (Casting Spells, Components, etc.)
 *   conditions    full-doc      (entries tagged `Name [Condition]`)
 *
 * Usage:
 *   npm run srd:extract                  # all sections
 *   npm run srd:extract -- combat        # one section
 *   PDF=path/to/srd.pdf npm run srd:extract
 *
 * Requires: pdftotext (poppler-utils). The SRD PDF is gitignored; pass via
 * `PDF=…` if it lives elsewhere.
 *
 * Output: one Markdown file per subsection (or per condition), prefixed
 * with H1 title + a license attribution footer (CC-BY 4.0 / WotC).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const PDF = resolve(REPO_ROOT, process.env.PDF ?? 'docs/sdr-5.2.1');
const OUT_ROOT = resolve(REPO_ROOT, 'docs/srd/rules');

interface PagedSection {
  slug: string; // dir name + part of file slug
  title: string; // H1 title for the section index
  startPage: number;
  endPage: number;
  // If set, parseSection stops accumulating subsections once it encounters this
  // heading. Use when an extended page range crosses into another top-level
  // section (e.g. Combat ends mid-p.16 where Damage and Healing begins).
  stopAtTitle?: string;
}

const PAGED_SECTIONS: PagedSection[] = [
  { slug: 'exploration', title: 'Exploration', startPage: 11, endPage: 12 },
  // Underwater Combat falls on p.16 in the PDF flow but belongs to Combat.
  // Read through p.16 and bail when the Damage and Healing heading appears.
  {
    slug: 'combat',
    title: 'Combat',
    startPage: 13,
    endPage: 16,
    stopAtTitle: 'Damage and Healing',
  },
  { slug: 'damage', title: 'Damage and Healing', startPage: 16, endPage: 18 },
  // SRD calls this section "Spells" on the page (not "Spellcasting" as TOC lists it).
  { slug: 'spells', title: 'Spells', startPage: 104, endPage: 106 },
];

const ATTRIBUTION =
  '\n---\n\n_Adapted from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of\n' +
  'the Coast LLC, licensed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode)._\n';

// ---------------------------------------------------------------------------
// pdftotext wrapper
// ---------------------------------------------------------------------------

function runPdftotext(args: string[]): string {
  try {
    return execFileSync('pdftotext', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(
      `pdftotext failed. Is poppler installed? (brew install poppler). Underlying error: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }
}

function extractPages(startPage: number, endPage: number): string {
  // Default mode (not -layout) gives clean linear text suitable for headings/paragraphs.
  return runPdftotext(['-f', String(startPage), '-l', String(endPage), PDF, '-']);
}

function extractAll(): string {
  return runPdftotext([PDF, '-']);
}

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

function isPageNoise(line: string): boolean {
  if (/^\s*\d+\s*$/.test(line)) return true; // page number
  if (/^\s*System Reference Document/.test(line)) return true;
  if (/^\s*$/.test(line)) return false; // blank handled separately
  return false;
}

// Single-word Title-Case lines that look like headings but are actually
// table-cell labels or column values appearing in the linearised pdftotext
// output. Empirically observed: "Slow" in the Travel Pace table, "Any" in
// the Spell Preparation by Class table.
const NON_HEADING_SINGLE_WORDS = new Set([
  'Any',
  'All',
  'Some',
  'None',
  'Yes',
  'No',
  // Spell Preparation by Class table "Number of Spells" column values
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  // Travel Pace table row labels + column headers (exploration p.12)
  'Fast',
  'Normal',
  'Slow',
  'Pace',
  'Minute',
  'Hour',
  'Day',
  // Other column headers empirically observed in the SRD tables we extract:
  //   - "Class" in Spell Preparation by Class (spells p.104)
  //   - "Size" in Creature Size and Space (combat p.15)
  //   - "School" in Schools of Magic (spells p.105) — "School of Magic" the
  //     heading is multi-word so unaffected.
  // We deliberately do NOT add ambiguous single words like "Range", "Effect",
  // "Source", "Type", "Level" because they appear as REAL subsection
  // headings elsewhere in the rules.
  'Class',
  'Size',
  'School',
  // Class names appear as row labels in the Spell Preparation by Class
  // table (spells p.104). They are NOT used as standalone subsection
  // headings in any of our extracted page ranges, so it's safe to drop them.
  'Bard',
  'Cleric',
  'Druid',
  'Paladin',
  'Ranger',
  'Sorcerer',
  'Warlock',
  'Wizard',
]);

// Multi-word Title-Case phrases that look like headings but are actually
// table cell values in our extracted pages. Empirically observed:
//   - "Finish a Long Rest" / "Finish a Short Rest" in the Spell Preparation
//     by Class table (spells p.104). The corresponding subsection in the
//     SRD glossary is titled "Finishing a Long Rest" / "Finishing a Short
//     Rest" (gerund), so dropping the bare imperative is safe.
const NON_HEADING_PHRASES = new Set(['Finish a Long Rest', 'Finish a Short Rest']);

// Fragments of the form "Word (Modifier)" — e.g. "Space (Feet)",
// "Space (Squares)" — which appear as column-header text in the linearised
// pdftotext output. These slip past the heading detector because their
// parentheses disqualify them as headings, so we catch them with a separate
// rule and drop silently rather than let them leak into body content.
//
// We require at least 2 chars inside the parens to avoid stripping legitimate
// inline subheadings like "Verbal (V)", "Somatic (S)", "Material (M)" in the
// Spell Components section, which use single-letter abbreviation markers.
function looksLikeParensColumnHeader(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 30) return false;
  return /^[A-Z][A-Za-z]+(?:\s+[A-Z]?[a-z]+)?\s*\([A-Za-z]{2,}\)$/.test(t);
}

/**
 * Heuristic: a line is a heading if Title Case, < 60 chars, no terminal
 * punctuation, and the next non-blank line begins a paragraph.
 * Top-level (H1) vs sub-section (H2) heuristic: top-level headings match
 * the sectionTitle we requested for that page range; everything else within
 * the section is H2.
 */
function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 60) return false;
  if (/[.,!?]$/.test(t)) return false;
  if (/^[0-9]/.test(t)) return false; // numbered list items
  // Most chars must be A-Z, a-z, or whitespace, with no inline punctuation
  if (/[(){};:]/.test(t)) return false;
  // Must have a capital letter and not be ALL CAPS
  if (!/[A-Z]/.test(t)) return false;
  const words = t.split(/\s+/);
  // Reject single-word lines that are known table-cell labels disguised as headings.
  if (words.length === 1 && NON_HEADING_SINGLE_WORDS.has(words[0]!)) return false;
  // Reject known table-cell phrases that look heading-shaped but are values.
  if (NON_HEADING_PHRASES.has(t)) return false;
  // First word must START with capital — guards against table fragments like
  // "and Dexterity" that catch the next subsection's text.
  if (!/^[A-Z]/.test(words[0]!)) return false;
  // Each non-trivial word starts capital (rough Title Case check). Allow
  // common short prepositions/conjunctions to stay lowercase.
  const lowercase =
    /^(of|the|a|an|and|or|to|in|on|with|for|by|around|through|between|across|from|into|over|under|after|before|during|against|but|so|yet)$/i;
  return words.every((w) => /^[A-Z]/.test(w) || lowercase.test(w));
}

// Drop standalone "table cell content" lines that look like body text but
// are actually values from linearised tables. Patterns we've observed:
//   - "…" (column-header ellipsis placeholder in Spell Prep table)
//   - "Gain a level" / "Finish a Long Rest" / etc. (Change When You values)
//   - "400 feet" / "4 miles" / "30 miles" (Travel Pace distance values)
//
// These slip past looksLikeHeading because they're lowercase mid-word,
// past NON_HEADING_SINGLE_WORDS because they're multi-word, and past
// NON_HEADING_PHRASES if not listed. We use a regex-based fallback here so
// new tables don't require enumerating every cell value.
function looksLikeTableCellValue(line: string): boolean {
  const t = line.trim();
  if (t === '…' || t === '...') return true;
  if (/^\d+\s+(feet|miles|hours|minutes|days|rounds|seconds|squares)$/i.test(t)) return true;
  if (/^Gain a level$/.test(t)) return true;
  // Lines ending in "…" — typically table column-spanner labels like
  // "Distance Traveled Per …" in the Travel Pace table header row.
  if (/…$/.test(t) && t.length < 40) return true;
  return false;
}

// Does a short single-line "paragraph" look like a legitimate inline
// subheading (e.g. "Verbal (V)", "Dropping to 0 Hit Points") vs a table
// cell fragment ("+2 bonus to AC", "and Dexterity", "2½ by 2½ feet")?
// Keep on capital-leading Title-Case-ish lines; drop everything else short.
function looksLikeInlineSubheading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 60) return false;
  // Must start with a capital letter (rules out "+2 bonus", "and Dexterity",
  // numbers like "2½ by 2½ feet").
  if (!/^[A-Z]/.test(t)) return false;
  if (/^[+\-0-9]/.test(t)) return false;
  const words = t.split(/\s+/);
  const lower = /^(of|the|a|an|and|or|to|in|on|with|for|by|out|without|per)$/i;
  return words.every(
    (w) => /^[A-Z]/.test(w) || lower.test(w) || /^\([A-Z]\)/.test(w) || /^[0-9]/.test(w)
  );
}

// Strip "table noise paragraphs" from a body. A blank-separated paragraph is
// dropped if it's short AND lacks sentence punctuation/equation operators
// AND doesn't look like a legitimate inline subheading. This catches table
// cell fragments that survive parse-time filters (e.g. "+2 bonus to AC",
// "and Dexterity", "saving throws" — all rows from the linearised Cover
// table). Multi-line "paragraphs" without any sentence punctuation are
// almost always wrapped table cells (e.g. "Channels energy to create
// effects that / are often destructive" — a Schools of Magic cell value).
function stripTableNoiseParagraphs(body: string): string {
  const paragraphs = body.split(/\n{2,}/);
  const kept = paragraphs.filter((p) => {
    const t = p.trim();
    if (t.length === 0) return false;
    if (/[.?!:]/.test(t)) return true; // real sentence punctuation
    if (/[=]/.test(t)) return true; // equations (e.g. "Spell save DC = …")
    if (t.length > 80) return true; // long single-line = unusual but keep
    if (looksLikeInlineSubheading(t)) return true; // e.g. "Verbal (V)"
    return false;
  });
  return kept.join('\n\n');
}

/**
 * Reject content that's almost certainly a table fragment, not a real rule:
 *   - Less than 80 chars of body, OR
 *   - No period anywhere (real prose always has at least one sentence)
 */
function isSubstantialContent(content: string): boolean {
  if (content.length < 80) return false;
  if (!/\./.test(content)) return false;
  return true;
}

interface Subsection {
  heading: string;
  content: string;
}

function parseSection(rawText: string, sectionTitle: string, stopAtTitle?: string): Subsection[] {
  const lines = rawText.split('\n');
  const cleaned: string[] = [];
  for (const l of lines) {
    if (isPageNoise(l)) continue;
    cleaned.push(l);
  }

  const subsections: Subsection[] = [];
  // Track headings we've already anchored so a re-occurrence (typically a
  // table title that matches the subsection title verbatim, e.g. a second
  // "Travel Pace" line introducing the Travel Pace table) is recognised as
  // a table caption and dropped, rather than flushing the real subsection
  // and overwriting it with table-row noise.
  const seenHeadings = new Set<string>();
  let current: Subsection | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!current) return;
    const raw = buffer
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      // Merge equation continuations: a line that begins with `+ ` or `- `
      // (operator + space) is a wrap of the equation on the previous line
      // (e.g. "Spell save DC = 8 + …" / "+ your Proficiency Bonus").
      .replace(/\n([+\-*/=])\s+/g, ' $1 ')
      .trim();
    current.content = stripTableNoiseParagraphs(raw);
    if (current.content.length > 0) subsections.push(current);
    current = null;
    buffer = [];
  };

  // Skip everything before the section title heading.
  let started = false;
  for (let i = 0; i < cleaned.length; i++) {
    const line = cleaned[i]!.trim();
    if (!started) {
      if (line === sectionTitle) {
        started = true;
        current = { heading: sectionTitle + ' (Overview)', content: '' };
        seenHeadings.add(sectionTitle);
      }
      continue;
    }

    // Bail when we cross into the next top-level section.
    if (stopAtTitle && line === stopAtTitle) break;

    // Drop parenthesised column-header fragments (e.g. "Space (Feet)").
    if (looksLikeParensColumnHeader(line)) continue;

    // Drop standalone single-word lines that are known table cell labels
    // (NON_HEADING_SINGLE_WORDS). They look heading-shaped but are values —
    // dropping silently keeps both heading anchoring and body content clean.
    // Real prose mentions of these words always appear inline within longer
    // lines, never as the entire line.
    if (NON_HEADING_SINGLE_WORDS.has(line)) continue;
    if (NON_HEADING_PHRASES.has(line)) continue;
    // Drop pattern-matched table-cell values (distances, "Gain a level", …).
    if (looksLikeTableCellValue(line)) continue;

    if (looksLikeHeading(line)) {
      // For this to be a genuine subsection header it must:
      //   1. Be preceded by a blank line (true section breaks always are)
      //   2. The next non-blank line must look like a paragraph, not another heading
      const prevNonBlank = (() => {
        for (let j = i - 1; j >= 0; j--) {
          if (cleaned[j]!.trim().length > 0) return cleaned[j]!.trim();
          // Encountered blank line first — we're at a real break
          return '';
        }
        return '';
      })();
      const next = cleaned.slice(i + 1).find((x) => x.trim().length > 0);
      // Lookahead: a real subsection has prose within ~5 non-blank lines.
      // If everything that follows is short fragments, suppressed tokens,
      // or other heading-shaped lines (e.g. column headers, table cells in
      // linearised pdftotext output), the "heading" is really a table
      // caption — drop it without flushing the real surrounding subsection.
      const HEADING_LOOKAHEAD = 5;
      let proseFound = false;
      let seen = 0;
      for (let j = i + 1; j < cleaned.length && seen < HEADING_LOOKAHEAD; j++) {
        const t = cleaned[j]!.trim();
        if (t.length === 0) continue;
        seen++;
        // A "prose" line: long-ish, mid-line lowercase, sentence punctuation.
        if (t.length > 40 && /[a-z]/.test(t) && /[.,;]/.test(t)) {
          proseFound = true;
          break;
        }
      }
      if (prevNonBlank === '' && next && !looksLikeHeading(next) && proseFound) {
        // A heading that exactly matches one we've already anchored is the
        // table-caption pattern (e.g. a second "Travel Pace" introducing the
        // Travel Pace table). Drop it without flushing the real subsection.
        if (seenHeadings.has(line)) continue;
        flush();
        current = { heading: line, content: '' };
        seenHeadings.add(line);
        continue;
      }
      // Heading-shaped but couldn't anchor as a real subsection. In the
      // linearised pdftotext output this is almost always a table title
      // immediately followed by a column header (e.g. "Spell Preparation by
      // Class" + "Class"), or a column header that follows the title. Drop
      // silently rather than leak the fragment into the previous subsection.
      continue;
    }

    if (current) buffer.push(line);
  }
  flush();
  return subsections;
}

// ---------------------------------------------------------------------------
// Conditions: full-document scan by [Condition] tag
// ---------------------------------------------------------------------------

interface ConditionEntry {
  name: string;
  content: string;
}

function extractConditions(): ConditionEntry[] {
  const text = extractAll();
  const lines = text.split('\n');

  // 1. Locate every `Name [Condition]` marker.
  const markers: Array<{ name: string; lineIdx: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Z][A-Za-z]+)\s+\[Condition\]\s*$/.exec(lines[i]!.trim());
    if (m) markers.push({ name: m[1]!, lineIdx: i });
  }

  // 2. For each marker, find the body. The PDF's two-column layout makes
  // pdftotext interleave adjacent glossary entries — e.g. "Paralyzed
  // [Condition]" is immediately followed by "Poisoned [Condition]" before
  // either body appears. So we can't just walk forward from the marker; we
  // anchor on the SRD's unambiguous body opener "While you have the {Name}
  // condition", which uniquely identifies each entry's prose start.
  const tagPattern = /^[A-Z][A-Za-z]+\s+\[(Condition|Action|Area of Effect|Attitude|Hazard)\]\s*$/;
  const conditionOpener = /While you have the ([A-Z][A-Za-z]+) condition/;
  const MIN_BODY_CHARS_BEFORE_HEURISTIC_STOP = 60;
  const BODY_SEARCH_WINDOW = 100; // how far forward to look for the opener
  const BODY_MAX_LINES = 20; // any single condition body fits well under this

  const entries: ConditionEntry[] = [];
  for (const marker of markers) {
    // Locate this condition's body opener. While we walk forward, also
    // capture any short Title-Case lines interleaved between our marker and
    // our body — those are the headings of the NEXT glossary entries in
    // document order (e.g. "Initiative" appearing between "Incapacitated
    // [Condition]" and the Incapacitated body). We use them later to detect
    // body end when the next entry's prose starts with that same word.
    let bodyStart = -1;
    const interleavedNextTitles: string[] = [];
    const openerLimit = Math.min(marker.lineIdx + BODY_SEARCH_WINDOW, lines.length);
    for (let i = marker.lineIdx + 1; i < openerLimit; i++) {
      const m = conditionOpener.exec(lines[i]!);
      if (m && m[1] === marker.name) {
        bodyStart = i;
        break;
      }
      const t = lines[i]!.trim();
      // Short standalone Title-Case lines between the marker and our body
      // are next-entry headings interleaved by the two-column layout.
      if (/^[A-Z][a-z]+$/.test(t) && t.length <= 20) {
        interleavedNextTitles.push(t);
      }
    }
    if (bodyStart === -1) continue;

    // Locate the body end: another condition opener, another tagged entry,
    // an interleaved Disadvantage/Advantage-style ("If you have…") body that
    // belongs to a different glossary entry, or an untagged glossary heading
    // — whichever comes first within BODY_MAX_LINES.
    const hardEnd = Math.min(bodyStart + BODY_MAX_LINES, lines.length);
    let bodyEnd = hardEnd;
    let bodyCharsSeen = 0;
    for (let i = bodyStart + 1; i < hardEnd; i++) {
      const t = lines[i]!.trim();
      if (tagPattern.test(t)) {
        bodyEnd = i;
        break;
      }
      const opener = conditionOpener.exec(t);
      if (opener && opener[1] !== marker.name) {
        bodyEnd = i;
        break;
      }
      if (
        bodyCharsSeen >= MIN_BODY_CHARS_BEFORE_HEURISTIC_STOP &&
        /^If (you|a creature) /.test(t)
      ) {
        bodyEnd = i;
        break;
      }
      const prev = lines[i - 1]!.trim();
      if (
        bodyCharsSeen >= MIN_BODY_CHARS_BEFORE_HEURISTIC_STOP &&
        prev === '' &&
        looksLikeHeading(t) &&
        t.split(/\s+/).length <= 3
      ) {
        const next = lines.slice(i + 1).find((x) => x.trim().length > 0);
        if (next && !looksLikeHeading(next.trim())) {
          bodyEnd = i;
          break;
        }
      }
      // Next-entry detection: an interleaved title we captured earlier (e.g.
      // "Initiative" between "Incapacitated [Condition]" and its body)
      // reappears here as the first word of the next entry's body paragraph
      // ("Initiative determines the order…"). End our body before it.
      if (bodyCharsSeen >= MIN_BODY_CHARS_BEFORE_HEURISTIC_STOP && prev === '') {
        for (const title of interleavedNextTitles) {
          if (new RegExp(`^${title}\\s+[a-z]`).test(t)) {
            bodyEnd = i;
            break;
          }
        }
        if (bodyEnd === i) break;
      }
      bodyCharsSeen += t.length;
    }

    const body = lines
      .slice(bodyStart, bodyEnd)
      .filter((l) => !isPageNoise(l))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    entries.push({ name: marker.name, content: body });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function writeMd(path: string, title: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `# ${title}\n\n${content}\n${ATTRIBUTION}`, 'utf-8');
}

// Remove all .md files in a section directory before regenerating. Keeps
// each section's output canonical — stale files from earlier extractor
// versions (e.g. column-header artefacts) don't linger.
function cleanSectionDir(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith('.md')) unlinkSync(join(dir, entry));
  }
}

function writePagedSection(section: PagedSection, subsections: Subsection[]): void {
  const outDir = join(OUT_ROOT, section.slug);
  cleanSectionDir(outDir);
  let count = 0;
  let skipped = 0;
  for (const sub of subsections) {
    const slug = slugify(sub.heading);
    if (!slug) continue;
    if (!isSubstantialContent(sub.content)) {
      skipped++;
      continue;
    }
    writeMd(join(outDir, `${slug}.md`), sub.heading, sub.content);
    count++;
  }
  console.log(
    `[extract:${section.slug}] wrote ${count} markdown file(s) to ${outDir}` +
      (skipped > 0 ? ` (skipped ${skipped} thin/table-fragment entries)` : '')
  );
}

function writeConditions(entries: ConditionEntry[]): void {
  const outDir = join(OUT_ROOT, 'conditions');
  cleanSectionDir(outDir);
  let count = 0;
  for (const e of entries) {
    if (e.content.length < 20) continue;
    writeMd(join(outDir, `${slugify(e.name)}.md`), `${e.name} (Condition)`, e.content);
    count++;
  }
  console.log(`[extract:conditions] wrote ${count} markdown file(s) to ${outDir}`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function main(): void {
  const arg = process.argv[2];
  const allSections = ['exploration', 'combat', 'damage', 'spells', 'conditions'];
  const targets = arg ? [arg] : allSections;

  for (const target of targets) {
    if (target === 'conditions') {
      const entries = extractConditions();
      writeConditions(entries);
      continue;
    }
    const section = PAGED_SECTIONS.find((s) => s.slug === target);
    if (!section) {
      console.error(`[extract] unknown section "${target}". Available: ${allSections.join(', ')}`);
      process.exitCode = 1;
      continue;
    }
    const raw = extractPages(section.startPage, section.endPage);
    const subsections = parseSection(raw, section.title, section.stopAtTitle);
    writePagedSection(section, subsections);
  }
}

main();
