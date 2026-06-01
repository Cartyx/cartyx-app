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
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const PDF = resolve(REPO_ROOT, process.env.PDF ?? 'docs/sdr-5.2.1');
const OUT_ROOT = resolve(REPO_ROOT, 'docs/srd/rules');

interface PagedSection {
  slug: string; // dir name + part of file slug
  title: string; // H1 title for the section index
  startPage: number;
  endPage: number;
}

const PAGED_SECTIONS: PagedSection[] = [
  { slug: 'exploration', title: 'Exploration', startPage: 11, endPage: 12 },
  { slug: 'combat', title: 'Combat', startPage: 13, endPage: 15 },
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
  // First word must START with capital — guards against table fragments like
  // "and Dexterity" that catch the next subsection's text.
  if (!/^[A-Z]/.test(words[0]!)) return false;
  // Each non-trivial word starts capital (rough Title Case check). Allow
  // common short prepositions/conjunctions to stay lowercase.
  const lowercase =
    /^(of|the|a|an|and|or|to|in|on|with|for|by|around|through|between|across|from|into|over|under|after|before|during|against|but|so|yet)$/i;
  return words.every((w) => /^[A-Z]/.test(w) || lowercase.test(w));
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

function parseSection(rawText: string, sectionTitle: string): Subsection[] {
  const lines = rawText.split('\n');
  const cleaned: string[] = [];
  for (const l of lines) {
    if (isPageNoise(l)) continue;
    cleaned.push(l);
  }

  const subsections: Subsection[] = [];
  let current: Subsection | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!current) return;
    current.content = buffer
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
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
      }
      continue;
    }

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
      if (prevNonBlank === '' && next && !looksLikeHeading(next)) {
        flush();
        current = { heading: line, content: '' };
        continue;
      }
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
  const matches: Array<{ name: string; lineIdx: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Z][A-Za-z]+)\s+\[Condition\]\s*$/.exec(lines[i]!.trim());
    if (m) matches.push({ name: m[1]!, lineIdx: i });
  }

  // Walk forward from each [Condition] marker, stopping at:
  //   - The next bracket-tagged glossary entry (any tag), OR
  //   - An untagged glossary heading (Title-Case line, blank line before it,
  //     no terminal punctuation) — catches "Blindsight", "Bloodied" etc.
  const entries: ConditionEntry[] = [];
  for (let mi = 0; mi < matches.length; mi++) {
    const start = matches[mi]!.lineIdx + 1;
    const hardEnd = Math.min(start + 60, lines.length);
    const stopIdx = (() => {
      for (let i = start + 1; i < hardEnd; i++) {
        const t = lines[i]!.trim();
        if (!t) continue;
        // Tagged entry — definitely stop
        if (/^[A-Z][A-Za-z]+\s+\[(Condition|Action|Area of Effect|Attitude|Hazard)\]\s*$/.test(t)) {
          return i;
        }
        // Untagged glossary heading: short Title-Case line with blank line
        // before, body line after. Avoids grabbing inline bold labels.
        const prev = lines[i - 1]!.trim();
        if (prev === '' && looksLikeHeading(t) && t.split(/\s+/).length <= 3) {
          // Confirm the NEXT non-blank line is paragraph-y (lowercase or "If/When/You")
          const next = lines.slice(i + 1).find((x) => x.trim().length > 0);
          if (next && !looksLikeHeading(next.trim())) return i;
        }
      }
      return hardEnd;
    })();
    const body = lines
      .slice(start, stopIdx)
      .filter((l) => !isPageNoise(l))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    entries.push({ name: matches[mi]!.name, content: body });
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

function writePagedSection(section: PagedSection, subsections: Subsection[]): void {
  const outDir = join(OUT_ROOT, section.slug);
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
    const subsections = parseSection(raw, section.title);
    writePagedSection(section, subsections);
  }
}

main();
