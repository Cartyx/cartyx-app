#!/usr/bin/env node
/**
 * Run the web app (vite dev) AND the realtime ws service together, so a single
 * `npm run dev` gives a fully working local stack (dice/chat/tabletop realtime
 * needs the ws service — without it, rolls never reach the session history).
 *
 * Dependency-free: no `concurrently`. Loads .env (the realtime service reads
 * process.env directly and does not load .env itself) and pins the ws service
 * to :1999, which is what the client (`usePartySession`) defaults to.
 *
 * Ctrl+C, or either child exiting, tears the whole stack down — no orphans.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// Load .env into process.env so the realtime service gets SESSION_SECRET /
// MONGODB_URI. Vite loads .env on its own, so this is harmless for the web app.
if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch (err) {
    console.warn('[dev] could not load .env:', err.message);
  }
}

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
  // Give children a moment to exit, then force.
  setTimeout(() => process.exit(code), 500).unref();
}

function run(name, command, args, env) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  const tag = `[${name}] `;
  const pipe = (stream, out) => {
    stream.on('data', (buf) => {
      const text = buf.toString().replace(/\n$/, '');
      out.write(text.replace(/^/gm, tag) + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.log(`${tag}exited (${signal ?? code}) — shutting down the dev stack`);
      shutdown(code ?? 0);
    }
  });
  children.push(child);
  return child;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// Web app (vite reads its own port from vite.config; it ignores PORT).
run('web', 'npx', ['vite', 'dev']);
// Realtime ws service on :1999 (client default). Override PORT so it never
// picks up the web PORT from .env.
run('ws', 'npm', ['--prefix', 'realtime', 'run', 'dev'], { PORT: '1999' });
