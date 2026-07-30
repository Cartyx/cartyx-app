import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beat, isHeartbeatFresh } from '../src/heartbeat.js';
import { DEFAULT_HEARTBEAT_MAX_AGE_MS, heartbeatMaxAgeMs } from '../src/config.js';
import { DEFAULT_CHILD_TIMEOUT_MS } from '../src/ffmpeg.js';

/**
 * B7 — the worker has no HTTP port, so a wedge is otherwise undetectable:
 * restart count 0, memory flat, logs silent, HelmRelease green, and every
 * user's uploads queued behind one stuck row.
 */
let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cartyx-hb-'));
  path = join(dir, 'beat');
  process.env.HEARTBEAT_FILE = path;
});

afterEach(() => {
  delete process.env.HEARTBEAT_FILE;
  delete process.env.HEARTBEAT_MAX_AGE_MS;
});

describe('heartbeat', () => {
  it('records progress and reads back as fresh', () => {
    beat();
    expect(isHeartbeatFresh()).toBe(true);
  });

  it('goes stale once the loop stops advancing', () => {
    beat();
    const stale = (Date.now() - DEFAULT_HEARTBEAT_MAX_AGE_MS - 60_000) / 1000;
    utimesSync(path, stale, stale);
    // This is the entire liveness signal: a loop wedged on a hung R2 socket
    // stops calling beat(), and only the file's AGE reveals it.
    expect(isHeartbeatFresh()).toBe(false);
  });

  it('treats a missing file as dead, not as healthy', () => {
    expect(isHeartbeatFresh()).toBe(false);
  });

  it('never throws when the file cannot be written', () => {
    process.env.HEARTBEAT_FILE = join(dir, 'no-such-dir', 'beat');
    // Telemetry-grade contract: a full or read-only /tmp is a reason to log,
    // never a reason to fail an upload.
    expect(() => beat()).not.toThrow();
  });

  it('honours the configured threshold', () => {
    writeFileSync(path, '0');
    const old = (Date.now() - 5_000) / 1000;
    utimesSync(path, old, old);
    process.env.HEARTBEAT_MAX_AGE_MS = '1000';
    expect(isHeartbeatFresh()).toBe(false);
    process.env.HEARTBEAT_MAX_AGE_MS = '60000';
    expect(isHeartbeatFresh()).toBe(true);
  });

  it('is sized above one bounded pipeline stage', () => {
    // beat() runs after each stage, and the longest stage is a capped
    // ffmpeg child. A threshold at or under that would kill healthy
    // transcodes; the chart pins the same relationship (render-tests.sh).
    expect(heartbeatMaxAgeMs()).toBeGreaterThan(DEFAULT_CHILD_TIMEOUT_MS);
  });
});
