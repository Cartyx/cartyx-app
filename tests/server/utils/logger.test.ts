import { describe, it, expect, vi } from 'vitest';
import { withLogging, REDACT_PATHS } from '~/server/utils/logger';

describe('REDACT_PATHS', () => {
  it('covers the identifiers that leak today', () => {
    expect(REDACT_PATHS).toContain('sessionId');
    expect(REDACT_PATHS).toContain('characterName');
    expect(REDACT_PATHS).toContain('userName');
  });
});

describe('withLogging', () => {
  it('returns the wrapped function result unchanged', async () => {
    const fn = withLogging('test.ok', async (n: number) => n * 2);
    await expect(fn(21)).resolves.toBe(42);
  });

  it('re-throws the original error', async () => {
    const boom = new Error('boom');
    const fn = withLogging('test.fail', async () => {
      throw boom;
    });
    await expect(fn()).rejects.toBe(boom);
  });

  it('preserves the argument list', async () => {
    const spy = vi.fn(async (a: string, b: string) => `${a}-${b}`);
    const fn = withLogging('test.args', spy);
    await expect(fn('x', 'y')).resolves.toBe('x-y');
    expect(spy).toHaveBeenCalledWith('x', 'y');
  });
});
