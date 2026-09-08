#!/usr/bin/env node
/**
 * Post-build guard: server-only code must not be in the client bundle.
 *
 * WHY THIS EXISTS. `app/lib/audio-rate-limits.ts` and
 * `app/server/functions/audio.ts` read server env (`AUDIO_INGEST_RATE_LIMIT_*`,
 * `AUDIO_USER_QUOTA_BYTES`, `MAX_PENDING_JOBS_PER_USER`) and are reached only
 * from inside `.handler()` bodies that TanStack Start strips before the client
 * build. Nothing mechanically enforces that arrangement: a single static
 * import edge from a component or route drags the module into the browser
 * bundle, where `process` does not exist and the chunk throws
 * `ReferenceError: process is not defined` on load — for every user, on a
 * build that passed typecheck, lint, unit tests AND `npm run build`, because
 * it is a runtime failure, not a build error. `~/lib/audio-rate-limits`' own
 * module comment documents that hazard and records a MANUAL grep as the
 * verification. This script is that grep, in CI.
 *
 * `npm run test:storybook` briefly appeared to be this detector and is not:
 * Storybook does not strip handler bodies, so it goes red whenever a story
 * transitively imports a server-fn wrapper — whether or not the real build
 * drops the module. It cannot distinguish the safe case from the unsafe one.
 * This can: it reads what the production build actually emitted.
 *
 * POSITIVE CONTROLS ARE THE POINT. An absence check that searched the wrong
 * directory, or matched nothing because the walk silently skipped every file,
 * would pass while proving nothing — worse than no guard at all, because it
 * reads as coverage. So every run first asserts that two strings that MUST be
 * there ARE found, and fails if either is missing.
 *
 * Run via `npm run check:client-bundle`, after `npm run build`.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_DIR = '.output/public';
const SERVER_DIR = '.output/server';

/**
 * Strings that must NOT appear anywhere the browser can load.
 *
 * THE ENV-NAME ENTRIES ARE THE LOAD-BEARING ONES — do not drop them thinking
 * `process.env` covers the class. Measured, by statically importing
 * `audioIngestLimiter` into `app/routes/audio.tsx` and rebuilding: the module
 * shipped to the browser, and this list caught it on the two
 * `AUDIO_INGEST_RATE_LIMIT_*` names while `process.env` stayed absent, because
 * Vite rewrites the expression to a shim variable during the client build
 * (`Number(CB[t])` in the emitted chunk). The string literals passed to
 * `envPositiveNumber` survive minification; `process.env` does not survive
 * bundling. Every new server-env name read from a module that could be
 * statically reachable belongs in this list.
 *
 * `process.env` is kept anyway as a cheap second net for any code path where
 * the rewrite does not apply. If a third-party chunk ever legitimately carries
 * it (a `typeof process !== 'undefined'` guard in a vendored dependency),
 * NARROW it to exclude that file rather than deleting the entry.
 */
const FORBIDDEN_IN_CLIENT = [
  'process.env',
  'AUDIO_INGEST_RATE_LIMIT_CAPACITY',
  'AUDIO_INGEST_RATE_LIMIT_REFILL_PER_SEC',
  'AUDIO_USER_QUOTA_BYTES',
  'MAX_PENDING_JOBS_PER_USER',
  // `rateLimitMessage`'s template-literal fragment — survives minification
  // (string contents are not mangled), so it proves the FUNCTION did not ship,
  // not merely that an env name did not.
  'Try again in ',
  'mongoose',
];

/**
 * Strings that MUST be found, or the search itself is broken.
 *
 * - `Storage limit reached` is `AudioQuotaBar`'s over-quota copy: a genuinely
 *   client-side string from the very route whose server-side siblings this
 *   script forbids. Finding it proves we are searching a populated client
 *   bundle that really does contain the audio surface — not an empty
 *   directory, and not a build where `/audio` was tree-shaken away entirely.
 * - `mongoose` under `.output/server` is the technique control: the same
 *   string this script forbids on the client must be present on the server, so
 *   a search that can never match anything cannot masquerade as a pass.
 */
const REQUIRED = [
  { dir: PUBLIC_DIR, needle: 'Storage limit reached', why: "AudioQuotaBar's client-side copy" },
  { dir: SERVER_DIR, needle: 'mongoose', why: 'server bundle sanity' },
];

/** Every file under `dir`, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/**
 * Files containing `needle`. Matched on raw bytes rather than decoded text so
 * nothing has to be excluded by extension — an image cannot accidentally
 * contain these ASCII strings, and a filter that skipped the wrong extension
 * is precisely how this check would go quietly blind.
 */
function filesContaining(files, needle) {
  const bytes = Buffer.from(needle);
  return files.filter((f) => readFileSync(f).includes(bytes));
}

function main() {
  for (const dir of [PUBLIC_DIR, SERVER_DIR]) {
    if (!existsSync(dir)) {
      process.stdout.write(`check:client-bundle: ${dir} missing — run \`npm run build\` first\n`);
      process.exit(1);
    }
  }

  const publicFiles = walk(PUBLIC_DIR);
  const serverFiles = walk(SERVER_DIR);
  const byDir = { [PUBLIC_DIR]: publicFiles, [SERVER_DIR]: serverFiles };
  process.stdout.write(
    `check:client-bundle: scanning ${publicFiles.length} client files, ` +
      `${serverFiles.length} server files\n`
  );

  let failed = false;

  // --- positive controls, first: prove the search can find anything at all ---
  for (const { dir, needle, why } of REQUIRED) {
    const hits = filesContaining(byDir[dir], needle);
    if (hits.length === 0) {
      failed = true;
      process.stdout.write(
        `  CONTROL FAILED  "${needle}" not found in ${dir} (${why}).\n` +
          `                  The absence checks below cannot be trusted — this ` +
          `search found nothing where something must be.\n`
      );
    } else {
      process.stdout.write(
        `  control ok      "${needle}" found in ${dir} (${hits.length} file(s)) — ${why}\n`
      );
    }
  }

  // --- the actual guard ---
  for (const needle of FORBIDDEN_IN_CLIENT) {
    const hits = filesContaining(publicFiles, needle);
    if (hits.length > 0) {
      failed = true;
      process.stdout.write(
        `  FORBIDDEN       "${needle}" is in the CLIENT bundle (${hits.length} file(s)):\n` +
          hits.map((f) => `                    ${f}\n`).join('')
      );
    } else {
      process.stdout.write(`  ok              "${needle}" absent from ${PUBLIC_DIR}\n`);
    }
  }

  if (failed) {
    process.stdout.write(
      '\ncheck:client-bundle: FAILED. A server-only module reached the browser ' +
        'bundle.\nUsually a static `import` where a dynamic `await import(...)` ' +
        'inside a `.handler()` body is required — see app/utils/require-actor.ts ' +
        'and app/lib/audio-rate-limits.ts.\n'
    );
    process.exit(1);
  }

  process.stdout.write('check:client-bundle: OK\n');
}

main();
