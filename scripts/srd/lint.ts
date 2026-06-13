#!/usr/bin/env node
/**
 * Validates extracted SRD Markdown content using two layers:
 *
 *   1. **cspell** — fast deterministic spell check with a D&D-term
 *      dictionary so proper nouns like "Tiefling" don't false-flag.
 *      Catches OCR/extraction artefacts that look like real-but-wrong
 *      words (the common failure mode for clean PDFs).
 *
 *   2. **LanguageTool** — grammar + style check via the free public API
 *      (https://api.languagetool.org). Catches subtler issues like
 *      missing articles, doubled words, weird agreement. Rate-limited
 *      to ~20 requests/min for anonymous use — we chunk by file with
 *      brief delays.
 *
 * Usage:
 *   npm run srd:lint                          # check all docs/srd/**.md
 *   npm run srd:lint -- --no-grammar          # cspell only
 *   npm run srd:lint -- --files=races/dwarf.md,races/elf.md
 *
 * Exit code: 1 if any issue found, 0 if clean.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { globSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = process.cwd();
const SRD_ROOT = join(REPO_ROOT, 'docs', 'srd');
const CSPELL_CONFIG = join(REPO_ROOT, 'scripts', 'srd', 'cspell.config.yaml');
const LT_ENDPOINT = process.env.LT_ENDPOINT ?? 'https://api.languagetool.org/v2/check';
const LT_LANGUAGE = process.env.LT_LANGUAGE ?? 'en-US';
const LT_DELAY_MS = Number(process.env.LT_DELAY_MS ?? 4000); // anonymous limit ~15/min

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  files: string[] | null; // null = all
  noGrammar: boolean;
  noSpell: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { files: null, noGrammar: false, noSpell: false };
  for (const arg of argv) {
    if (arg === '--no-grammar') args.noGrammar = true;
    else if (arg === '--no-spell') args.noSpell = true;
    else if (arg.startsWith('--files=')) args.files = arg.slice('--files='.length).split(',');
  }
  return args;
}

function resolveFiles(args: CliArgs): string[] {
  if (args.files) {
    return args.files.map((p) => join(SRD_ROOT, p));
  }
  return globSync('docs/srd/**/*.md', { cwd: REPO_ROOT });
}

// ---------------------------------------------------------------------------
// cspell layer
// ---------------------------------------------------------------------------

async function runCspell(files: string[]): Promise<{ issueCount: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['cspell', '--config', CSPELL_CONFIG, '--no-progress', '--show-context', ...files],
      { stdio: 'inherit' }
    );
    proc.on('exit', (code) => {
      // cspell exits 0 when clean, 1 when issues were found, and >1 (or a
      // signal kill, code null) on execution/config errors — those must fail
      // the run loudly rather than be downcast to a generic issue.
      if (code === 0) resolve({ issueCount: 0 });
      else if (code === 1) resolve({ issueCount: 1 });
      else reject(new Error(`cspell failed to run (exit code ${code ?? 'null'})`));
    });
    proc.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// LanguageTool layer
// ---------------------------------------------------------------------------

interface LtMatch {
  message: string;
  shortMessage?: string;
  offset: number;
  length: number;
  rule: { id: string; description: string; issueType?: string };
  context: { text: string; offset: number; length: number };
}

