import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveEnvironment, getBootstrapPolicy } from '~/server/db/policy';
import type { BootstrapEnvironment } from '~/server/db/policy';

describe('resolveEnvironment', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.APP_ENV = process.env.APP_ENV;
    saved.NODE_ENV = process.env.NODE_ENV;
    delete process.env.APP_ENV;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('returns explicit APP_ENV when set to production', () => {
    process.env.APP_ENV = 'production';
    expect(resolveEnvironment()).toBe('production');
  });

  it('returns explicit APP_ENV when set to staging', () => {
    process.env.APP_ENV = 'staging';
    expect(resolveEnvironment()).toBe('staging');
  });

  it('returns explicit APP_ENV when set to development', () => {
    process.env.APP_ENV = 'development';
    expect(resolveEnvironment()).toBe('development');
  });

  it('ignores invalid APP_ENV values', () => {
    process.env.APP_ENV = 'preview';
    process.env.NODE_ENV = 'development';
    expect(resolveEnvironment()).toBe('development');
  });

  it('APP_ENV takes precedence over NODE_ENV', () => {
    process.env.APP_ENV = 'staging';
    process.env.NODE_ENV = 'production';
    expect(resolveEnvironment()).toBe('staging');
  });

  it('returns production when NODE_ENV is production and APP_ENV is unset', () => {
    process.env.NODE_ENV = 'production';
    expect(resolveEnvironment()).toBe('production');
  });

  it('defaults to development otherwise', () => {
    process.env.NODE_ENV = 'test';
    expect(resolveEnvironment()).toBe('development');
  });
});

describe('getBootstrapPolicy', () => {
  it('returns a policy with the correct environment field', () => {
    const envs: BootstrapEnvironment[] = ['production', 'staging', 'development'];
    for (const env of envs) {
      expect(getBootstrapPolicy(env).environment).toBe(env);
    }
  });

  it('production policy disables syncIndexes and autoIndex, enables critical verification', () => {
    const p = getBootstrapPolicy('production');
    expect(p.syncIndexes).toBe(false);
    expect(p.autoIndex).toBe(false);
    expect(p.verifyCriticalIndexes).toBe(true);
    expect(p.failOnCriticalDrift).toBe(true);
    expect(p.timeoutMs).toBeGreaterThan(0);
  });

  it('staging policy verifies critical indexes but does not fail on drift', () => {
    const p = getBootstrapPolicy('staging');
    expect(p.syncIndexes).toBe(false);
    expect(p.autoIndex).toBe(false);
    expect(p.verifyCriticalIndexes).toBe(true);
    expect(p.failOnCriticalDrift).toBe(false);
    expect(p.timeoutMs).toBeGreaterThan(0);
  });

  it('development policy syncs indexes and enables autoIndex', () => {
    const p = getBootstrapPolicy('development');
    expect(p.syncIndexes).toBe(true);
    expect(p.autoIndex).toBe(true);
    expect(p.verifyCriticalIndexes).toBe(false);
    expect(p.failOnCriticalDrift).toBe(false);
    expect(p.timeoutMs).toBeGreaterThan(0);
  });
});
