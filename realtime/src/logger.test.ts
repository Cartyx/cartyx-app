import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import { REDACT_PATHS } from './logger.js';

function capture(): { sink: Writable; lines: () => Record<string, unknown>[] } {
  const out: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      out.push(chunk.toString());
      cb();
    },
  });
  return { sink, lines: () => out.map((l) => JSON.parse(l)) };
}

describe('REDACT_PATHS', () => {
  it('strips sessionId from log output', () => {
    const { sink, lines } = capture();
    const log = pino({ redact: REDACT_PATHS, level: 'info' }, sink);

    log.info({ sessionId: 'sess_secret_123' }, 'connected');

    const [entry] = lines();
    expect(entry.sessionId).toBe('[Redacted]');
    expect(JSON.stringify(entry)).not.toContain('sess_secret_123');
  });

  it('strips nested user and character identifiers', () => {
    const { sink, lines } = capture();
    const log = pino({ redact: REDACT_PATHS, level: 'info' }, sink);

    log.info({ userName: 'aaron', characterName: 'Vex', roll: { title: 'Fireball' } }, 'routed');

    const raw = JSON.stringify(lines()[0]);
    expect(raw).not.toContain('aaron');
    expect(raw).not.toContain('Vex');
    expect(raw).not.toContain('Fireball');
  });

  it('leaves non-PII fields intact', () => {
    const { sink, lines } = capture();
    const log = pino({ redact: REDACT_PATHS, level: 'info' }, sink);

    log.info({ port: 1999, roomCount: 3 }, 'listening');

    const [entry] = lines();
    expect(entry.port).toBe(1999);
    expect(entry.roomCount).toBe(3);
  });
});