async function checkOneFile(filePath: string): Promise<LtMatch[]> {
  const text = await readFile(filePath, 'utf-8');
  // Strip the Markdown noise that confuses LT (code fences, links, headings).
  // After stripping, collapse repeated whitespace so we don't trip LT's
  // WHITESPACE_RULE on artefacts of our own replacements.
  const stripped = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[.*?\]\(.*?\)/g, ' ')
    .replace(/\[([^\]]*?)\]\([^)]*?\)/g, '$1')
    .replace(/^#+\s/gm, '')
    .replace(/^\s*[*-]\s/gm, '')
    .replace(/\*\*([^*]+?)\*\*/g, '$1')
    .replace(/\*([^*]+?)\*/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  // LT runs many rules; we want it focused on signals OCR would actually
  // create (real grammar breakage, doubled words, missing articles), not on
  // stylistic suggestions that don't indicate extraction errors.
  const disabledRules = [
    // Duplicates cspell — cspell already handles spelling with the D&D dict
    'MORFOLOGIK_RULE_EN_US',
    // False positives on Markdown headers + D&D capitalized terms
    'UPPERCASE_SENTENCE_START',
    'EN_UPPER_CASE_NGRAM',
    // SRD has none, skip
    'PROFANITY',
    // Stylistic suggestions, not OCR signals
    'HYPHEN_TO_EN', // "4-5" → "4–5"; editorial preference
    'CONFUSION_RULE_ROLL_ROLE', // D&D rolls dice, LT confuses with "role"
    'ENGLISH_WORD_REPEAT_BEGINNING_RULE', // parallel "You can…/You have…" is intentional
    'COMMA_PARENTHESIS_WHITESPACE', // false positives on edge-case markdown
    'DAMAGE_OF_TO', // "1d10 damage of the type X" is standard D&D phrasing
    // SRD author style: WotC's published text omits these optional commas.
    // Verified against the source PDF — these are not extraction artefacts.
    'COMMA_COMPOUND_SENTENCE', // missing comma before "or" in short compounds
    'SENT_START_CONJUNCTIVE_LINKING_ADVERB_COMMA', // "However you're moving…"
  ].join(',');
  const params = new URLSearchParams({
    text: stripped,
    language: LT_LANGUAGE,
    disabledRules,
  });
  let resp: Response;
  try {
    resp = await fetch(LT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  } catch (e) {
    throw new Error(`LT request failed for ${filePath}: ${e instanceof Error ? e.message : e}`);
  }
  if (!resp.ok) {
    throw new Error(`LT returned ${resp.status} for ${filePath}: ${await resp.text()}`);
  }
  const body = (await resp.json()) as { matches?: LtMatch[] };
  return body.matches ?? [];
}

async function runLanguageTool(files: string[]): Promise<{ issueCount: number }> {
  let issueCount = 0;
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    process.stdout.write(`[lt] ${rel} ... `);
    try {
      const matches = await checkOneFile(file);
      if (matches.length === 0) {
        console.log('clean');
      } else {
        console.log(`${matches.length} issue(s)`);
        for (const m of matches) {
          const ctx = m.context.text.slice(m.context.offset, m.context.offset + m.context.length);
          console.log(`  - [${m.rule.id}] ${m.message}`);
          console.log(`      \`${ctx}\``);
          issueCount++;
        }
      }
    } catch (e) {
      // A failed LT request means the file was NOT checked — count it as an
      // issue so the run can't silently exit 0 on network/rate-limit errors.
      console.log(`error: ${e instanceof Error ? e.message : e}`);
      issueCount++;
    }
    // Stay under the anonymous rate limit
    if (files.indexOf(file) < files.length - 1) {
      await new Promise((r) => setTimeout(r, LT_DELAY_MS));
    }
  }
  return { issueCount };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const files = resolveFiles(args);
  if (files.length === 0) {
    console.log('[srd:lint] no files matched.');
    return;
  }
  console.log(`[srd:lint] checking ${files.length} markdown file(s)`);

  let totalIssues = 0;

  if (!args.noSpell) {
    console.log('\n[srd:lint] step 1/2 — cspell');
    const { issueCount } = await runCspell(files);
    totalIssues += issueCount;
  }

  if (!args.noGrammar) {
    console.log(
      `\n[srd:lint] step 2/2 — LanguageTool (${LT_ENDPOINT}, ${LT_DELAY_MS}ms between requests)`
    );
    const { issueCount } = await runLanguageTool(files);
    totalIssues += issueCount;
  }

  if (totalIssues > 0) {
    console.log(`\n[srd:lint] ✗ ${totalIssues} issue(s) found`);
    process.exit(1);
  }
  console.log('\n[srd:lint] ✓ all checks clean');
}

main().catch((err) => {
  console.error(`[srd:lint] ✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
