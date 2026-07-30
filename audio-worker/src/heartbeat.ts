import { statSync, writeFileSync } from 'node:fs';
import { heartbeatFile, heartbeatMaxAgeMs } from './config.js';

/**
 * Liveness signal for a worker that has no HTTP port.
 *
 * The worker is a single sequential loop with no server, so a wedge is
 * invisible from outside the process: restart count 0, memory flat, no logs,
 * HelmRelease green, and every user's uploads silently queued behind one stuck
 * row. This file is the only thing that distinguishes "idle" from "wedged".
 *
 * It records LOOP PROGRESS, deliberately, not wall-clock liveness. A
 * `setInterval` heartbeat would keep ticking while the loop sat on a hung R2
 * socket — precisely the failure the probe exists to catch — because the event
 * loop is free the whole time. So `beat()` is only ever called from code that
 * has just finished a real step.
 *
 * Written synchronously: it is a handful of bytes to tmpfs, it must not depend
 * on an unhandled promise settling, and a failure here must never propagate
 * into the pipeline (a full or read-only /tmp is a reason to log, not a reason
 * to fail an upload).
 */
export function beat(now: number = Date.now()): void {
  try {
    writeFileSync(heartbeatFile(), String(now));
  } catch {
    // Best effort by design — see above.
  }
}

/**
 * True when the heartbeat exists and is younger than `maxAgeMs`.
 *
 * A missing file is NOT alive: the worker writes one before it does anything
 * else, so its absence means the process never got that far (or something
 * wiped it), and a probe that treats "no evidence" as "healthy" is the probe
 * this worker already had.
 */
export function isHeartbeatFresh(
  path: string = heartbeatFile(),
  maxAgeMs: number = heartbeatMaxAgeMs(),
  now: number = Date.now()
): boolean {
  try {
    const { mtimeMs } = statSync(path);
    return now - mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}
