#!/usr/bin/env node
/**
 * Run the audio-worker against the LOCAL dev stack.
 *
 * `npm run dev` starts the web app and the realtime ws service, but NOT the
 * transcode worker — so a locally uploaded audio asset stays `pending` forever
 * and never reaches the soundboard. This is the missing third process.
 *
 * Dependency-free (same shape as dev-all.mjs): loads .env, preflights the
 * things whose absence produces a confusing failure rather than a clear one,
 * compiles the worker's TypeScript, then runs `dist/index.js`.
 *
 * Usage:
 *   npm run audio-worker:dev              # build, then run
 *   npm run audio-worker:dev -- --no-build  # skip tsc (fast restart)
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = join(repoRoot, 'audio-worker');

// The worker reads process.env directly and does not load .env itself.
if (existsSync(join(repoRoot, '.env'))) {
  try {
    process.loadEnvFile(join(repoRoot, '.env'));
  } catch (err) {
    console.warn('[audio-worker] could not load .env:', err.message);
  }
}

function fail(message) {
  console.error(`[audio-worker] ${message}`);
  process.exit(1);
}

// --- Preflight -------------------------------------------------------------

// The worker DELETES R2 objects when it reaps stale claims, so the prod guard
// matters more here than it does for a read-only process. Mirrors the refusal
// in scripts/dev_clear.py rather than trusting the operator's shell.
if (process.env.NODE_ENV === 'production') {
  fail('refusing to run with NODE_ENV=production.');
}
for (const name of ['MONGODB_URI', 'R2_BUCKET']) {
  if (process.env[name]?.toLowerCase().includes('prod')) {
    fail(`refusing to run: ${name} looks like a production value.`);
  }
}

// `r2()` in process.ts throws on the first missing one at the moment an asset
// is claimed — i.e. after an upload, not at boot. Check them up front so the
// failure is visible now instead of as a mysteriously stuck asset later.
const missing = [
  'MONGODB_URI',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'CDN_URL',
].filter((name) => !process.env[name]);
if (missing.length > 0) {
  fail(`missing required env var(s): ${missing.join(', ')} — check .env`);
}

// ffmpeg/ffprobe are spawned per asset; without them every transcode fails
// individually and the asset lands in `failed` with a spawn ENOENT.
for (const bin of ['ffmpeg', 'ffprobe']) {
  const probe = spawnSync(bin, ['-version'], { stdio: 'ignore' });
  if (probe.error) {
    fail(`${bin} not found on PATH — install it (brew install ffmpeg).`);
  }
}

// --- Build -----------------------------------------------------------------

const skipBuild = process.argv.includes('--no-build');
if (!skipBuild) {
  console.log('[audio-worker] building…');
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: workerDir,
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    fail('build failed.');
  }
} else if (!existsSync(join(workerDir, 'dist', 'index.js'))) {
  fail('--no-build passed but audio-worker/dist/index.js does not exist yet.');
}

// --- Run -------------------------------------------------------------------

console.log(
  `[audio-worker] starting — bucket '${process.env.R2_BUCKET}', polling for pending assets…`
);

const child = spawn('node', ['dist/index.js'], {
  cwd: workerDir,
  env: process.env,
  stdio: 'inherit',
  detached: true,
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    // Detached, so the negative PID signals the whole group — the worker's own
    // SIGTERM handler finishes the in-flight asset before exiting.
    process.kill(-child.pid, signal);
  } catch {
    /* already gone */
  }
}

process.on('SIGINT', () => shutdown('SIGTERM'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code, signal) => {
  console.log(`[audio-worker] exited (${signal ?? `code ${code}`})`);
  process.exit(code ?? 0);
});
